"""
exporter.py
===========
LibExporter - 输出 SPICE 模型文件

支持两种格式：
  - A: 纯 BSIM3 .model card（直接 .model nmos1 nmos level=49）
  - B: subckt 包装（推荐，BSIM3 + Rd + Rs + Rg + 体二极管）
"""
from __future__ import annotations
from pathlib import Path
from datetime import datetime
from .bsim3 import BSIM3Model, PARAM_SPECS
from .powermos import PowerMOSSubcktParams


class LibExporter:
    """SPICE 模型文件导出器"""

    def __init__(self, part_number: str = "Unknown"):
        self.part_number = part_number

    def export_bsim3(self,
                     model: BSIM3Model,
                     output_path: str | Path,
                     model_name: str | None = None) -> Path:
        """A 形式：导出纯 BSIM3 .model card

        输出示例：
          * SpiceBuilder Export - <part>
          .MODEL nmos1 NMOS LEVEL=49
          +VTH0=2.34
          +U0=450
          ...
          .END
        """
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        name = model_name or model.name

        lines = [
            f"* SpiceBuilder Export - {self.part_number}",
            f"* Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            f"* Format: A (pure BSIM3 .model)",
            "",
            f".MODEL {name} NMOS LEVEL=49",
            model.to_spice_card(name),
            ".END",
            "",
        ]
        out.write_text("\n".join(lines), encoding='utf-8')
        return out

    def export_subckt(self,
                      model: BSIM3Model,
                      output_path: str | Path,
                      subckt_name: str = "MY_MOSFET",
                      include_diode: bool = True,
                      rg_ohm: float = 1.6,
                      rd_ohm: float | None = None,
                      rs_ohm: float | None = None,
                      cell_count: int = 20000,
                      cell_w_m: float = 0.2,
                      power_params: PowerMOSSubcktParams | dict | None = None) -> Path:
        """B 形式：subckt 包装（推荐）

        输出示例：
          * SpiceBuilder Export - <part>
          .SUBCKT MY_MOSFET D G S
          M1 D_int G_int S_int S_int BSIM3_core L=1u W=0.2 M=20000
          Rd D D_int 0.001
          ...

        Args:
            cell_count: 并联的元胞数量。SGT MOSFET 是大量 cell 并联工作,
                       单 cell 的 BSIM3 电流远小于芯片总电流,所以要用 M=m 并联。
            cell_w_m: 单 cell 沟道宽度 (m)。默认 0.2 m = 200 um,典型 SGT 元胞。
                      Id 比例 ∝ cell_count * cell_w_m。
        """
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)

        if isinstance(power_params, dict):
            pwr = PowerMOSSubcktParams.from_dict(power_params)
        elif power_params is None:
            pwr = PowerMOSSubcktParams()
        else:
            pwr = power_params
        if power_params is None:
            pwr = pwr.with_overrides(
                include_diode=include_diode,
                rg_ohm=rg_ohm,
                rd_ohm=rd_ohm,
                rs_ohm=rs_ohm,
                cell_count=cell_count,
                cell_w_m=cell_w_m,
            )
        else:
            pwr = pwr.with_overrides(
                include_diode=None if include_diode is True else include_diode,
                rg_ohm=None if rg_ohm == 1.6 else rg_ohm,
                rd_ohm=rd_ohm,
                rs_ohm=rs_ohm,
                cell_count=None if cell_count == 20000 else cell_count,
                cell_w_m=None if cell_w_m == 0.2 else cell_w_m,
            )

        # RD/RS 默认从 BSIM model 取；PowerMOS 显式值优先。
        rd_ext_ohm = model.get("RD") if pwr.rd_ext_ohm is None else pwr.rd_ext_ohm
        rs_ext_ohm = model.get("RS") if pwr.rs_ext_ohm is None else pwr.rs_ext_ohm
        area_factor = pwr.active_area_factor
        unit_multiplier = pwr.unit_cell_multiplier
        unit_width_m = pwr.bsim_unit_width_m
        rdrift_eff = pwr.rdrift_ohm / area_factor if pwr.rdrift_ohm > 0 else 0.0
        rjfet_eff = pwr.rjfet_ohm / area_factor if pwr.rjfet_ohm > 0 else 0.0
        # 体二极管参数
        is_a = model.get("IS")
        n = model.get("N")
        bv = model.get("BV")
        ibv = model.get("IBV")

        lines = [
            f"* SpiceBuilder Export - {self.part_number}",
            f"* Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            f"* Format: B (subckt wrapper, recommended)",
            f"* Subckt: {subckt_name}",
            f"* Power wrapper: Rg={pwr.rg_ohm:.6g} Rd_ext={rd_ext_ohm:.6g} "
            f"Rs_ext={rs_ext_ohm:.6g} Rdrift={pwr.rdrift_ohm:.6g} Rjfet={pwr.rjfet_ohm:.6g} "
            f"AA={pwr.active_area_mm2:.6g}mm2 CellPitch={pwr.cell_pitch_um:.6g}um UnitM={unit_multiplier:.6g}",
            "",
            f".SUBCKT {subckt_name} D G S",
            f"M1 D_int G_int S_int S_int BSIM3_core L=1u W={unit_width_m:.12g} M={unit_multiplier:.12g}",
        ]
        # Gate resistance (in series with G)
        if pwr.rg_ohm > 0:
            lines.append(f"Rg G G_int {pwr.rg_ohm:.4g}")
        else:
            lines.append("Rg_link G G_int 1e-12")

        # Power MOS drain-side series network.  Keep D_int stable because
        # LTspice C-V templates and future extraction code use it as a probe.
        drain_node = "D"
        for rname, next_node, value in [
            ("Rd_ext", "D_pkg", rd_ext_ohm),
            ("Rdrift", "D_drift", rdrift_eff),
            ("Rjfet", "D_int", rjfet_eff),
        ]:
            if value > 0:
                lines.append(f"{rname} {drain_node} {next_node} {value:.4g}")
                drain_node = next_node
        if drain_node != "D_int":
            lines.append(f"Rdrain_link {drain_node} D_int 1e-12")

        if rs_ext_ohm > 0:
            lines.append(f"Rs_ext S_int S {rs_ext_ohm:.4g}")
        else:
            lines.append("Rs_link S_int S 1e-12")

        # Body diode
        if pwr.include_diode:
            lines.extend([
                f"Dbody S D Dbody_diode",
                f".MODEL Dbody_diode D (IS={is_a:.4g} N={n:.4g} BV={bv:.4g} IBV={ibv:.4g})",
            ])

        lines.extend([
            ".ENDS",
            "",
            ".MODEL BSIM3_core NMOS LEVEL=49",
            model.to_spice_card(),
            ".END",
            "",
        ])

        out.write_text("\n".join(lines), encoding='utf-8')
        return out

    def export_both(self,
                    model: BSIM3Model,
                    output_path: str | Path,
                    subckt_name: str = "MY_MOSFET",
                    **kwargs) -> tuple[Path, Path]:
        """同时导出 A 和 B 形式"""
        out = Path(output_path)
        a_path = out.with_name(out.stem + "_bsim3.lib")
        b_path = out.with_name(out.stem + "_subckt.lib")
        self.export_bsim3(model, a_path)
        self.export_subckt(model, b_path, subckt_name, **kwargs)
        return a_path, b_path
