"""Behavioral capacitance wrapper for power MOSFET CV fitting.

The wrapper stores voltage-dependent residual capacitances in pF.  Exported
SPICE uses behavioral current sources with table(C(Vds))*ddt(Vterminal).
This keeps the BSIM3 core responsible for DC while the subckt wrapper corrects
external Ciss/Coss/Crss seen at package pins.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np


CAP_TYPES = ("cgs", "cgd", "cds")


@dataclass
class CapTable:
    """A voltage-dependent capacitance table.

    voltage_v is the Vds bias grid. capacitance_pf may be signed because this
    is a residual wrapper (target - BSIM core). charge_pc is included for
    diagnostics and later charge-based export modes.
    """

    name: str
    voltage_v: list[float]
    capacitance_pf: list[float]
    charge_pc: list[float]

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "voltage_v": list(self.voltage_v),
            "capacitance_pf": list(self.capacitance_pf),
            "charge_pc": list(self.charge_pc),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "CapTable | None":
        if not data:
            return None
        name = str(data.get("name", "cap")).lower()
        v = [float(x) for x in data.get("voltage_v", [])]
        c = [float(x) for x in data.get("capacitance_pf", [])]
        q = [float(x) for x in data.get("charge_pc", [])]
        if len(v) != len(c):
            raise ValueError(f"Invalid CapTable {name}: voltage/cap length mismatch")
        if not q or len(q) != len(v):
            q = integrate_cap_to_charge_pc(v, c)
        return cls(name=name, voltage_v=v, capacitance_pf=c, charge_pc=q)


@dataclass
class PowerCapWrapper:
    """Residual CV macro wrapper for Cgs/Cgd/Cds."""

    enabled: bool = False
    mode: str = "residual"
    cgs: CapTable | None = None
    cgd: CapTable | None = None
    cds: CapTable | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": bool(self.enabled),
            "mode": self.mode,
            "cgs": self.cgs.to_dict() if self.cgs else None,
            "cgd": self.cgd.to_dict() if self.cgd else None,
            "cds": self.cds.to_dict() if self.cds else None,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "PowerCapWrapper | None":
        if not data:
            return None
        return cls(
            enabled=bool(data.get("enabled", True)),
            mode=str(data.get("mode", "residual")),
            cgs=CapTable.from_dict(data.get("cgs")),
            cgd=CapTable.from_dict(data.get("cgd")),
            cds=CapTable.from_dict(data.get("cds")),
        )

    def cache_key(self) -> str:
        if not self.enabled:
            return "capwrap=off"
        parts = [f"capwrap={self.mode}"]
        for table in (self.cgs, self.cgd, self.cds):
            if not table:
                continue
            parts.append(f"{table.name}:{len(table.voltage_v)}:{sum(table.capacitance_pf):.12g}")
        return "|".join(parts)


def integrate_cap_to_charge_pc(voltage_v: list[float] | np.ndarray,
                               capacitance_pf: list[float] | np.ndarray) -> list[float]:
    """Integrate C(V) dV.  pF * V = pC."""
    v = np.asarray(voltage_v, dtype=float)
    c = np.asarray(capacitance_pf, dtype=float)
    if v.size == 0:
        return []
    q = np.zeros_like(v, dtype=float)
    for i in range(1, v.size):
        q[i] = q[i - 1] + 0.5 * (c[i] + c[i - 1]) * (v[i] - v[i - 1])
    return q.tolist()


def make_cap_table(name: str,
                   voltage_v: list[float] | np.ndarray,
                   capacitance_pf: list[float] | np.ndarray) -> CapTable:
    v = np.asarray(voltage_v, dtype=float)
    c = np.asarray(capacitance_pf, dtype=float)
    valid = np.isfinite(v) & np.isfinite(c)
    v = v[valid]
    c = c[valid]
    if v.size == 0:
        raise ValueError(f"No valid points for {name}")
    order = np.argsort(v)
    v = v[order]
    c = c[order]
    # Merge duplicate voltage points by averaging capacitance.
    uniq_v = []
    uniq_c = []
    for value in np.unique(v):
        mask = v == value
        uniq_v.append(float(value))
        uniq_c.append(float(np.mean(c[mask])))
    return CapTable(
        name=name.lower(),
        voltage_v=uniq_v,
        capacitance_pf=uniq_c,
        charge_pc=integrate_cap_to_charge_pc(uniq_v, uniq_c),
    )


def interpolate_table(table: CapTable | None, x: np.ndarray, fill: float = 0.0) -> np.ndarray:
    if table is None or not table.voltage_v:
        return np.full_like(x, fill, dtype=float)
    v = np.asarray(table.voltage_v, dtype=float)
    c = np.asarray(table.capacitance_pf, dtype=float)
    order = np.argsort(v)
    return np.interp(x, v[order], c[order], left=float(c[order][0]), right=float(c[order][-1]))


def wrapper_component_curves(wrapper: PowerCapWrapper, vds: np.ndarray) -> dict[str, np.ndarray]:
    return {
        "cgs": interpolate_table(wrapper.cgs, vds),
        "cgd": interpolate_table(wrapper.cgd, vds),
        "cds": interpolate_table(wrapper.cds, vds),
    }


def wrapper_terminal_caps(wrapper: PowerCapWrapper, vds: np.ndarray) -> dict[str, np.ndarray]:
    comps = wrapper_component_curves(wrapper, vds)
    cgs = comps["cgs"]
    cgd = comps["cgd"]
    cds = comps["cds"]
    return {
        "ciss": cgs + cgd,
        "coss": cds + cgd,
        "crss": cgd,
    }


def fit_residual_cap_wrapper(
    vds: np.ndarray,
    measured: dict[str, np.ndarray],
    baseline: dict[str, np.ndarray] | None = None,
) -> PowerCapWrapper:
    """Build residual Cgs/Cgd/Cds tables from measured terminal caps.

    measured/baseline keys are ciss/coss/crss in pF on the same Vds grid.
    Missing terminal caps are treated as zero contribution for that component.
    """
    baseline = baseline or {}
    z = np.zeros_like(vds, dtype=float)
    ciss = np.asarray(measured.get("ciss", z), dtype=float)
    coss = np.asarray(measured.get("coss", z), dtype=float)
    crss = np.asarray(measured.get("crss", z), dtype=float)
    b_ciss = np.asarray(baseline.get("ciss", z), dtype=float)
    b_coss = np.asarray(baseline.get("coss", z), dtype=float)
    b_crss = np.asarray(baseline.get("crss", z), dtype=float)

    has_ciss = "ciss" in measured
    has_coss = "coss" in measured
    has_crss = "crss" in measured

    cgd = (crss - b_crss) if has_crss else z
    cgs = (ciss - b_ciss - cgd) if has_ciss else z
    cds = (coss - b_coss - cgd) if has_coss else z

    return PowerCapWrapper(
        enabled=True,
        mode="residual",
        cgs=make_cap_table("cgs", vds, cgs) if has_ciss else None,
        cgd=make_cap_table("cgd", vds, cgd) if has_crss else None,
        cds=make_cap_table("cds", vds, cds) if has_coss else None,
    )
