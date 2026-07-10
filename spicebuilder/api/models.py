"""Pydantic models for API requests/responses."""
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict, Any, Literal
from dataclasses import field


class LoadProjectRequest(BaseModel):
    """Request payload for POST /projects/load."""
    excel_path: str = Field(..., description="Absolute path to the SDH-format Excel file (must end with .xlsx)")
    name: Optional[str] = Field(None, description="Optional display name; defaults to device part number")

    @field_validator('excel_path')
    @classmethod
    def _excel_path_must_be_xlsx(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('excel_path is required')
        if not v.lower().endswith('.xlsx'):
            raise ValueError(f'excel_path must end with .xlsx, got: {v}')
        return v


class FitOptimizerConfig(BaseModel):
    """Per-stage optimizer configuration passed to scipy.least_squares."""
    method: str = Field("trf", description="Optimization method: trf | dogbox | lm")
    eps1: float = Field(1e-3, description="Tolerance on parameter vector jacobian")
    eps2: float = Field(1e-3, description="Tolerance on cost function")
    eps3: float = Field(1e-3, description="Tolerance on orthogonal distance")
    max_iter: int = Field(30, description="Maximum optimizer iterations per stage")
    parallel_jobs: int = Field(1, description="Number of parallel jobs (1 = serial)")


class FitRequest(BaseModel):
    """Request payload for POST /projects/{id}/fit."""
    stages: List[str] = Field(default_factory=lambda: ["S1", "S2", "S3", "S4", "S5", "S6"], description="Subset of BSIM3 stages to run, e.g. ['S1', 'S2']")
    max_loops: int = Field(3, description="Maximum outer-loop iterations across all stages")
    error_threshold: float = Field(10.0, description="Stop if total RMS falls below this threshold")
    use_ltspice: bool = Field(True, description="Use real LTspice XVII simulator as objective function (falls back to simplified BSIM3 formula if LTspice is not installed)")
    optimizer: FitOptimizerConfig = Field(default_factory=FitOptimizerConfig, description="Optimizer hyperparameters")


class PowerMOSSubcktParamsRequest(BaseModel):
    """Power MOSFET subckt wrapper parameters outside the BSIM3 core."""
    include_diode: bool = Field(True, description="Include body diode model in the wrapper")
    rg_ohm: float = Field(1.6, description="External gate resistance in Ohms")
    rd_ext_ohm: Optional[float] = Field(None, description="External drain resistance; None = use BSIM RD")
    rs_ext_ohm: Optional[float] = Field(None, description="External source resistance; None = use BSIM RS")
    rdrift_ohm: float = Field(0.0, description="Optional drift-region series resistance")
    rjfet_ohm: float = Field(0.0, description="Optional JFET-region series resistance")
    cell_count: int = Field(20000, description="Equivalent parallel cell count")
    cell_w_m: float = Field(0.2, description="Single-cell channel width in meters")
    active_area_mm2: float = Field(10.0, description="Active area in mm^2")
    cell_pitch_um: float = Field(2.0, description="Cell pitch in micrometers")


class CapTableRequest(BaseModel):
    """Voltage-dependent capacitance table used by the CV wrapper."""
    name: str
    voltage_v: List[float] = Field(default_factory=list)
    capacitance_pf: List[float] = Field(default_factory=list)
    charge_pc: List[float] = Field(default_factory=list)


class PowerCapWrapperRequest(BaseModel):
    """Residual behavioral capacitance wrapper."""
    enabled: bool = True
    mode: str = "residual"
    cgs: Optional[CapTableRequest] = None
    cgd: Optional[CapTableRequest] = None
    cds: Optional[CapTableRequest] = None


class ExportRequest(BaseModel):
    """Request payload for POST /projects/{id}/export."""
    format: str = Field("B", description="A: pure BSIM3 .model, B: .subckt wrapper")
    output_path: str = Field(..., description="Absolute output file path (must end with .lib)")
    rg_ohm: float = Field(1.6, description="Gate resistance in Ohms")
    rd_ohm: Optional[float] = Field(None, description="Override RD in Ohms (None = use fitted)")
    rs_ohm: Optional[float] = Field(None, description="Override RS in Ohms (None = use fitted)")
    include_diode: bool = Field(True, description="Include body diode subcircuit")
    power_params: Optional[PowerMOSSubcktParamsRequest] = Field(None, description="Subckt-level Power MOS parameters")

    @field_validator('format')
    @classmethod
    def _format_must_be_known(cls, v: str) -> str:
        u = v.upper()
        if u not in ('A', 'B'):
            raise ValueError(f'format must be A or B, got: {v}')
        return u

    @field_validator('output_path')
    @classmethod
    def _output_path_must_be_lib(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('output_path is required')
        if not v.lower().endswith('.lib'):
            raise ValueError(f'output_path must end with .lib, got: {v}')
        return v


class CsvExportModelRequest(BaseModel):
    """Stateless export: current Workbench params -> SPICE .lib."""
    output_path: str = Field(..., description="Absolute output file path (must end with .lib)")
    format: Literal["subckt", "bsim3", "B", "A"] = Field("subckt")
    subckt_name: str = Field("MY_MOSFET")
    model_name: str = Field("BSIM3_core")
    params: Dict[str, float] = Field(default_factory=dict)
    power_params: Optional[PowerMOSSubcktParamsRequest] = Field(None)
    cap_wrapper: Optional[PowerCapWrapperRequest] = Field(None)
    include_diode: bool = Field(True)
    rg_ohm: float = Field(1.6)

    @field_validator('output_path')
    @classmethod
    def _csv_output_path_must_be_lib(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('output_path is required')
        if not v.lower().endswith('.lib'):
            raise ValueError(f'output_path must end with .lib, got: {v}')
        return v


class HealthResponse(BaseModel):
    """Response payload for GET /health."""
    status: str = Field(..., description="'ok' when the server is alive")
    version: str = Field(..., description="SpiceBuilder API version (semver)")
    n_projects: int = Field(..., description="Number of projects currently held in process state")
    n_tasks: int = Field(..., description="Number of fit/export tasks currently tracked")


class LoadProjectResponse(BaseModel):
    """Response payload for POST /projects/load."""
    project_id: str = Field(..., description="UUID of the created project (use for subsequent API calls)")
    name: str = Field(..., description="Display name (defaults to device part number)")
    device_info: Dict[str, Any] = Field(..., description="Top-level device metadata: part_number, package, BV, RDSon, Id, Vth")
    key_params: Dict[str, Any] = Field(..., description="Key SPICE-derivable parameters: Vth, RDSon at 3 temps, Qg, Ciss/Coss/Crss, Rg")
    curve_counts: Dict[str, Any] = Field(..., description="Number of points per curve family loaded from the Excel")


class FitResponse(BaseModel):
    """Response payload for POST /projects/{id}/fit."""
    task_id: str = Field(..., description="UUID of the fit task (poll via GET /tasks/{task_id})")
    project_id: str = Field(..., description="Echo of the project_id submitted")
    status: str = Field(..., description="Initial task status (always 'queued' on first submit)")
    message: str = Field("", description="Optional human-readable note")

class TaskInfo(BaseModel):
    """Response payload for GET /tasks/{task_id}."""
    id: str = Field(..., description="UUID of the task")
    type: str = Field(..., description="Task type: 'fit'")
    status: str = Field(..., description="queued | running | completed | failed")
    progress: float = Field(..., description="0.0 to 1.0 progress within the task")
    current_stage: str = Field("", description="Name of the most recently entered or completed stage")
    current_loop: int = Field(0, description="1-based current outer loop index")
    result: Dict[str, Any] = Field(default_factory=dict, description="Populated when status='completed' (total_rms, iterations, stages)")
    error: str = Field("", description="Populated when status='failed'")
    created_at: str = Field(..., description="ISO 8601 timestamp")


class ModelParamInfo(BaseModel):
    """A single BSIM3 parameter returned by GET /projects/{id}/model."""
    name: str = Field(..., description="BSIM3 parameter name (e.g. VTH0, U0, VSAT)")
    value: float = Field(..., description="Current parameter value (initial or fitted)")
    initial: float = Field(..., description="Initial-guess value before fitting")
    fitted: bool = Field(..., description="True if the parameter was touched by any fit stage")
    category: str = Field(..., description="Threshold | Mobility | Saturation | ChanLenMod | Capacitance | Junction | Temperature | Diode | Process")
    stage: str = Field(..., description="Fit stage that owns this parameter (S1..S6)")
    unit: str = Field("", description="Engineering unit (V, cm^2/Vs, F/m, ...)")
    description: str = Field("", description="Human-readable parameter description")


class ProjectModelResponse(BaseModel):
    """Response payload for GET /projects/{id}/model."""
    project_id: str = Field(..., description="Echo of the project_id")
    n_params: int = Field(..., description="Total number of BSIM3 parameters tracked")
    n_fitted: int = Field(..., description="Number of parameters that have been fitted by at least one stage")
    params: List[ModelParamInfo] = Field(..., description="Per-parameter info")


class ExportResponse(BaseModel):
    """Response payload for POST /projects/{id}/export."""
    success: bool = Field(..., description="True if export wrote a file")
    file_path: str = Field(..., description="Absolute path to the written .lib file")
    n_bytes: int = Field(0, description="File size in bytes (0 if the write reported success but file missing)")


class CurveResponse(BaseModel):
    """Response payload for GET /projects/{id}/curves/{type}."""
    name: str = Field(..., description="Curve family name")
    curve_type: str = Field(..., description="idvg | idvd | cv | body_diode")
    # `data['fit']` may be None when no fit has been run on this project;
    # other entries are always populated.  Use Optional[List[float]] so a
    # missing fit does not 500 the endpoint.
    data: Dict[str, Optional[List[float]]] = Field(..., description="Sweep variable, response columns, and an optional 'fit' (None if no fit has run)")
    metadata: Dict[str, Any] = Field(..., description="Optional metadata: test conditions, units, source")


class SimulateRequest(BaseModel):
    """Request payload for POST /projects/{id}/simulate."""
    curve_type: Literal["idvg", "idvd"] = Field(..., description="Curve type to simulate")
    param_overrides: Dict[str, float] = Field(
        default_factory=dict,
        description="BSIM3 param name -> value overrides to apply before simulation"
    )
    vds: float = Field(5.0, description="Vds bias (V) for Id-Vg sweep")
    vgs_v: float = Field(10.0, description="Fixed Vgs bias (V) for Id-Vd sweep")
    vds_max: float = Field(12.0, description="Max Vds (V) for Id-Vd sweep")
    power_params: Optional[PowerMOSSubcktParamsRequest] = Field(None, description="Subckt-level Power MOS parameters")


class SimulateResponse(BaseModel):
    """Response payload for POST /projects/{id}/simulate."""
    curve_type: str = Field(..., description="Echo of requested curve type")
    ivar: List[float] = Field(..., description="Sweep variable values (Vgs for idvg, Vds for idvd)")
    sim: List[float] = Field(..., description="Simulated Id values (A)")
    meas: List[float] = Field(..., description="Measured Id values (A), same length as ivar")
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="vds_v, vgs_v, temperature_c, ltspice_available"
    )


class FitSingleRequest(BaseModel):
    """Request payload for POST /projects/{id}/fit_single."""
    curve_type: Literal["idvg", "idvd"] = Field(..., description="Curve type to fit")
    param_names: List[str] = Field(..., description="Parameters to optimize (e.g. ['VTH0', 'U0'])")
    vmin: float = Field(..., description="Lower bound of fit range")
    vmax: float = Field(..., description="Upper bound of fit range")
    vds: float = Field(5.0, description="Vds bias (V) for IdVg")
    vgs_v: float = Field(10.0, description="Fixed Vgs for IdVd")
    power_params: Optional[PowerMOSSubcktParamsRequest] = Field(None, description="Subckt-level Power MOS parameters")


class FitSingleResponse(BaseModel):
    """Response payload for POST /projects/{id}/fit_single."""
    fitted_params: Dict[str, float] = Field(..., description="Optimized values for the requested params")
    ivar: List[float] = Field(..., description="Full Vgs/Vds grid")
    sim: List[float] = Field(..., description="Full simulated curve")
    meas: List[float] = Field(..., description="Measured curve")
    rms: float = Field(..., description="Root mean square of fit error on interval")
    r_squared: float = Field(..., description="R² (对数域)")
    r_squared_linear: float = Field(0.0, description="R² (线性域)")
    iterations: int = Field(0)
    nfev: int = Field(0, description="Number of objective function evaluations")
    optimizer_message: str = Field("", description="Optimizer stop reason")
    success: bool = True


class LoadCsvRequest(BaseModel):
    """Request payload for POST /projects/{id}/load_csv."""
    csv_path: str = Field(..., description="Absolute path to the CSV file")
    curve_type: Literal["idvg", "idvd", "bv", "cv", "qg", "body_diode"] = Field("idvg")
    bv_kind: Literal["bvdss", "bvgss_p", "bvgss_n"] = Field("bvdss")
    cap_type: Literal["ciss", "coss", "crss"] = Field("ciss")


class LoadCsvResponse(BaseModel):
    curve_type: str
    ivar: List[float]
    dvar: List[float]
    metadata: Dict[str, Any] = field(default_factory=dict)


class CsvLoadRequest(BaseModel):
    """Stateless CSV load: 只读 CSV, 不需要 project state。"""
    csv_path: str = Field(..., description="Absolute path to the CSV file")
    curve_type: Literal["idvg", "idvd", "bv", "cv", "qg", "body_diode"] = Field("idvg")
    bv_kind: Literal["bvdss", "bvgss_p", "bvgss_n"] = Field("bvdss")
    cap_type: Literal["ciss", "coss", "crss"] = Field("ciss")


class CsvSimulateRequest(BaseModel):
    """Stateless simulate: 给定 CSV + 参数覆盖, 跑 LTspice 返回 sim+meas。"""
    csv_path: str = Field(..., description="CSV path")
    curve_type: Literal["idvg", "idvd", "bv", "cv"] = Field("idvg")
    bv_kind: Literal["bvdss", "bvgss_p", "bvgss_n"] = Field("bvdss")
    cap_type: Literal["ciss", "coss", "crss"] = Field("ciss")
    param_overrides: Dict[str, float] = Field(default_factory=dict)
    vds: float = Field(0.5)
    vgs_v: float = Field(10.0)
    vds_max: float = Field(12.0)
    power_params: Optional[PowerMOSSubcktParamsRequest] = Field(None)
    cap_wrapper: Optional[PowerCapWrapperRequest] = Field(None)


class CsvLoadResponse(BaseModel):
    curve_type: str
    ivar: List[float]
    dvar: List[float]
    metadata: Dict[str, Any] = field(default_factory=dict)


class CsvSimulateResponse(BaseModel):
    curve_type: str
    ivar: List[float]
    sim: List[float]
    meas: List[float]
    metadata: Dict[str, Any] = field(default_factory=dict)


class CsvFitStopConfig(BaseModel):
    """User-tunable termination conditions for SingleFit CSV optimization."""
    r2_log: float = Field(0.99, description="Stop when log-domain R² reaches this value")
    r2_linear: float = Field(0.99, description="Stop when linear-domain R² reaches this value")
    ftol: float = Field(1e-6, description="Stop when objective improvement is below this tolerance")
    xtol: float = Field(1e-6, description="Stop when parameter update is below this tolerance")
    gtol: float = Field(1e-6, description="Stop when gradient norm is below this tolerance")
    max_nfev: int = Field(120, description="Maximum main objective evaluations")


class CsvFitRequest(BaseModel):
    """Stateless fit: 区间拟合单个 CSV。"""
    csv_path: str = Field(..., description="CSV path")
    curve_type: Literal["idvg", "idvd", "bv", "cv"] = Field("idvg")
    bv_kind: Literal["bvdss", "bvgss_p", "bvgss_n"] = Field("bvdss")
    cap_type: Literal["ciss", "coss", "crss"] = Field("ciss")
    param_names: List[str]
    param_bounds: Dict[str, List[float]] = Field(default_factory=dict)
    initial_params: Dict[str, float] = Field(default_factory=dict)
    protect_curves: List[Dict[str, Any]] = Field(default_factory=list)
    vmin: float
    vmax: float
    vds: float = Field(0.5)
    vgs_v: float = Field(10.0)
    vds_max: float = Field(12.0)
    history_interval: int = Field(0, description="每 N 步记录一次 history (0=不记录, 1=每步都记)")
    power_params: Optional[PowerMOSSubcktParamsRequest] = Field(None)
    stop: CsvFitStopConfig = Field(default_factory=CsvFitStopConfig)


class CsvFitHistoryPoint(BaseModel):
    """单步拟合状态 (用于前端实时动画展示收敛过程)"""
    step: int
    params: Dict[str, float]
    sim: List[float]  # 区间内的仿真曲线
    r2_linear: float
    r2_log: float = 0.0
    ftol_metric: float = 0.0
    xtol_metric: float = 0.0
    gtol_metric: float = 0.0
    fit_rms: float = 0.0
    bound_events: List[Dict[str, Any]] = []


class CsvFitResponse(BaseModel):
    fitted_params: Dict[str, float]
    ivar: List[float]
    sim: List[float]
    meas: List[float]
    rms: float
    r_squared: float
    r_squared_linear: float = 0.0  # 线性域 R² (用户可看直观误差)
    iterations: int = 0
    nfev: int = 0
    optimizer_message: str = ""
    success: bool = True
    history: List[CsvFitHistoryPoint] = []  # 收敛轨迹 (空列表=不记录)
    bound_events: List[Dict[str, Any]] = []


class CurveSpec(BaseModel):
    """联合拟合中的一条曲线规格"""
    csv_path: str = Field(..., description="CSV 路径")
    curve_type: Literal["idvg", "idvd", "bv", "cv"] = Field("idvg", description="曲线类型")
    bv_kind: Literal["bvdss", "bvgss_p", "bvgss_n"] = Field("bvdss", description="BV step type")
    cap_type: Literal["ciss", "coss", "crss"] = Field("ciss", description="CV capacitance type")
    vds: float = Field(0.5, description="IdVg 曲线的 Vds 偏置 (V)")
    vgs_v: float = Field(10.0, description="IdVd 曲线的 Vgs 偏置 (V)")
    vds_max: float = Field(12.0, description="IdVd sweep 的最大 Vds (V)")
    vmin: float = Field(..., description="拟合区间下限")
    vmax: float = Field(..., description="拟合区间上限")
    weight: float = Field(1.0, description="该曲线在联合 residual 中的权重")


class DualFitRequest(BaseModel):
    """联合拟合: 多条曲线共享参数。"""
    curves: List[CurveSpec] = Field(..., description="至少 2 条曲线")
    param_names: List[str]
    param_bounds: Dict[str, List[float]] = Field(default_factory=dict)
    initial_params: Dict[str, float] = Field(default_factory=dict)
    history_interval: int = Field(0)
    power_params: Optional[PowerMOSSubcktParamsRequest] = Field(None)
    stop: CsvFitStopConfig = Field(default_factory=CsvFitStopConfig)


class DualFitResponse(BaseModel):
    fitted_params: Dict[str, float]
    # 每条曲线的 sim/meas/ivar/r2 全段
    curves: List[Dict] = []  # [{ivar, sim, meas, r2_linear, vds, vmin, vmax}, ...]
    rms: float
    r_squared: float              # log 域, 全曲线池化
    r_squared_linear: float       # linear 域, 全曲线池化
    iterations: int = 0
    nfev: int = 0
    optimizer_message: str = ""
    success: bool = True
    history: List[Dict] = []      # [{step, params, r2_linear_per_curve}, ...]


class CvWrapperCurveSpec(BaseModel):
    csv_path: str
    cap_type: Literal["ciss", "coss", "crss"] = "ciss"
    weight: float = 1.0


class CsvCvWrapperFitRequest(BaseModel):
    """Build a residual behavioral CV wrapper from loaded Ciss/Coss/Crss CSVs."""
    curves: List[CvWrapperCurveSpec] = Field(default_factory=list)
    csv_path: Optional[str] = Field(None, description="Fallback single CSV path")
    cap_type: Literal["ciss", "coss", "crss"] = "ciss"
    params: Dict[str, float] = Field(default_factory=dict)
    power_params: Optional[PowerMOSSubcktParamsRequest] = Field(None)


class CsvCvWrapperFitResponse(BaseModel):
    cap_wrapper: Dict[str, Any]
    curves: List[Dict[str, Any]] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    """Generic error envelope returned by FastAPI's HTTPException path."""
    error: str = Field(..., description="Short error code or message")
    detail: str = Field("", description="Long-form stack trace or extended explanation")
