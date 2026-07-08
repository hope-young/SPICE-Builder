"""FastAPI routes for SpiceBuilder."""
from datetime import datetime
from typing import Optional
import asyncio
import os
import uuid
import tempfile
from pathlib import Path
import numpy as np

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
import queue as queue_module

from .state import state, Project, Task
from .models import (
    LoadProjectRequest, FitRequest, ExportRequest,
    LoadProjectResponse, FitResponse, TaskInfo, ProjectModelResponse,
    ExportResponse, CurveResponse, ModelParamInfo, HealthResponse,
    SimulateRequest, SimulateResponse, FitSingleRequest, FitSingleResponse,
    LoadCsvRequest, LoadCsvResponse,
    CsvLoadRequest, CsvLoadResponse, CsvSimulateRequest, CsvSimulateResponse,
    CsvFitRequest, CsvFitResponse,
    DualFitRequest, DualFitResponse, CsvExportModelRequest,
)

from spicebuilder.data.loader_sdh import load_sdh_excel
from spicebuilder.data.loader_csv import (
    load_idvg_csv, load_idvd_csv, load_cv_csv, load_qg_csv, load_body_diode_csv
)
from spicebuilder.data.simdata import SimData


def _populate_fit_cache(project, engine) -> None:
    """Persist fitted curves onto `project.cached_fits` keyed by route name.

    SimData built inside `SimData.from_xxx(...)` is a *fresh* object and
    therefore has no .fit values when later fetched via /curves.  Here we
    walk the engine's stages (whose SimData is the actual fitted object)
    and surface the fit arrays back onto the project so subsequent
    GET /api/projects/{id}/curves/{type} calls can include "fit".

    Keys are typed strings or tuples (type, vgs) so that GET /curves/idvd
    with ?vgs_v=10 doesn't accidentally pick up the fit from the Vgs=6
    sweep (which used to produce a length mismatch and "n/a" cells).
    """
    cache: dict[Any, list] = {}

    for stage in engine.stages:
        for sd in stage.simdata:
            ct = sd.curve_type  # IdVg / IdVd / CvVds / IsVsd / Qg
            T = sd.metadata.get("temperature_c", 25)
            fit_list = sd.fit.tolist() if sd.fit is not None else None
            if ct == "IdVg":
                vds = sd.metadata.get("vds_v", 0.5)
                if vds == 5.0:
                    key = "idvg_5v"
                elif vds == 0.5 and T != 150:
                    key = "idvg_05v"
                else:
                    continue
            elif ct == "IdVd":
                # Id-Vd curves span multiple Vgs levels; key by Vgs so
                # the GET route can pick the matching fit when the caller
                # asks for a specific Vgs level.
                vgs = sd.metadata.get("vgs_v")
                if vgs is None:
                    continue
                key = ("idvd", f"vgs_{float(vgs):.2f}")
            elif ct == "CvVds":
                cap = sd.metadata.get("cap_type")  # 'ciss' / 'coss' / 'crss'
                if cap == "ciss":
                    key = "cv_vds_ciss"
                elif cap == "coss":
                    key = "cv_vds_coss"
                elif cap == "crss":
                    key = "cv_vds_crss"
                else:
                    continue
            elif ct == "IsVsd":
                key = "body_diode"
            else:
                continue
            cache.setdefault(key, []).append(fit_list)

    project.cached_fits = cache

from spicebuilder.models.bsim3 import BSIM3Model, PARAM_SPECS
from spicebuilder.models.init_values import init_from_key_params
from spicebuilder.models.powermos import PowerMOSSubcktParams
from spicebuilder.fitting.optimizer import Optimizer
from spicebuilder.fitting.stage import Stage
from spicebuilder.strategy.sgt_6stage import build_sgt_engine
from spicebuilder.models.exporter import LibExporter
from spicebuilder.simulator.evaluator import LTspiceEvaluator

router = APIRouter()


def _apply_param_bounds(model: BSIM3Model, bounds: dict | None) -> None:
    """Apply user-provided fit bounds to a model if they are valid."""
    if not bounds:
        return
    for name, pair in bounds.items():
        try:
            if not isinstance(pair, (list, tuple)) or len(pair) != 2:
                continue
            lo = float(pair[0])
            hi = float(pair[1])
            if not np.isfinite(lo) or not np.isfinite(hi) or lo >= hi:
                continue
            model.set_bounds(name, lo, hi)
        except (KeyError, TypeError, ValueError):
            continue


def _apply_initial_params(model: BSIM3Model, values: dict | None) -> None:
    """Apply frontend/model-state parameter values before an optimization run."""
    if not values:
        return
    for name, val in values.items():
        try:
            f = float(val)
            if np.isfinite(f):
                lo, hi = model.get_bounds(name)
                f = min(max(f, lo), hi)
                model.set(name, f)
        except (KeyError, TypeError, ValueError):
            continue


def _power_params_from_request(
    req,
    base: PowerMOSSubcktParams | None = None,
) -> PowerMOSSubcktParams | None:
    payload = getattr(req, "power_params", None)
    if payload is None:
        return None
    if hasattr(payload, "model_dump"):
        data = payload.model_dump(exclude_unset=True)
        if not data:
            return None
        return PowerMOSSubcktParams.from_dict(data, base=base)
    if isinstance(payload, dict):
        return PowerMOSSubcktParams.from_dict(payload, base=base)
    return None


def _evaluator_power_params_from_request(req) -> PowerMOSSubcktParams | None:
    return _power_params_from_request(
        req,
        base=PowerMOSSubcktParams(rg_ohm=1.6, cell_count=100, cell_w_m=0.2),
    )


def _csv_optimizer_from_request(req) -> Optimizer:
    stop = req.stop
    def tol(v: float, fallback: float = 1e-6) -> float:
        try:
            f = float(v)
        except (TypeError, ValueError):
            return fallback
        if not np.isfinite(f) or f <= 0:
            return fallback
        return min(max(f, 1e-12), 1e-2)

    try:
        max_nfev = int(stop.max_nfev)
    except (TypeError, ValueError):
        max_nfev = 120
    max_nfev = max(5, min(max_nfev, 10000))

    opt = Optimizer(method="trf")
    opt.set_eps1(tol(stop.ftol)).set_eps2(tol(stop.xtol)).set_eps3(tol(stop.gtol)).set_max_nfev(max_nfev)
    return opt


def _csv_r2_stop_from_request(req) -> tuple[float, float]:
    def r2(v: float, fallback: float = 0.99) -> float:
        try:
            f = float(v)
        except (TypeError, ValueError):
            return fallback
        if not np.isfinite(f):
            return fallback
        return min(max(f, 0.0), 0.999999)

    return r2(req.stop.r2_log), r2(req.stop.r2_linear)


def _load_protection_idvg_curves(req: CsvFitRequest) -> list[SimData]:
    curves: list[SimData] = []
    for i, spec in enumerate(req.protect_curves or []):
        try:
            path = Path(spec.get("csv_path", ""))
            if not path.exists():
                continue
            sd = load_idvg_csv(path)
            vmin = float(spec.get("vmin", float(sd.ivar.min())))
            vmax = float(spec.get("vmax", float(sd.ivar.max())))
            vds = float(spec.get("vds", sd.metadata.get("vds_v", req.vds)))
            weight = float(spec.get("weight", 0.35))
            if weight <= 0:
                continue
            if sd.filter_range(vmin, vmax).ivar.size == 0:
                continue
            sd.name = f"{sd.name}_protect_{i + 1}"
            sd.metadata["vmin"] = vmin
            sd.metadata["vmax"] = vmax
            sd.metadata["vds_v"] = vds
            sd.metadata["loss_weight"] = weight
            sd.metadata["protected"] = True
            curves.append(sd)
        except Exception:
            continue
    return curves


