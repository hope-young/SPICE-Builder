"""Pydantic models for API requests/responses."""
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict, Any


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


class ExportRequest(BaseModel):
    """Request payload for POST /projects/{id}/export."""
    format: str = Field("B", description="A: pure BSIM3 .model, B: .subckt wrapper")
    output_path: str = Field(..., description="Absolute output file path (must end with .lib)")
    rg_ohm: float = Field(1.6, description="Gate resistance in Ohms")
    rd_ohm: Optional[float] = Field(None, description="Override RD in Ohms (None = use fitted)")
    rs_ohm: Optional[float] = Field(None, description="Override RS in Ohms (None = use fitted)")
    include_diode: bool = Field(True, description="Include body diode subcircuit")

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
    data: Dict[str, List[float]] = Field(..., description="Sweep variable and response columns (e.g. {'vgs': [...], 'id_25c': [...]})")
    metadata: Dict[str, Any] = Field(..., description="Optional metadata: test conditions, units, source")


class ErrorResponse(BaseModel):
    """Generic error envelope returned by FastAPI's HTTPException path."""
    error: str = Field(..., description="Short error code or message")
    detail: str = Field("", description="Long-form stack trace or extended explanation")
