"""Behavioral capacitance wrapper for power MOSFET CV fitting.

Two wrapper modes are supported:

* residual: signed correction tables, target - BSIM baseline.  This is useful
  for AC C-V patching but can be numerically hostile in transient.
* external_charge: positive total Cgs/Cgd/Cds tables integrated into Q(V).
  This is intended for Qg / switching transient where charge consistency
  matters more than subtracting the BSIM intrinsic capacitance.
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
    polynomial_coeff_f: list[float] | None = None
    polynomial_vmin_v: float | None = None
    polynomial_vspan_v: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "voltage_v": list(self.voltage_v),
            "capacitance_pf": list(self.capacitance_pf),
            "charge_pc": list(self.charge_pc),
            "polynomial_coeff_f": list(self.polynomial_coeff_f) if self.polynomial_coeff_f else None,
            "polynomial_vmin_v": self.polynomial_vmin_v,
            "polynomial_vspan_v": self.polynomial_vspan_v,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "CapTable | None":
        if not data:
            return None
        name = str(data.get("name", "cap")).lower()
        v = [float(x) for x in data.get("voltage_v", [])]
        c = [float(x) for x in data.get("capacitance_pf", [])]
        q = [float(x) for x in data.get("charge_pc", [])]
        coeff = data.get("polynomial_coeff_f")
        coeff_f = [float(x) for x in coeff] if coeff else None
        vmin = data.get("polynomial_vmin_v")
        vspan = data.get("polynomial_vspan_v")
        if len(v) != len(c):
            raise ValueError(f"Invalid CapTable {name}: voltage/cap length mismatch")
        if not q or len(q) != len(v):
            q = integrate_cap_to_charge_pc(v, c)
        return cls(
            name=name,
            voltage_v=v,
            capacitance_pf=c,
            charge_pc=q,
            polynomial_coeff_f=coeff_f,
            polynomial_vmin_v=float(vmin) if vmin is not None else None,
            polynomial_vspan_v=float(vspan) if vspan is not None else None,
        )


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


def fit_external_charge_cap_wrapper(
    vds: np.ndarray,
    measured: dict[str, np.ndarray],
) -> PowerCapWrapper:
    """Build positive total Cgs/Cgd/Cds tables from terminal CV curves.

    The mapping follows the datasheet small-signal definitions:
      Ciss = Cgs + Cgd
      Coss = Cds + Cgd
      Crss = Cgd

    Unlike residual mode, these are total external charge components and are
    clamped non-negative.  They are exported as ddt(Q(V)) sources so Qg/DPT
    transient simulations do not see signed "negative capacitance" patches.
    """
    z = np.zeros_like(vds, dtype=float)
    ciss = np.asarray(measured.get("ciss", z), dtype=float)
    coss = np.asarray(measured.get("coss", z), dtype=float)
    crss = np.asarray(measured.get("crss", z), dtype=float)

    has_ciss = "ciss" in measured
    has_coss = "coss" in measured
    has_crss = "crss" in measured

    cgd = np.maximum(crss, 0.0) if has_crss else z
    cgs = np.maximum(ciss - cgd, 0.0) if has_ciss else z
    cds = np.maximum(coss - cgd, 0.0) if has_coss else z

    return PowerCapWrapper(
        enabled=True,
        mode="external_charge",
        cgs=make_cap_table("cgs", vds, cgs) if has_ciss else None,
        cgd=make_cap_table("cgd", vds, cgd) if has_crss else None,
        cds=make_cap_table("cds", vds, cds) if has_coss else None,
    )


def _poly_smooth_curve(
    x: np.ndarray,
    y: np.ndarray,
    order: int,
    fit_grid: np.ndarray,
    clamp_nonnegative: bool = True,
) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    fit_grid = np.asarray(fit_grid, dtype=float)
    valid = np.isfinite(x) & np.isfinite(y)
    x = x[valid]
    y = y[valid]
    if x.size == 0:
        return np.zeros_like(fit_grid, dtype=float)
    if x.size == 1:
        return np.full_like(fit_grid, max(float(y[0]), 0.0), dtype=float)

    degree = int(max(0, min(order, x.size - 1, 12)))
    x_min = float(np.min(x))
    x_span = float(np.max(x) - x_min)
    if x_span <= 0:
        return np.full_like(fit_grid, max(float(np.mean(y)), 0.0), dtype=float)

    xn = 2.0 * (x - x_min) / x_span - 1.0
    gn = 2.0 * (fit_grid - x_min) / x_span - 1.0
    y_scale = max(float(np.nanmax(np.abs(y))), 1.0)
    coeff = np.polynomial.polynomial.polyfit(xn, y / y_scale, deg=degree)
    smoothed = np.polynomial.polynomial.polyval(gn, coeff) * y_scale
    return np.maximum(smoothed, 0.0) if clamp_nonnegative else smoothed


def _poly_fit_coeff_pf(x: np.ndarray, y: np.ndarray, order: int) -> tuple[list[float], float, float]:
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    valid = np.isfinite(x) & np.isfinite(y)
    x = x[valid]
    y = y[valid]
    if x.size == 0:
        return [0.0], 0.0, 1.0
    x_min = float(np.min(x))
    x_span = float(np.max(x) - x_min)
    if x_span <= 0 or x.size == 1:
        return [max(float(np.mean(y)), 0.0)], x_min, 1.0
    degree = int(max(0, min(order, x.size - 1, 12)))
    xn = 2.0 * (x - x_min) / x_span - 1.0
    y_scale = max(float(np.nanmax(np.abs(y))), 1.0)
    coeff = np.polynomial.polynomial.polyfit(xn, y / y_scale, deg=degree) * y_scale
    return [float(c) for c in coeff], x_min, x_span


def _make_poly_cap_table(name: str, vds: np.ndarray, cap_pf: np.ndarray, order: int) -> CapTable:
    coeff_pf, vmin, vspan = _poly_fit_coeff_pf(vds, cap_pf, order)
    table = make_cap_table(name, vds, cap_pf)
    table.polynomial_coeff_f = [c * 1e-12 for c in coeff_pf]
    table.polynomial_vmin_v = vmin
    table.polynomial_vspan_v = vspan
    return table


def fit_polynomial_external_charge_cap_wrapper(
    vds: np.ndarray,
    measured: dict[str, np.ndarray],
    polynomial_orders: dict[str, int] | None = None,
    default_order: int = 5,
) -> PowerCapWrapper:
    """Build external-charge Cgs/Cgd/Cds from polynomial-smoothed terminal CV.

    Each terminal curve is fitted as C(Vds) with a normalized polynomial.  The
    fitted Ciss/Coss/Crss curves are then converted into positive component
    capacitances:

      Cgd = Crss
      Cgs = Ciss - Crss
      Cds = Coss - Crss
    """
    polynomial_orders = polynomial_orders or {}
    v = np.asarray(vds, dtype=float)
    valid = np.isfinite(v)
    v = np.unique(v[valid])
    if v.size == 0:
        raise ValueError("Polynomial CV fit needs at least one Vds point")
    v.sort()

    z = np.zeros_like(v, dtype=float)
    smoothed: dict[str, np.ndarray] = {}
    for cap_type in ("ciss", "coss", "crss"):
        if cap_type not in measured:
            continue
        y = np.asarray(measured[cap_type], dtype=float)
        src_x = np.asarray(vds, dtype=float)
        if y.size != src_x.size:
            y = np.interp(v, src_x[: y.size], y) if y.size else z
            src_x = v
        order = int(polynomial_orders.get(cap_type, default_order))
        smoothed[cap_type] = _poly_smooth_curve(src_x, y, order, v)

    has_ciss = "ciss" in smoothed
    has_coss = "coss" in smoothed
    has_crss = "crss" in smoothed
    ciss = smoothed.get("ciss", z)
    coss = smoothed.get("coss", z)
    crss = smoothed.get("crss", z)

    cgd = np.maximum(crss, 0.0) if has_crss else z
    cgs = np.maximum(ciss - cgd, 0.0) if has_ciss else z
    cds = np.maximum(coss - cgd, 0.0) if has_coss else z

    cgs_order = max(int(polynomial_orders.get("ciss", default_order)), int(polynomial_orders.get("crss", default_order)))
    cds_order = max(int(polynomial_orders.get("coss", default_order)), int(polynomial_orders.get("crss", default_order)))
    cgd_order = int(polynomial_orders.get("crss", default_order))

    return PowerCapWrapper(
        enabled=True,
        mode="external_charge",
        cgs=_make_poly_cap_table("cgs", v, cgs, cgs_order) if has_ciss else None,
        cgd=_make_poly_cap_table("cgd", v, cgd, cgd_order) if has_crss else None,
        cds=_make_poly_cap_table("cds", v, cds, cds_order) if has_coss else None,
    )


def fit_polynomial_residual_cap_wrapper(
    vds: np.ndarray,
    measured: dict[str, np.ndarray],
    baseline: dict[str, np.ndarray] | None = None,
    polynomial_orders: dict[str, int] | None = None,
    default_order: int = 5,
) -> PowerCapWrapper:
    """Build polynomial residual Cgs/Cgd/Cds corrections over the BSIM core."""
    polynomial_orders = polynomial_orders or {}
    baseline = baseline or {}
    v = np.asarray(vds, dtype=float)
    valid = np.isfinite(v)
    v = np.unique(v[valid])
    if v.size == 0:
        raise ValueError("Polynomial CV fit needs at least one Vds point")
    v.sort()

    z = np.zeros_like(v, dtype=float)
    smoothed: dict[str, np.ndarray] = {}
    for cap_type in ("ciss", "coss", "crss"):
        if cap_type not in measured:
            continue
        y = np.asarray(measured[cap_type], dtype=float)
        b = np.asarray(baseline.get(cap_type, z), dtype=float)
        src_x = np.asarray(vds, dtype=float)
        if y.size != src_x.size:
            y = np.interp(v, src_x[: y.size], y) if y.size else z
            src_x = v
        if b.size != v.size:
            b = np.interp(v, v[: b.size], b) if b.size else z
        residual = y - b
        order = int(polynomial_orders.get(cap_type, default_order))
        smoothed[cap_type] = _poly_smooth_curve(src_x, residual, order, v, clamp_nonnegative=False)

    has_ciss = "ciss" in smoothed
    has_coss = "coss" in smoothed
    has_crss = "crss" in smoothed
    r_ciss = smoothed.get("ciss", z)
    r_coss = smoothed.get("coss", z)
    r_crss = smoothed.get("crss", z)

    cgd = r_crss if has_crss else z
    cgs = (r_ciss - cgd) if has_ciss else z
    cds = (r_coss - cgd) if has_coss else z

    cgs_order = max(int(polynomial_orders.get("ciss", default_order)), int(polynomial_orders.get("crss", default_order)))
    cds_order = max(int(polynomial_orders.get("coss", default_order)), int(polynomial_orders.get("crss", default_order)))
    cgd_order = int(polynomial_orders.get("crss", default_order))

    return PowerCapWrapper(
        enabled=True,
        mode="poly_residual",
        cgs=_make_poly_cap_table("cgs", v, cgs, cgs_order) if has_ciss else None,
        cgd=_make_poly_cap_table("cgd", v, cgd, cgd_order) if has_crss else None,
        cds=_make_poly_cap_table("cds", v, cds, cds_order) if has_coss else None,
    )