# ============================================================
#  Health
# ============================================================

@router.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        status="ok",
        version="0.1.0",
        n_projects=len(state.projects),
        n_tasks=len(state.tasks),
    )


# ============================================================
#  Projects - load
# ============================================================

@router.post("/projects/load", response_model=LoadProjectResponse)
def load_project(req: LoadProjectRequest):
    # Validate and normalize the user-supplied path.
    # This is defense against path traversal, non-existent files, and
    # wrong extension.  The API listens on 127.0.0.1 only so risk is
    # limited, but the Tauri/IPC surface still benefits.
    excel_path = Path(req.excel_path).resolve()
    if not excel_path.is_file():
        raise HTTPException(404, f"Excel file not found: {req.excel_path}")
    if excel_path.suffix.lower() != ".xlsx":
        raise HTTPException(400, f"Expected .xlsx extension, got: {excel_path.suffix}")
    try:
        ds = load_sdh_excel(str(excel_path))
    except FileNotFoundError:
        raise HTTPException(404, f"Excel file not found: {req.excel_path}")
    except Exception as e:
        raise HTTPException(400, f"Load failed: {e}")

    model = BSIM3Model()
    try:
        init_from_key_params(model, ds.key_params)
    except Exception as e:
        raise HTTPException(500, f"Init values failed: {e}")

    project_id = str(uuid.uuid4())
    name = req.name or ds.device_info.part_number
    state.projects[project_id] = Project(
        id=project_id,
        name=name,
        dataset=ds,
        model=model,
        created_at=datetime.now().isoformat(),
    )

    return LoadProjectResponse(
        project_id=project_id,
        name=name,
        device_info={
            "part_number": ds.device_info.part_number,
            "package": ds.device_info.package,
            "bvdss_v": ds.device_info.bvdss_rated_v,
            "rdson_max_mohm": ds.device_info.rdson_max_ohm * 1e3,
            "id_rated_a": ds.device_info.id_rated_a,
            "vth_typ_v": ds.device_info.vth_typ_v,
        },
        key_params={
            "vth_25c_v": ds.key_params.vth_25c_v,
            "rdson_25c_10v_mohm": ds.key_params.rdson_25c_10v_ohm * 1e3,
            "rdson_150c_10v_mohm": ds.key_params.rdson_150c_10v_ohm * 1e3,
            "qg_on_20v_nc": ds.key_params.qg_on_20v_nc,
            "ciss_25v_pf": ds.key_params.ciss_25v_pf,
            "coss_25v_pf": ds.key_params.coss_25v_pf,
            "crss_25v_pf": ds.key_params.crss_25v_pf,
            "rg_ohm": ds.key_params.rg_internal_ohm,
        },
        curve_counts={
            "idvg_5v": len(ds.idvg_vds5),
            "idvg_05v": len(ds.idvg_vds05),
            "idvd": len(ds.idvd),
            "cv_vds": len(ds.cv_vds),
            "body_diode": len(ds.body_diode),
        },
    )


@router.get("/projects/{project_id}")
def get_project(project_id: str):
    project = state.projects.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return {
        "project_id": project.id,
        "name": project.name,
        "created_at": project.created_at,
    }


# Return the full dataset summary for a project.  Used by the GUI when
# switching between already-loaded projects (e.g. selectProject action)
# to repopulate the in-memory dataset without re-reading the Excel file.
# The raw curve arrays are NOT included - the GUI fetches them lazily
# via /curves/{type} as needed.
@router.get("/projects/{project_id}/dataset")
def get_project_dataset(project_id: str):
    project = state.projects.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    ds = project.dataset
    return {
        "project_id": project.id,
        "name": project.name,
        "device_info": getattr(ds, "device_info", None),
        "key_params": getattr(ds, "key_params", None),
        "n_idvg_vds5": len(getattr(ds, "idvg_vds5", []) or []),
        "n_idvg_vds05": len(getattr(ds, "idvg_vds05", []) or []),
        "n_idvd": len(getattr(ds, "idvd", []) or []),
        "n_cv_vds": len(getattr(ds, "cv_vds", []) or []),
        "n_body_diode": len(getattr(ds, "body_diode", []) or []),
    }


# ============================================================
#  Fitting - run + task tracking
# ============================================================

def _make_progress_callback(task: "Task") -> "callable":
    """Return a callback that maps (stage, loop) coordinates to task.progress.

    Granularity: 0.05 .. 0.95 evenly split across (total_stages * max_loops)
    stage executions.  Each stage completion bumps progress by exactly one slot.
    """
    # Closure captures task; reads total_stages / max_loops from the first
    # callback invocation (subsequent calls ignore different totals).
    def _cb(stage_name, stage_idx, total_stages, status, loop_idx, max_loops):
        # Always surface the most recent stage name + loop index so the
        # GUI can render the active stage without inferring from a
        # progress fraction.  The fraction is only updated on completion
        # so that polling shows smooth advancement.
        task.current_stage = stage_name
        task.current_loop = int(loop_idx) + 1
        if status != "complete":
            return
        total_steps = max(1, total_stages * max_loops)
        current = (loop_idx * total_stages) + stage_idx + 1
        frac = 0.05 + 0.90 * (current / total_steps)
        # Clamp in case of weird call order
        task.progress = round(min(0.95, frac), 3)
    return _cb


def _run_fit_sync(project: Project, req: FitRequest, task: Task):
    """CPU-bound fit in sync context (run in executor)."""
    ds = project.dataset
    model = project.model

    # Optimizer
    opt = Optimizer(method=req.optimizer.method)
    opt.set_eps1(req.optimizer.eps1)
    opt.set_eps2(req.optimizer.eps2)
    opt.set_eps3(req.optimizer.eps3)
    opt.set_max_iter(req.optimizer.max_iter)

    # Engine with stage-level progress reporting.
    task.progress = 0.05
    # Wire an optional LTspice simulator into the engine objective.
    # A failed attempt (LTspice not installed) is non-fatal: fall back to
    # the simplified BSIM3 formula objective.  The decision is taken from
    # the FitRequest so callers (driveby.py, Tauri GUI) can opt out.
    simulator = None
    if getattr(req, "use_ltspice", True):
        try:
            simulator = LTspiceEvaluator()
        except Exception as e:
            print(f"[fit] LTspice unavailable, falling back to built-in formula: {e}")
    engine = build_sgt_engine(
        dataset=ds, model=model, optimizer=opt,
        error_threshold=req.error_threshold,
        max_loops=req.max_loops,
        verbose=False,
        progress_callback=_make_progress_callback(task),
        simulator=simulator,
        stages=list(req.stages) if req.stages else None,
    )

    result = engine.run(opt)

    # Persist fitted curves back onto the project so subsequent
    # GET /api/projects/{id}/curves/{type} can surface 'fit' along
    # with the raw ivar / dvar data.
    _populate_fit_cache(project, engine)

    task.progress = 1.0
    task.result = {
        "success": result.success,
        "total_rms": float(result.total_rms),
        "r_squared": float(result.r_squared),
        "iterations": int(result.iterations),
        "message": result.message,
        "stages": [
            {
                "name": sr.stage_name,
                "rms": float(sr.rms),
                # NaN-stamp means the stage had no fitted points
                # (e.g. empty mask result). Surface as null in JSON.
                "r_squared": (
                    None
                    if (sr.r_squared != sr.r_squared)  # NaN check
                    else float(sr.r_squared)
                ),
                "success": bool(sr.success),
            }
            for sr in result.stage_results
        ],
    }
    task.progress = 1.0


