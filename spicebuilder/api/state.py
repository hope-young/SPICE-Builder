"""Global state for SpiceBuilder API server."""
from dataclasses import dataclass, field
from typing import Dict, Optional
import asyncio
import uuid
from datetime import datetime


@dataclass
class Project:
    id: str
    name: str
    dataset: object  # SpiceDataSet
    model: object    # BSIM3Model
    simdata_cache: Dict = field(default_factory=dict)
    created_at: str = ""
    # Persisted fitted curves from the most recent fit run.  Keys are the
    # route names used by GET /api/projects/{id}/curves/{type} (idvg_5v,
    # idvd, cv_vds_ciss, ...); values are lists of fit arrays (one per
    # source SimData in the original dataset).  Empty / missing keys
    # just mean "no fit has been run on this project yet".
    cached_fits: Dict[str, list] = field(default_factory=dict)


@dataclass
class Task:
    id: str
    type: str
    status: str  # "queued" / "running" / "completed" / "failed"
    progress: float = 0.0
    current_stage: str = ""
    current_loop: int = 0
    result: dict = field(default_factory=dict)
    error: str = ""
    created_at: str = ""
    project_id: str = ""
    # Strong reference to the asyncio.Task so it isn't GC'd mid-run.
    # Annotated as string to avoid forcing an asyncio import order;
    # never read in a hot path.
    asyncio_task: "Optional[asyncio.Task]" = None


@dataclass
class State:
    """Process-wide state for the SpiceBuilder API.

    Note: previously State had class-level mutable defaults (`projects = {}`)
    which is a Python anti-pattern: every State instance would share the
    same dict.  Use a dataclass with default_factory so each instance
    owns its own dict.
    """
    projects: Dict[str, Project] = field(default_factory=dict)
    tasks: Dict[str, Task] = field(default_factory=dict)


state = State()
