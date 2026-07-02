"""FastAPI routes for SpiceBuilder."""
from datetime import datetime
from typing import Optional
import asyncio
import os
import uuid
from pathlib import Path
import numpy as np

from fastapi import APIRouter, HTTPException

from .state import state, Project, Task
from .models import (
    LoadProjectRequest, FitRequest, ExportRequest,
    LoadProjectResponse, FitResponse, TaskInfo, ProjectModelResponse,
    ExportResponse, CurveResponse, ModelParamInfo, HealthResponse,
    SimulateRequest, SimulateResponse, FitSingleRequest, FitSingleResponse,
    LoadCsvRequest, LoadCsvResponse,
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
from spicebuilder.fitting.optimizer import Optimizer
from spicebuilder.fitting.stage import Stage
from spicebuilder.strategy.sgt_6stage import build_sgt_engine
from spicebuilder.models.exporter import LibExporter
from spicebuilder.simulator.evaluator import LTspiceEvaluator

router = APIRouter()


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
        evaluator = LTspiceEvaluator(subckt_name="SDH10N2P1", rg_ohm=1.6, verbose=False)
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
        simulator=LTspiceEvaluator(subckt_name="SDH10N2P1", rg_ohm=1.6, verbose=False),
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
        iterations=int(result.iterations),
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