async def _fit_task_wrapper(project_id: str, req: FitRequest, task_id: str):
    project = state.projects.get(project_id)
    task = state.tasks.get(task_id)
    if not project or not task:
        return
    loop = asyncio.get_event_loop()
    try:
        task.status = "running"
        await loop.run_in_executor(None, _run_fit_sync, project, req, task)
        task.status = "completed"
    except asyncio.CancelledError:
        # User-requested cancellation.  Surface the state so the frontend
        # polling loop can stop without timing out.
        task.status = "cancelled"
        task.error = "cancelled by user"
        task.progress = 1.0
    except Exception as e:
        task.status = "failed"
        task.error = str(e)
        task.progress = 1.0


@router.post("/projects/{project_id}/fit", response_model=FitResponse)
async def start_fit(project_id: str, req: FitRequest):
    project = state.projects.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    task_id = str(uuid.uuid4())
    task = state.tasks[task_id] = Task(
        id=task_id,
        type="fit",
        status="queued",
        project_id=project_id,
        created_at=datetime.now().isoformat(),
    )

    # Schedule background task and hold a strong reference so it isn't
    # garbage-collected mid-run (Python cancels unreferenced Tasks).
    task.asyncio_task = asyncio.create_task(_fit_task_wrapper(project_id, req, task_id))

    return FitResponse(
        task_id=task_id,
        project_id=project_id,
        status="queued",
        message="Fit task started",
    )


@router.get("/tasks/{task_id}", response_model=TaskInfo)
@router.post('/tasks/{task_id}/cancel')
async def cancel_task(task_id: str):
    task = state.tasks.get(task_id)
    if not task:
        raise HTTPException(404, 'Task not found')
    if task.status in ('completed', 'failed', 'cancelled'):
        return {'task_id': task_id, 'status': task.status, 'cancelled': False, 'reason': 'task already finished'}
    aio = getattr(task, 'asyncio_task', None)
    if aio is not None and not aio.done():
        aio.cancel()
    task.status = 'cancelled'
    task.error = 'cancelled by user'
    task.progress = 1.0
    return {'task_id': task_id, 'status': 'cancelled', 'cancelled': True}
