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
    method: str = "trf"
    eps1: float = 1e-3
    eps2: float = 1e-3
    eps3: float = 1e-3
    max_iter: int = 30
    parallel_jobs: int = 1


class FitRequest(BaseModel):
    stages: List[str] = Field(default_factory=lambda: ["S1", "S2", "S3", "S4", "S5", "S6"])
    max_loops: int = 3
    error_threshold: float = 10.0
    optimizer: FitOptimizerConfig = Field(default_factory=FitOptimizerConfig)


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
    status: str
    version: str
    n_projects: int
    n_tasks: int


class LoadProjectResponse(BaseModel):
    project_id: str
    name: str
    device_info: Dict[str, Any]
    key_params: Dict[str, Any]
    curve_counts: Dict[str, int]


class FitResponse(BaseModel):
    task_id: str
    project_id: str
    status: str  # "queued" / "running" / "completed" / "failed"
    message: str = ""

class TaskInfo(BaseModel):
    id: str
    type: str
    status: str
    progress: float
    result: Dict[str, Any] = Field(default_factory=dict)
    error: str = ""
    created_at: str


class ModelParamInfo(BaseModel):
    name: str
    value: float
    initial: float
    fitted: bool
    category: str
    stage: str
    unit: str = ""
    description: str = ""


class ProjectModelResponse(BaseModel):
    project_id: str
    n_params: int
    n_fitted: int
    params: List[ModelParamInfo]


class ExportResponse(BaseModel):
    success: bool
    file_path: str
    n_bytes: int = 0


class CurveResponse(BaseModel):
    name: str
    curve_type: str
    data: Dict[str, List[float]]
    metadata: Dict[str, Any]


class ErrorResponse(BaseModel):
    error: str
    detail: str = ""
