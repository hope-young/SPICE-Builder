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
                      rs_ohm: float | None = None) -> Path:
        """B 形式：subckt 包装（推荐）

        输出示例：
          * SpiceBuilder Export - <part>
          .SUBCKT MY_MOSFET D G S
          M1 D_int G S S BSIM3_core L=1u W=1u
          Rd D D_int 0.001
          Rs S_int S 0.001
          Rgate G_int G 1.6
          Dbody S D Dbody_diode
          .ENDS

          .MODEL BSIM3_core NMOS LEVEL=49
          +VTH0=2.34
          ...
          .END
        """
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)

        # RD/RS 默认从 model 取
        if rd_ohm is None:
            rd_ohm = model.get("RD")
        if rs_ohm is None:
            rs_ohm = model.get("RS")
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
            "",
            f".SUBCKT {subckt_name} D G S",
            f"M1 D_int G_int S S BSIM3_core L=1u W=1u",
        ]
        # Gate resistance (in series with G)
        if rg_ohm > 0:
            lines.append(f"Rg G G_int {rg_ohm:.4g}")
        else:
            lines.append(f"* Rg omitted (rg_ohm=0)")

        # Series resistance (D, S in series with internal nodes)
        lines.extend([
            f"Rd D D_int {rd_ohm:.4g}",
            f"Rs S_int S {rs_ohm:.4g}",
        ])

        # Body diode
        if include_diode:
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