def get_task(task_id: str):
    task = state.tasks.get(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return TaskInfo(
        id=task.id,
        type=task.type,
        status=task.status,
        progress=task.progress, current_stage=getattr(task, "current_stage", ""), current_loop=getattr(task, "current_loop", 0),
        result=task.result,
        error=task.error,
        created_at=task.created_at,
    )


# ============================================================
#  Model - get current parameters
# ============================================================

@router.get("/projects/{project_id}/model", response_model=ProjectModelResponse)
def get_model(project_id: str):
    project = state.projects.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    model = project.model
    spec_map = {s.name: s for s in PARAM_SPECS}
    # model.is_fitted(param) 接受参数名；获取所有已拟合参数用 _fitted 集合
    fitted = getattr(model, '_fitted', set())
    initial = model.get_initial() if hasattr(model, 'get_initial') else {}

    params = []
    n_fitted = 0
    for name in sorted(model.to_dict().keys()):
        val = model.get(name)
        spec = spec_map.get(name)
        is_fit = name in fitted
        if is_fit:
            n_fitted += 1
        params.append(ModelParamInfo(
            name=name,
            value=float(val),
            initial=float(initial.get(name, val)),
            fitted=is_fit,
            category=spec.category if spec else "default",
            stage=spec.stage if spec else "",
            unit=spec.unit if spec else "",
            description=spec.description if spec else "",
        ))

    return ProjectModelResponse(
        project_id=project_id,
        n_params=len(params),
        n_fitted=n_fitted,
        params=params,
    )


# ============================================================
#  Export - write .lib
# ============================================================

@router.post("/projects/{project_id}/export", response_model=ExportResponse)
def export_project(project_id: str, req: ExportRequest):
    project = state.projects.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    # Validate output_path: must end with .lib and parent dir must exist.
    # This prevents writing to arbitrary locations and catches typos early.
    out_path = Path(req.output_path).resolve()
    if out_path.suffix.lower() != ".lib":
        raise HTTPException(400, f"Expected .lib extension, got: {out_path.suffix}")
    if not out_path.parent.is_dir():
        raise HTTPException(400, f"Output directory does not exist: {out_path.parent}")
    out_path_str = str(out_path)

    exporter = LibExporter(part_number=project.dataset.device_info.part_number)
    try:
        if req.format.upper() == "A":
            path = exporter.export_bsim3(project.model, out_path_str)
        else:
            # 使用短名作为 subckt_name，方便调用
            short_name = "SDH10N2P1" if "SDH10N2P1" in project.name else project.name
            path = exporter.export_subckt(
                project.model, out_path_str,
                subckt_name=short_name,
                rg_ohm=req.rg_ohm,
                rd_ohm=req.rd_ohm,
                rs_ohm=req.rs_ohm,
                include_diode=req.include_diode,
                power_params=_power_params_from_request(req),
            )
    except Exception as e:
        raise HTTPException(500, f"Export failed: {e}")

    n_bytes = path.stat().st_size if path.exists() else 0
    return ExportResponse(
        success=True,
        file_path=str(path.resolve()),
        n_bytes=n_bytes,
    )


# ============================================================
#  Simulate - real-time curve with parameter overrides
# ============================================================

@router.post("/projects/{project_id}/simulate", response_model=SimulateResponse)
def simulate_curve(project_id: str, req: SimulateRequest):
    """Evaluate Id-Vg or Id-Vd curve with arbitrary parameter overrides.

    This endpoint creates a temporary BSIM3Model, applies param_overrides,
    then runs LTspice to get the simulated curve — without modifying the
    project's stored model or triggering a full fit pipeline.
    """
    project = state.projects.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    # Clone the project's model and apply overrides
    sim_model = BSIM3Model(name=project.model.name)
    init_from_key_params(sim_model, project.dataset.key_params)
    # Copy current (possibly fitted) values first
    for name in project.model._values:
        try:
            sim_model.set(name, project.model.get(name))
        except (KeyError, ValueError):
            pass
    # Apply user overrides
    for name, val in req.param_overrides.items():
        try:
            sim_model.set(name, val)
        except (KeyError, ValueError):
            pass  # Silently skip unknown params

    ltspice_ok = True
    try:
        evaluator = LTspiceEvaluator(
            subckt_name="SDH10N2P1",
            rg_ohm=1.6,
            verbose=False,
            power_params=_evaluator_power_params_from_request(req),
        )
    except Exception:
        ltspice_ok = False
        evaluator = None

    metadata = {"ltspice_available": ltspice_ok}

    if req.curve_type == "idvg":
        # Choose Vgs grid from dataset
        if req.vds <= 1.0:
            raw_points = project.dataset.idvg_vds05
        else:
            raw_points = project.dataset.idvg_vds5

        if not raw_points:
            raise HTTPException(400, f"No Id-Vg data for Vds={req.vds}V")

        sd = SimData.from_idvg(raw_points, temperature_c=25, vds_v=req.vds)
        vgs_grid = sd.ivar.tolist()
        meas = sd.dvar.tolist()
        metadata["vds_v"] = req.vds
        metadata["temperature_c"] = 25

        if ltspice_ok:
            sim_arr = evaluator.eval_idvg(sim_model, sd.ivar, vds=req.vds)
            sim = sim_arr.tolist()
        else:
            sim = [1e-12] * len(vgs_grid)

    elif req.curve_type == "idvd":
        if not project.dataset.idvd:
            raise HTTPException(400, "No Id-Vd data in dataset")

        sd = SimData.from_idvd(project.dataset.idvd, vgs_v=req.vgs_v, temperature_c=25)
        vds_grid = sd.ivar.tolist()
        meas = sd.dvar.tolist()
        metadata["vgs_v"] = req.vgs_v
        metadata["temperature_c"] = 25

        if ltspice_ok:
            sim_arr = evaluator.eval_idvd(sim_model, sd.ivar, vgs=req.vgs_v, vds_max=req.vds_max)
            sim = sim_arr.tolist()
        else:
            sim = [1e-12] * len(vds_grid)

    else:
        raise HTTPException(400, f"Unknown curve_type: {req.curve_type}")

    return SimulateResponse(
        curve_type=req.curve_type,
        ivar=vgs_grid if req.curve_type == "idvg" else vds_grid,
        sim=sim,
        meas=meas,
        metadata=metadata,
    )


# ============================================================
#  Fit single curve (区间拟合)
# ============================================================

@router.post("/projects/{project_id}/fit_single", response_model=FitSingleResponse)
def fit_single_curve(project_id: str, req: FitSingleRequest):
    """在用户选定区间内拟合单条曲线，返回最优参数 + 全段仿真。

    用 LTspice eval_idvg/eval_idvd 作为目标函数，只用 [vmin, vmax] 内残差。
    """
    import time as _time
    project = state.projects.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    # 取数据
    if req.curve_type == "idvg":
        if req.vds <= 1.0:
            raw = project.dataset.idvg_vds05
        else:
            raw = project.dataset.idvg_vds5
        if not raw:
            raise HTTPException(400, f"No IdVg data at Vds={req.vds}V")
        sd_full = SimData.from_idvg(raw, temperature_c=25, vds_v=req.vds)
        vgs_full = sd_full.ivar
        meas_full = sd_full.dvar
        # 区间过滤
        sd_range = sd_full.filter_range(req.vmin, req.vmax)
        if sd_range.ivar.size == 0:
            raise HTTPException(400, f"No data in range [{req.vmin}, {req.vmax}]")
    elif req.curve_type == "idvd":
        raw = project.dataset.idvd
        if not raw:
            raise HTTPException(400, "No IdVd data")
        sd_full = SimData.from_idvd(raw, vgs_v=req.vgs_v, temperature_c=25)
        vds_full = sd_full.ivar
        meas_full = sd_full.dvar
        sd_range = sd_full.filter_range(req.vmin, req.vmax)
        if sd_range.ivar.size == 0:
            raise HTTPException(400, f"No data in range [{req.vmin}, {req.vmax}]")
    else:
        raise HTTPException(400, f"Unknown curve_type: {req.curve_type}")

    # 在 metadata 中锁定区间（Stage 会读取 vmin/vmax 过滤点）
    sd_range.metadata["vmin"] = req.vmin
    sd_range.metadata["vmax"] = req.vmax

    # 跑 stage 拟合
    stage = Stage(
        name=f"RangeFit_{req.curve_type}",
        simdata=[sd_range],
        param_names=req.param_names,
        model=project.model,
        error_func="log",
        simulator=LTspiceEvaluator(
            subckt_name="SDH10N2P1",
            rg_ohm=1.6,
            verbose=False,
            power_params=_evaluator_power_params_from_request(req),
        ),
    )

    t0 = _time.time()
    opt = Optimizer(method="trf")
    result = stage.run(opt)
    dt = _time.time() - t0

    # 重新跑全段仿真（最终模型）
    if req.curve_type == "idvg":
        sim_full = stage.simulator.eval_idvg(project.model, vgs_full, vds=req.vds)
    else:
        sim_full = stage.simulator.eval_idvd(
            project.model, vds_full, vgs=req.vgs_v, vds_max=float(vds_full.max() * 1.1),
        )

    # 把拟合结果参数写回 project.model（持久化）
    for pname, val in result.fitted_params.items():
        try:
            project.model.set(pname, val)
        except (KeyError, ValueError):
            pass

    return FitSingleResponse(
        fitted_params={k: float(v) for k, v in result.fitted_params.items()},
        ivar=vgs_full.tolist() if req.curve_type == "idvg" else vds_full.tolist(),
        sim=sim_full.tolist(),
        meas=meas_full.tolist(),
        rms=float(result.rms) if not np.isnan(result.rms) else 0.0,
        r_squared=float(result.r_squared) if not np.isnan(result.r_squared) else 0.0,
        r_squared_linear=float(result.r_squared_linear) if not np.isnan(result.r_squared_linear) else 0.0,
        iterations=int(result.iterations),
        nfev=int(result.nfev),
        optimizer_message=result.message,
        success=bool(result.success),
    )


@router.post("/projects/{project_id}/load_csv", response_model=LoadCsvResponse)
def load_csv(project_id: str, req: LoadCsvRequest):
    """加载单条 CSV 曲线为 SimData，返回 ivar/dvar。"""
    path = Path(req.csv_path)
    if not path.exists():
        raise HTTPException(404, f"CSV not found: {req.csv_path}")

    try:
        if req.curve_type == "idvg":
            sd = load_idvg_csv(path)
        elif req.curve_type == "idvd":
            sd = load_idvd_csv(path)
        elif req.curve_type == "cv":
            sd = load_cv_csv(path)
        elif req.curve_type == "qg":
            sd = load_qg_csv(path)
        elif req.curve_type == "body_diode":
            sd = load_body_diode_csv(path)
        else:
            raise HTTPException(400, f"Unknown curve_type: {req.curve_type}")
    except Exception as e:
        raise HTTPException(400, f"Failed to parse CSV: {e}")

    return LoadCsvResponse(
        curve_type=sd.curve_type,
        ivar=sd.ivar.tolist(),
        dvar=sd.dvar.tolist(),
        metadata=sd.metadata,
    )


# ============================================================
#  Curves - get raw measurement data
# ============================================================

@router.get("/projects/{project_id}/curves/{curve_type}", response_model=CurveResponse)
def get_curve(project_id: str, curve_type: str, vgs_v: Optional[float] = None):
    project = state.projects.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    ds = project.dataset
    try:
        if curve_type == "idvg_5v":
            sim = SimData.from_idvg(ds.idvg_vds5, temperature_c=25, vds_v=5.0)
        elif curve_type == "idvg_05v":
            sim = SimData.from_idvg(ds.idvg_vds05, temperature_c=25, vds_v=0.5)
        elif curve_type == "idvg_05v_t150":
            sim = SimData.from_idvg(ds.idvg_vds05, temperature_c=150, vds_v=0.5)
        elif curve_type == "idvd":
            v = vgs_v if vgs_v is not None else 10.0
            sim = SimData.from_idvd(ds.idvd, vgs_v=v, temperature_c=25)
        elif curve_type == "cv_vds_ciss":
            sim = SimData.from_cv(ds.cv_vds, cap_type='ciss')
        elif curve_type == "cv_vds_coss":
            sim = SimData.from_cv(ds.cv_vds, cap_type='coss')
        elif curve_type == "cv_vds_crss":
            sim = SimData.from_cv(ds.cv_vds, cap_type='crss')
        elif curve_type == "body_diode":
            sim = SimData.from_body_diode(ds.body_diode, temperature_c=25)
        else:
            raise HTTPException(400, f"Unknown curve_type: {curve_type}")
    except Exception as e:
        raise HTTPException(400, f"Curve error: {e}")

    # The freshly built SimData has no .fit (we didn't run the optimizer
    # on it); fit values live in project.cached_fits[...] populated
    # by _populate_fit_cache() at the end of _run_fit_sync.  For IdVd
    # curves the cache is keyed by (type, vgs) so we can pick the right
    # fit when the caller asks for a specific Vgs level; other curve
    # types fall through to the string key.
    cached = getattr(project, "cached_fits", None) or {}
    fit_list: list | None = None
    if curve_type == "idvd":
        v = vgs_v if vgs_v is not None else 10.0
        for entry in cached.get(("idvd", f"vgs_{v:.2f}"), []):
            if entry is not None:
                fit_list = entry
                break
    else:
        for entry in cached.get(curve_type, []):
            if entry is not None:
                fit_list = entry
                break

    return CurveResponse(
        name=sim.name,
        curve_type=sim.curve_type,
        data={
            "ivar": sim.ivar.tolist(),
            "dvar": sim.dvar.tolist(),
            "fit": fit_list,
        },
        metadata={
            k: (v if isinstance(v, (int, float, str, bool, list)) else str(v))
            for k, v in sim.metadata.items()
        } | {"has_fit": fit_list is not None, "vgs_v": vgs_v},
    )


# ============================================================
#  List projects / tasks
# ============================================================

@router.get("/projects")
def list_projects():
    return {
        "projects": [
            {"id": p.id, "name": p.name, "created_at": p.created_at}
            for p in state.projects.values()
        ]
    }


@router.get("/tasks")
def list_tasks():
    return {
        "tasks": [
            {"id": t.id, "type": t.type, "status": t.status, "progress": t.progress}
            for t in state.tasks.values()
        ]
    }


@router.post("/csv/upload")
async def csv_upload(file: UploadFile):
    """接收浏览器上传的 CSV, 存到临时目录, 返回绝对路径。
    主要给 web 模式用（Tauri 模式直接走 file dialog）。"""
    import shutil
    tmpdir = Path(tempfile.gettempdir()) / "spicebuilder_uploads"
    tmpdir.mkdir(exist_ok=True)
    dest = tmpdir / file.filename
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"csv_path": str(dest.resolve())}


