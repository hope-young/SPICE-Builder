"""
Power MOSFET subcircuit-level parameters.

These parameters live outside the BSIM3 channel core.  BSIM3 still handles
the intrinsic MOS behavior; this layer represents package/cell/drift-network
effects that are usually needed for power MOSFET fitting.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any


@dataclass(frozen=True)
class PowerMOSSubcktParams:
    """Parameters for the outer Power MOSFET subckt wrapper.

    The v1 network is intentionally resistive and conservative:
    external gate/source/drain resistance plus optional drift/JFET series
    terms and channel scaling.  Capacitance and body-diode refinements can
    be added here without expanding the BSIM3 parameter surface.
    """

    include_diode: bool = True
    rg_ohm: float = 1.6
    rd_ext_ohm: float | None = None
    rs_ext_ohm: float | None = None
    rdrift_ohm: float = 0.0
    rjfet_ohm: float = 0.0
    cell_count: int = 20000
    cell_w_m: float = 0.2
    active_area_mm2: float = 10.0
    cell_pitch_um: float = 2.0

    @classmethod
    def from_dict(
        cls,
        data: dict[str, Any] | None,
        base: "PowerMOSSubcktParams | None" = None,
    ) -> "PowerMOSSubcktParams":
        if not data:
            return base or cls()
        allowed = {f.name for f in cls.__dataclass_fields__.values()}
        cleaned = {k: v for k, v in data.items() if k in allowed}
        return replace(base, **cleaned) if base is not None else cls(**cleaned)

    def with_overrides(
        self,
        *,
        include_diode: bool | None = None,
        rg_ohm: float | None = None,
        rd_ohm: float | None = None,
        rs_ohm: float | None = None,
        cell_count: int | None = None,
        cell_w_m: float | None = None,
    ) -> "PowerMOSSubcktParams":
        """Apply legacy flat arguments while preserving newer fields."""
        updates: dict[str, Any] = {}
        if include_diode is not None:
            updates["include_diode"] = bool(include_diode)
        if rg_ohm is not None:
            updates["rg_ohm"] = float(rg_ohm)
        if rd_ohm is not None:
            updates["rd_ext_ohm"] = float(rd_ohm)
        if rs_ohm is not None:
            updates["rs_ext_ohm"] = float(rs_ohm)
        if cell_count is not None:
            updates["cell_count"] = int(cell_count)
        if cell_w_m is not None:
            updates["cell_w_m"] = float(cell_w_m)
        return replace(self, **updates) if updates else self

    @property
    def active_area_factor(self) -> float:
        if not isinstance(self.active_area_mm2, (int, float)) or self.active_area_mm2 <= 0:
            return 1.0
        return float(self.active_area_mm2)

    @property
    def unit_cell_multiplier(self) -> float:
        """Number of BSIM unit-cell slices in the active area.

        The BSIM core represents one stripe-like unit:
            cell_pitch_um wide x 1 um longitudinal depth.

        AA is entered in mm^2, so:
            M = AA_mm2 * 1e6 / (cell_pitch_um * 1um)
        """
        area = self.active_area_factor
        pitch = self.cell_pitch_um if isinstance(self.cell_pitch_um, (int, float)) else 0.0
        if pitch <= 0:
            return max(float(self.cell_count), 1.0)
        return max(area * 1e6 / float(pitch), 1.0)

    @property
    def bsim_unit_width_m(self) -> float:
        """Longitudinal width of one BSIM unit slice: 1 um."""
        return 1e-6

    @property
    def total_channel_width_m(self) -> float:
        return self.bsim_unit_width_m * self.unit_cell_multiplier

    def cache_key(self) -> str:
        return (
            f"diode={int(self.include_diode)}"
            f"|rg={self.rg_ohm:.12g}"
            f"|rd={self.rd_ext_ohm if self.rd_ext_ohm is not None else 'model'}"
            f"|rs={self.rs_ext_ohm if self.rs_ext_ohm is not None else 'model'}"
            f"|rdrift={self.rdrift_ohm:.12g}"
            f"|rjfet={self.rjfet_ohm:.12g}"
            f"|cells={self.cell_count}"
            f"|cellw={self.cell_w_m:.12g}"
            f"|aa_mm2={self.active_area_mm2:.12g}"
            f"|pitch_um={self.cell_pitch_um:.12g}"
        )