# ============================================================
#  Stateless CSV (无 project_id, 单次调用 fresh)
# ============================================================

@router.post("/csv/load", response_model=CsvLoadResponse)
def csv_load(req: CsvLoadRequest):
    """读取一个 CSV 文件, 解析为 ivar/dvar 不需要任何 state。"""
    path = Path(req.csv_path)
    if not path.exists():
        raise HTTPException(404, f"CSV not found: {req.csv_path}")
    try:
        if req.curve_type == "idvg":
            sd = load_idvg_csv(path)
        elif req.curve_type == "idvd":
            sd = load_idvd_csv(path)
        elif req.curve_type == "cv":
            sd = load_cv_csv(path)
        elif req.curve_type == "qg":
            sd = load_qg_csv(path)
        elif req.curve_type == "body_diode":
            sd = load_body_diode_csv(path)
        else:
            raise HTTPException(400, f"Unknown curve_type: {req.curve_type}")
    except Exception as e:
        raise HTTPException(400, f"Failed to parse CSV: {e}")

    return CsvLoadResponse(
        curve_type=sd.curve_type,
        ivar=sd.ivar.tolist(),
        dvar=sd.dvar.tolist(),
        metadata=sd.metadata,
    )


@router.post("/csv/export_model", response_model=ExportResponse)
def csv_export_model(req: CsvExportModelRequest):
    """Export the current Workbench parameter set without requiring project state."""
    out_path = Path(req.output_path).resolve()
    if out_path.suffix.lower() != ".lib":
        raise HTTPException(400, f"Expected .lib extension, got: {out_path.suffix}")
    if not out_path.parent.is_dir():
        raise HTTPException(400, f"Output directory does not exist: {out_path.parent}")
    if not req.params:
        raise HTTPException(400, "params is required")

    model = BSIM3Model(name=req.model_name or "BSIM3_core")
    for name, value in req.params.items():
        try:
            value_f = float(value)
            if not np.isfinite(value_f):
                raise ValueError(f"{value} is not finite")
            model.set_unchecked(name, value_f)
        except KeyError:
            continue
        except (TypeError, ValueError) as e:
            raise HTTPException(400, f"Invalid parameter {name}: {e}")

    exporter = LibExporter(part_number=req.subckt_name or "Workbench")
    try:
        fmt = str(req.format).upper()
        if fmt in ("A", "BSIM3"):
            path = exporter.export_bsim3(model, out_path, model_name=req.model_name or model.name)
        else:
            path = exporter.export_subckt(
                model,
                out_path,
                subckt_name=req.subckt_name or "MY_MOSFET",
                include_diode=req.include_diode,
                rg_ohm=req.rg_ohm,
                power_params=_power_params_from_request(req),
            )
    except Exception as e:
        raise HTTPException(500, f"Export failed: {e}")

    n_bytes = path.stat().st_size if path.exists() else 0
    return ExportResponse(success=True, file_path=str(path.resolve()), n_bytes=n_bytes)


@router.post("/csv/simulate", response_model=CsvSimulateResponse)
def csv_simulate(req: CsvSimulateRequest):
    """读取 CSV → 构造默认模型 → 给定 param_overrides → LTspice 仿真 sim。"""
    path = Path(req.csv_path)
    if not path.exists():
        raise HTTPException(404, f"CSV not found: {req.csv_path}")

    # 读实测数据
    try:
        if req.curve_type == "idvg":
            sd = load_idvg_csv(path)
        else:
            sd = load_idvd_csv(path)
    except Exception as e:
        raise HTTPException(400, f"Failed to parse CSV: {e}")

    # 构造全新 BSIM3Model (用 key_params 默认, 但 dataset.key_params 不可用 → 全部默认)
    model = BSIM3Model(name="EVAL")
    # 没法接 init_from_key_params（没数据集），改用 BSIM3Model 默认值
    for name, val in req.param_overrides.items():
        try:
            model.set(name, float(val))
        except (KeyError, ValueError, TypeError):
            pass

    # LTspice 评估
    try:
        ev = LTspiceEvaluator(
            subckt_name="MY_MOSFET",
            rg_ohm=1.6,
            verbose=False,
            power_params=_evaluator_power_params_from_request(req),
        )
        if req.curve_type == "idvg":
            sim_arr = ev.eval_idvg(model, sd.ivar, vds=req.vds)
        else:
            sim_arr = ev.eval_idvd(model, sd.ivar, vgs=req.vgs_v, vds_max=req.vds_max)
    except Exception as e:
        raise HTTPException(500, f"LTspice simulate failed: {e}")

    return CsvSimulateResponse(
        curve_type=req.curve_type,
        ivar=sd.ivar.tolist(),
        sim=sim_arr.tolist(),
        meas=sd.dvar.tolist(),
        metadata={"vds_v": req.vds, "vgs_v": req.vgs_v, "param_overrides": req.param_overrides},
    )


@router.post("/csv/fit/stream")
def csv_fit_stream(req: CsvFitRequest):
    """流式拟合: 边拟合边 yield history step, 最后 yield 最终结果。NDJSON 格式。"""
    import json
    import threading

    # 准备数据
    try:
        sd = load_idvg_csv(Path(req.csv_path))
    except Exception as e:
        raise HTTPException(400, f"Failed to parse CSV: {e}")

    sd_range = sd.filter_range(req.vmin, req.vmax)
    if sd_range.ivar.size == 0:
        raise HTTPException(400, f"No data in range [{req.vmin}, {req.vmax}]")
    sd.metadata["vmin"] = req.vmin
    sd.metadata["vmax"] = req.vmax
    sd.metadata["vds_v"] = req.vds
    sd.metadata["loss_weight"] = 1.0
    protected_sds = _load_protection_idvg_curves(req)

    model = BSIM3Model(name="EVAL")
    _apply_param_bounds(model, req.param_bounds)
    _apply_initial_params(model, req.initial_params)
    sim = LTspiceEvaluator(
        subckt_name="MY_MOSFET",
        rg_ohm=1.6,
        verbose=False,
        power_params=_evaluator_power_params_from_request(req),
    )

    stage = Stage(
        name="CsvFitStream",
        simdata=[sd] + protected_sds,
        param_names=req.param_names,
        model=model,
        error_func="log",
        simulator=sim,
        history_interval=req.history_interval,
        stop_r2_log=_csv_r2_stop_from_request(req)[0],
        stop_r2_linear=_csv_r2_stop_from_request(req)[1],
    )

    # 队列: 跨线程通信
    queue: queue_module.Queue = queue_module.Queue()

    def on_history(entry: dict) -> None:
        # 简化 entry (大数组转 NDJSON 不能太啰嗦)
        compact = {
            "kind": "step",
            "step": entry["step"],
            "params": entry["params"],
            "sim": entry["sim_curves"][sd.name] if sd.name in entry["sim_curves"] else [],
            "r2": entry["r2_linear"].get(sd.name, 0.0),
            "r2_linear": entry["r2_linear"].get(sd.name, 0.0),
            "r2_log": entry.get("r2_log", {}).get(sd.name, 0.0),
            "ftol_metric": entry.get("ftol_metric", 0.0),
            "xtol_metric": entry.get("xtol_metric", 0.0),
            "gtol_metric": entry.get("gtol_metric", 0.0),
            "fit_rms": entry.get("fit_rms", 0.0),
            "bound_events": entry.get("bound_events", []),
        }
        queue.put(("step", compact))

    stage.add_history_listener(on_history)

    # 后台跑优化
    def run_fit():
        try:
            opt = _csv_optimizer_from_request(req)
            result = stage.run(opt)
            sim_full = sim.eval_idvg(model, sd.ivar, vds=req.vds)
            arr_meas = np.asarray(sd.dvar, dtype=float)
            arr_sim = np.asarray(sim_full, dtype=float)
            valid = (arr_meas > 0) & np.isfinite(arr_sim)
            if valid.sum() > 1:
                ss_r = float(np.sum((arr_sim[valid] - arr_meas[valid]) ** 2))
                ss_t = float(np.sum((arr_meas[valid] - arr_meas[valid].mean()) ** 2))
                r2_lin = max(0.0, 1.0 - ss_r / ss_t) if ss_t > 0 else 0.0
            else:
                r2_lin = 0.0
            last_hist = stage.history[-1] if stage.history else {}
            final = {
                "step": -1,
                "kind": "final",
                "fitted_params": {k: float(v) for k, v in result.fitted_params.items()},
                "sim": sim_full.tolist(),
                "meas": sd.dvar.tolist(),
                "ivar": sd.ivar.tolist(),
                "r2_linear": r2_lin,
                "r2": float(result.r_squared) if not np.isnan(result.r_squared) else 0.0,
                "r2_log": float(result.r_squared) if not np.isnan(result.r_squared) else 0.0,
                "rms": float(result.rms) if not np.isnan(result.rms) else 0.0,
                "ftol_metric": last_hist.get("ftol_metric", 0.0),
                "xtol_metric": last_hist.get("xtol_metric", 0.0),
                "gtol_metric": last_hist.get("gtol_metric", 0.0),
                "fit_rms": last_hist.get("fit_rms", result.rms if not np.isnan(result.rms) else 0.0),
                "iterations": int(result.iterations),
                "nfev": int(result.nfev),
                "success": bool(result.success),
                "optimizer_message": result.message,
                "bound_events": stage.bound_events,
            }
            queue.put(("final", final))
        except Exception as e:
            queue.put(("error", {"kind": "error", "step": -1, "error": str(e)}))

    thread = threading.Thread(target=run_fit, daemon=True)
    thread.start()

    def gen():
        while True:
            kind, payload = queue.get()
            yield json.dumps(payload) + "\n"
            if kind in ("final", "error"):
                break

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@router.post("/csv/fit", response_model=CsvFitResponse)
def csv_fit(req: CsvFitRequest):
    """读 CSV → 区间拟合 [vmin, vmax] → 返回最优参数 + 仿真曲线。"""
    path = Path(req.csv_path)
    if not path.exists():
        raise HTTPException(404, f"CSV not found: {req.csv_path}")

    if req.curve_type != "idvg":
        raise HTTPException(400, "csv/fit 仅支持 idvg")

    try:
        sd = load_idvg_csv(path)
    except Exception as e:
        raise HTTPException(400, f"Failed to parse CSV: {e}")

    # 区间过滤
    sd_range = sd.filter_range(req.vmin, req.vmax)
    if sd_range.ivar.size == 0:
        raise HTTPException(400, f"No data in range [{req.vmin}, {req.vmax}]")
    sd.metadata["vmin"] = req.vmin
    sd.metadata["vmax"] = req.vmax
    sd.metadata["vds_v"] = req.vds
    sd.metadata["loss_weight"] = 1.0
    protected_sds = _load_protection_idvg_curves(req)

    model = BSIM3Model(name="EVAL")
    _apply_param_bounds(model, req.param_bounds)
    _apply_initial_params(model, req.initial_params)
    sim = LTspiceEvaluator(
        subckt_name="MY_MOSFET",
        rg_ohm=1.6,
        verbose=False,
        power_params=_evaluator_power_params_from_request(req),
    )

    stage = Stage(
        name="CsvFit",
        simdata=[sd] + protected_sds,
        param_names=req.param_names,
        model=model,
        error_func="log",
        simulator=sim,
        history_interval=req.history_interval,
        stop_r2_log=_csv_r2_stop_from_request(req)[0],
        stop_r2_linear=_csv_r2_stop_from_request(req)[1],
    )

    opt = _csv_optimizer_from_request(req)
    result = stage.run(opt)

    # 用最终模型跑全段仿真
    sim_full = sim.eval_idvg(model, sd.ivar, vds=req.vds)

    # 全段 linear R² (基于全段 ivar/sim/meas, 不只是拟合区间)
    arr_meas = np.asarray(sd.dvar, dtype=float)
    arr_sim = np.asarray(sim_full, dtype=float)
    valid = (arr_meas > 0) & np.isfinite(arr_sim) & np.isfinite(arr_meas)
    if valid.sum() > 1:
        ss_res = float(np.sum((arr_sim[valid] - arr_meas[valid]) ** 2))
        ss_tot = float(np.sum((arr_meas[valid] - arr_meas[valid].mean()) ** 2))
        r2_full_linear = max(0.0, 1.0 - ss_res / ss_tot) if ss_tot > 0 else 0.0
    else:
        r2_full_linear = 0.0

    # 把 history 转成响应格式
    history_resp = []
    for h in stage.history:
        # h["sim_curves"] 是 dict[name -> list], 单条曲线
        sim_list = []
        for sd in stage.simdata:
            if sd.name in h["sim_curves"]:
                sim_list = h["sim_curves"][sd.name]
                break
        r2_lin = 0.0
        r2_log = 0.0
        for sd in stage.simdata:
            if sd.name in h["r2_linear"]:
                r2_lin = h["r2_linear"][sd.name]
                break
        for sd in stage.simdata:
            if sd.name in h.get("r2_log", {}):
                r2_log = h["r2_log"][sd.name]
                break
        history_resp.append({
            "step": h["step"],
            "params": h["params"],
            "sim": sim_list,
            "r2_linear": r2_lin,
            "r2_log": r2_log,
            "ftol_metric": h.get("ftol_metric", 0.0),
            "xtol_metric": h.get("xtol_metric", 0.0),
            "gtol_metric": h.get("gtol_metric", 0.0),
            "fit_rms": h.get("fit_rms", 0.0),
            "bound_events": h.get("bound_events", []),
        })

    return CsvFitResponse(
        fitted_params={k: float(v) for k, v in result.fitted_params.items()},
        ivar=sd.ivar.tolist(),
        sim=sim_full.tolist(),
        meas=sd.dvar.tolist(),
        rms=float(result.rms) if not np.isnan(result.rms) else 0.0,
        r_squared=float(result.r_squared) if not np.isnan(result.r_squared) else 0.0,
        r_squared_linear=float(r2_full_linear),
        iterations=int(result.iterations),
        nfev=int(result.nfev),
        optimizer_message=result.message,
        success=bool(result.success),
        history=history_resp,
        bound_events=stage.bound_events,
    )


@router.post("/csv/dual_fit", response_model=DualFitResponse)
def csv_dual_fit(req: DualFitRequest):
    """联合拟合: 多条 Id-Vg 曲线共享一组参数。

    每条曲线在自己的 [vmin, vmax] 内贡献 residual, 优化器最小化所有曲线
    的加权总 residual。R² 停止条件要求所有参与曲线同时达标。
    """
    if len(req.curves) < 2:
        raise HTTPException(400, "联合拟合至少需要 2 条曲线")
    if not req.param_names:
        raise HTTPException(400, "param_names 不能为空")

    sds: list[SimData] = []
    for i, c in enumerate(req.curves):
        path = Path(c.csv_path)
        if not path.exists():
            raise HTTPException(404, f"CSV not found: {c.csv_path}")
        try:
            sd = load_idvg_csv(path)
        except Exception as e:
            raise HTTPException(400, f"Failed to parse {c.csv_path}: {e}")

        if sd.filter_range(c.vmin, c.vmax).ivar.size == 0:
            raise HTTPException(400, f"No data in [{c.vmin}, {c.vmax}] in {c.csv_path}")

        sd.name = f"IdVg_joint_{i + 1}_Vds{float(c.vds):g}"
        sd.metadata["vmin"] = c.vmin
        sd.metadata["vmax"] = c.vmax
        sd.metadata["vds_v"] = c.vds
        sd.metadata["loss_weight"] = max(0.0, float(c.weight))
        sds.append(sd)

    model = BSIM3Model(name="EVAL_DUAL")
    _apply_param_bounds(model, req.param_bounds)
    _apply_initial_params(model, req.initial_params)
    sim = LTspiceEvaluator(
        subckt_name="MY_MOSFET",
        rg_ohm=1.6,
        verbose=False,
        power_params=_evaluator_power_params_from_request(req),
    )

    stage = Stage(
        name="TransferJointFit",
        simdata=sds,
        param_names=req.param_names,
        model=model,
        error_func="log",
        simulator=sim,
        history_interval=req.history_interval,
        stop_r2_log=_csv_r2_stop_from_request(req)[0],
        stop_r2_linear=_csv_r2_stop_from_request(req)[1],
        stop_r2_primary_only=False,
    )

    opt = _csv_optimizer_from_request(req)
    result = stage.run(opt)

    curve_results = []
    linear_meas_parts: list[np.ndarray] = []
    linear_sim_parts: list[np.ndarray] = []
    log_meas_parts: list[np.ndarray] = []
    log_sim_parts: list[np.ndarray] = []

    for c, sd in zip(req.curves, sds):
        sim_arr = sim.eval_idvg(model, sd.ivar, vds=c.vds)
        m = np.asarray(sd.dvar, dtype=float)
        s = np.asarray(sim_arr, dtype=float)
        mask = stage._fit_mask(sd, s)
        if mask.sum() > 1:
            r2_log = Stage._r2_score(m[mask], s[mask], domain="log")
            r2_lin = Stage._r2_score(m[mask], s[mask], domain="linear")
            linear_meas_parts.append(m[mask])
            linear_sim_parts.append(s[mask])
            positive = (m[mask] > 0) & (s[mask] > 0)
            if positive.sum() > 1:
                log_meas_parts.append(np.log10(m[mask][positive]))
                log_sim_parts.append(np.log10(s[mask][positive]))
        else:
            r2_log = 0.0
            r2_lin = 0.0
        curve_results.append({
            "csv_path": c.csv_path,
            "vds": c.vds,
            "vmin": c.vmin,
            "vmax": c.vmax,
            "weight": c.weight,
            "ivar": sd.ivar.tolist(),
            "sim": sim_arr.tolist(),
            "meas": sd.dvar.tolist(),
            "r2_log": r2_log,
            "r2_linear": r2_lin,
        })

    def pooled_r2(parts_y: list[np.ndarray], parts_fit: list[np.ndarray]) -> float:
        if not parts_y or not parts_fit:
            return 0.0
        y = np.concatenate(parts_y)
        yhat = np.concatenate(parts_fit)
        valid = np.isfinite(y) & np.isfinite(yhat)
        if valid.sum() <= 1:
            return 0.0
        yy = y[valid]
        ff = yhat[valid]
        ss_res = float(np.sum((yy - ff) ** 2))
        ss_tot = float(np.sum((yy - yy.mean()) ** 2))
        return max(0.0, 1.0 - ss_res / ss_tot) if ss_tot > 0 else 0.0

    r2_full_linear = pooled_r2(linear_meas_parts, linear_sim_parts)
    r2_full_log = pooled_r2(log_meas_parts, log_sim_parts)

    history_resp = []
    for h in stage.history:
        history_resp.append({
            "step": h["step"],
            "params": h["params"],
            "r2_log": h.get("r2_log", {}),
            "r2_linear": h.get("r2_linear", {}),
        })

    return DualFitResponse(
        fitted_params={k: float(v) for k, v in result.fitted_params.items()},
        curves=curve_results,
        rms=float(result.rms) if not np.isnan(result.rms) else 0.0,
        r_squared=float(r2_full_log),
        r_squared_linear=float(r2_full_linear),
        iterations=int(result.iterations),
        nfev=int(result.nfev),
        optimizer_message=result.message,
        success=bool(result.success),
        history=history_resp,
    )


@router.post("/csv/dual_fit/stream")
def csv_dual_fit_stream(req: DualFitRequest):
    """流式联合拟合: 每次 history step 返回所有曲线的当前 sim/R²。"""
    import json
    import threading

    if len(req.curves) < 2:
        raise HTTPException(400, "联合拟合至少需要 2 条曲线")
    if not req.param_names:
        raise HTTPException(400, "param_names 不能为空")

    sds: list[SimData] = []
    for i, c in enumerate(req.curves):
        path = Path(c.csv_path)
        if not path.exists():
            raise HTTPException(404, f"CSV not found: {c.csv_path}")
        try:
            sd = load_idvg_csv(path)
        except Exception as e:
            raise HTTPException(400, f"Failed to parse {c.csv_path}: {e}")
        if sd.filter_range(c.vmin, c.vmax).ivar.size == 0:
            raise HTTPException(400, f"No data in [{c.vmin}, {c.vmax}] in {c.csv_path}")

        sd.name = f"IdVg_joint_{i + 1}_Vds{float(c.vds):g}"
        sd.metadata["vmin"] = c.vmin
        sd.metadata["vmax"] = c.vmax
        sd.metadata["vds_v"] = c.vds
        sd.metadata["loss_weight"] = max(0.0, float(c.weight))
        sds.append(sd)

    model = BSIM3Model(name="EVAL_DUAL_STREAM")
    _apply_param_bounds(model, req.param_bounds)
    _apply_initial_params(model, req.initial_params)
    sim = LTspiceEvaluator(
        subckt_name="MY_MOSFET",
        rg_ohm=1.6,
        verbose=False,
        power_params=_evaluator_power_params_from_request(req),
    )

    stage = Stage(
        name="TransferJointFitStream",
        simdata=sds,
        param_names=req.param_names,
        model=model,
        error_func="log",
        simulator=sim,
        history_interval=max(1, int(req.history_interval or 1)),
        stop_r2_log=_csv_r2_stop_from_request(req)[0],
        stop_r2_linear=_csv_r2_stop_from_request(req)[1],
        stop_r2_primary_only=False,
    )

    queue: queue_module.Queue = queue_module.Queue()

    def compact_curves(entry: dict) -> list[dict]:
        curves = []
        for idx, (c, sd) in enumerate(zip(req.curves, sds)):
            curves.append({
                "index": idx,
                "csv_path": c.csv_path,
                "vds": c.vds,
                "vmin": c.vmin,
                "vmax": c.vmax,
                "ivar": sd.ivar.tolist(),
                "meas": sd.dvar.tolist(),
                "sim": entry.get("sim_curves", {}).get(sd.name, []),
                "r2_log": entry.get("r2_log", {}).get(sd.name, 0.0),
                "r2_linear": entry.get("r2_linear", {}).get(sd.name, 0.0),
            })
        return curves

    def on_history(entry: dict) -> None:
        queue.put(("step", {
            "kind": "step",
            "step": entry["step"],
            "params": entry["params"],
            "curves": compact_curves(entry),
            "ftol_metric": entry.get("ftol_metric", 0.0),
            "xtol_metric": entry.get("xtol_metric", 0.0),
            "gtol_metric": entry.get("gtol_metric", 0.0),
            "fit_rms": entry.get("fit_rms", 0.0),
            "bound_events": entry.get("bound_events", []),
        }))

    stage.add_history_listener(on_history)

    def run_fit():
        try:
            opt = _csv_optimizer_from_request(req)
            result = stage.run(opt)
            final_curves = []
            linear_meas_parts: list[np.ndarray] = []
            linear_sim_parts: list[np.ndarray] = []
            log_meas_parts: list[np.ndarray] = []
            log_sim_parts: list[np.ndarray] = []

            for idx, (c, sd) in enumerate(zip(req.curves, sds)):
                sim_arr = sim.eval_idvg(model, sd.ivar, vds=c.vds)
                m = np.asarray(sd.dvar, dtype=float)
                s = np.asarray(sim_arr, dtype=float)
                mask = stage._fit_mask(sd, s)
                if mask.sum() > 1:
                    r2_log = Stage._r2_score(m[mask], s[mask], domain="log")
                    r2_lin = Stage._r2_score(m[mask], s[mask], domain="linear")
                    linear_meas_parts.append(m[mask])
                    linear_sim_parts.append(s[mask])
                    positive = (m[mask] > 0) & (s[mask] > 0)
                    if positive.sum() > 1:
                        log_meas_parts.append(np.log10(m[mask][positive]))
                        log_sim_parts.append(np.log10(s[mask][positive]))
                else:
                    r2_log = 0.0
                    r2_lin = 0.0
                final_curves.append({
                    "index": idx,
                    "csv_path": c.csv_path,
                    "vds": c.vds,
                    "vmin": c.vmin,
                    "vmax": c.vmax,
                    "weight": c.weight,
                    "ivar": sd.ivar.tolist(),
                    "sim": sim_arr.tolist(),
                    "meas": sd.dvar.tolist(),
                    "r2_log": r2_log,
                    "r2_linear": r2_lin,
                })

            def pooled_r2(parts_y: list[np.ndarray], parts_fit: list[np.ndarray]) -> float:
                if not parts_y or not parts_fit:
                    return 0.0
                y = np.concatenate(parts_y)
                yhat = np.concatenate(parts_fit)
                valid = np.isfinite(y) & np.isfinite(yhat)
                if valid.sum() <= 1:
                    return 0.0
                yy = y[valid]
                ff = yhat[valid]
                ss_res = float(np.sum((yy - ff) ** 2))
                ss_tot = float(np.sum((yy - yy.mean()) ** 2))
                return max(0.0, 1.0 - ss_res / ss_tot) if ss_tot > 0 else 0.0

            last_hist = stage.history[-1] if stage.history else {}
            queue.put(("final", {
                "kind": "final",
                "step": -1,
                "fitted_params": {k: float(v) for k, v in result.fitted_params.items()},
                "curves": final_curves,
                "rms": float(result.rms) if not np.isnan(result.rms) else 0.0,
                "r_squared": pooled_r2(log_meas_parts, log_sim_parts),
                "r_squared_linear": pooled_r2(linear_meas_parts, linear_sim_parts),
                "iterations": int(result.iterations),
                "nfev": int(result.nfev),
                "success": bool(result.success),
                "optimizer_message": result.message,
                "ftol_metric": last_hist.get("ftol_metric", 0.0),
                "xtol_metric": last_hist.get("xtol_metric", 0.0),
                "gtol_metric": last_hist.get("gtol_metric", 0.0),
                "fit_rms": last_hist.get("fit_rms", result.rms if not np.isnan(result.rms) else 0.0),
                "bound_events": stage.bound_events,
            }))
        except Exception as e:
            queue.put(("error", {"kind": "error", "step": -1, "error": str(e)}))

    thread = threading.Thread(target=run_fit, daemon=True)
    thread.start()

    def gen():
        while True:
            kind, payload = queue.get()
            yield json.dumps(payload) + "\n"
            if kind in ("final", "error"):
                break

    return StreamingResponse(gen(), media_type="application/x-ndjson")
