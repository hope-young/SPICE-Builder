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
from .cap_wrapper import PowerCapWrapper, CapTable
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
            f"* NOTICE: Core model only. This file does not include AA/CellPitch scaling,",
            f"* package resistance, or the power-MOS wrapper. External netlists must provide",
            f"* the intended W/L/M scaling when instantiating this model.",
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
                      power_params: PowerMOSSubcktParams | dict | None = None,
                      cap_wrapper: PowerCapWrapper | dict | None = None) -> Path:
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
        if isinstance(cap_wrapper, dict):
            capw = PowerCapWrapper.from_dict(cap_wrapper)
        else:
            capw = cap_wrapper

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
        igs0 = model.get("IGS0")
        vgslp = model.get("VGSLP")
        bvgsp = model.get("BVGSP")
        bvgsn = model.get("BVGSN")

        lines = [
            f"* SpiceBuilder Export - {self.part_number}",
            f"* Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            f"* Format: B (subckt wrapper, recommended)",
            f"* Subckt: {subckt_name}",
            f"* NOTICE: Complete power MOSFET subcircuit. Use: X1 D G S {subckt_name}",
            f"* Do not instantiate BSIM3_core directly unless your netlist supplies its own",
            f"* W/L/M scaling. AA and CellPitch are baked into the internal M1 multiplier.",
            f"* Power wrapper: Rg={pwr.rg_ohm:.6g} Rd_ext={rd_ext_ohm:.6g} "
            f"Rs_ext={rs_ext_ohm:.6g} Rdrift={pwr.rdrift_ohm:.6g} Rjfet={pwr.rjfet_ohm:.6g} "
            f"AA={pwr.active_area_mm2:.6g}mm2 CellPitch={pwr.cell_pitch_um:.6g}um UnitM={unit_multiplier:.6g}",
        ]
        if capw and capw.enabled:
            cap_desc = (
                "external charge sources own the fitted Cgs/Cgd/Cds tables"
                if capw.mode == "external_charge"
                else "Ciss/Coss/Crss residuals are represented by behavioral capacitance currents"
            )
            lines.extend([
                f"* NOTICE: CV wrapper enabled ({capw.mode}).",
                f"* {cap_desc}.",
            ])
        lines.extend([
            "",
            f".SUBCKT {subckt_name} D G S",
            f".param IGS0={igs0:.8e} VGSLP={vgslp:.8g} BVGSP={bvgsp:.8g} BVGSN={bvgsn:.8g}",
            f"M1 D_int G_int S_int S_int BSIM3_core L=1u W={unit_width_m:.12g} M={unit_multiplier:.12g}",
        ])
        # Gate resistance (in series with G)
        if pwr.rg_ohm > 0:
            lines.append(f"Rg G G_int {pwr.rg_ohm:.4g}")
        else:
            lines.append("Rg_link G G_int 1e-12")

        # Gate-source leakage / oxide breakdown wrapper.  Current is near zero
        # below +/-BVGSS and rises exponentially after either breakdown knee.
        lines.append(
            "Bgate_leak G_int S "
            "I={if(V(G_int,S)>BVGSP,IGS0*exp(min((V(G_int,S)-BVGSP)/VGSLP,80)),"
            "if(V(G_int,S)<-BVGSN,-IGS0*exp(min((-V(G_int,S)-BVGSN)/VGSLP,80)),0))}"
        )
        if capw and capw.enabled:
            lines.extend(self._cap_wrapper_lines(capw))

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

        model_card = self._model_card_for_export(model, capw)
        lines.extend([
            ".ENDS",
            "",
            ".MODEL BSIM3_core NMOS LEVEL=49",
            model_card,
            ".END",
            "",
        ])

        out.write_text("\n".join(lines), encoding='utf-8')
        return out

    @staticmethod
    def _format_table_function(name: str, table: CapTable) -> str:
        pairs: list[str] = []
        for v, c_pf in zip(table.voltage_v, table.capacitance_pf):
            pairs.append(f"{float(v):.8g},{float(c_pf) * 1e-12:.12e}")
        if not pairs:
            pairs.append("0,0")
        return f".func SB_{name.upper()}(x) table(x,{','.join(pairs)})"

    @staticmethod
    def _format_charge_table_function(name: str, table: CapTable) -> str:
        pairs: list[str] = []
        for v, q_pc in zip(table.voltage_v, table.charge_pc):
            pairs.append(f"{float(v):.8g},{float(q_pc) * 1e-12:.12e}")
        if not pairs:
            pairs.append("0,0")
        return f".func SB_Q{name.upper()}(x) table(x,{','.join(pairs)})"

    @staticmethod
    def _pow_expr(var_name: str, power: int) -> str:
        if power == 0:
            return "1"
        if power == 1:
            return var_name
        return "*".join([var_name] * power)

    @classmethod
    def _poly_expr(cls, coeff_f: list[float], var_name: str = "u") -> str:
        terms: list[str] = []
        for i, coeff in enumerate(coeff_f):
            c = float(coeff)
            if c == 0:
                continue
            if i == 0:
                terms.append(f"({c:.12e})")
            else:
                terms.append(f"({c:.12e})*{cls._pow_expr(var_name, i)}")
        return " + ".join(terms) if terms else "0"

    @staticmethod
    def _fallback_poly_coeff_f(table: CapTable, order: int = 5) -> tuple[list[float], float, float]:
        import numpy as np

        v = np.asarray(table.voltage_v, dtype=float)
        c_f = np.asarray(table.capacitance_pf, dtype=float) * 1e-12
        valid = np.isfinite(v) & np.isfinite(c_f)
        v = v[valid]
        c_f = c_f[valid]
        if v.size == 0:
            return [0.0], 0.0, 1.0
        vmin = float(np.min(v))
        vspan = float(np.max(v) - vmin)
        if vspan <= 0 or v.size == 1:
            return [max(float(np.mean(c_f)), 0.0)], vmin, 1.0
        degree = int(max(0, min(order, v.size - 1, 12)))
        u = 2.0 * (v - vmin) / vspan - 1.0
        scale = max(float(np.nanmax(np.abs(c_f))), 1e-18)
        coeff = np.polynomial.polynomial.polyfit(u, c_f / scale, deg=degree) * scale
        return [float(x) for x in coeff], vmin, vspan

    @classmethod
    def _format_poly_cap_function(cls, name: str, table: CapTable, mode: str = "external_charge") -> list[str]:
        upper = name.upper()
        if table.polynomial_coeff_f:
            coeff_f = [float(x) for x in table.polynomial_coeff_f]
            vmin = float(table.polynomial_vmin_v if table.polynomial_vmin_v is not None else min(table.voltage_v or [0.0]))
            vspan = float(table.polynomial_vspan_v if table.polynomial_vspan_v is not None else max((max(table.voltage_v or [1.0]) - vmin), 1.0))
        else:
            coeff_f, vmin, vspan = cls._fallback_poly_coeff_f(table)
        vspan = vspan if abs(vspan) > 1e-30 else 1.0
        coeff_text = ",".join(f"{c:.12e}" for c in coeff_f)
        poly = cls._poly_expr(coeff_f)
        raw = f"SB_{upper}_RAW"
        norm = f"SB_{upper}_U"
        func_line = (
            f".func SB_{upper}(x) ({raw}({norm}(x)))"
            if mode == "poly_residual"
            else f".func SB_{upper}(x) (if({raw}({norm}(x))>0,{raw}({norm}(x)),0))"
        )
        return [
            f"* SB_CV_POLY {upper} MODE={mode} VMIN={vmin:.12g} VSPAN={vspan:.12g} COEFF_F={coeff_text}",
            f".func {norm}(x) (limit((2*((x)-{vmin:.12g})/{vspan:.12g})-1,-1,1))",
            f".func {raw}(u) ({poly})",
            func_line,
        ]

    @staticmethod
    def _model_card_for_export(model: BSIM3Model, capw: PowerCapWrapper | None) -> str:
        if not (capw and capw.enabled and capw.mode == "external_charge"):
            return model.to_spice_card()

        lines: list[str] = []
        for spec in PARAM_SPECS:
            if spec.category in ("Diode", "GateLeakage"):
                continue
            val = 0.0 if spec.name in ("CGSO", "CGDO", "CGBO", "TT") else model.get(spec.name)
            if val == 0:
                fmt = "0"
            elif abs(val) < 1e-3 or abs(val) > 1e6:
                fmt = f"{val:.8e}"
            else:
                fmt = f"{val:.8g}"
            lines.append(f"+{spec.name}={fmt}")
        return "\n".join(lines)

    def _cap_wrapper_lines(self, capw: PowerCapWrapper) -> list[str]:
        if capw.mode in ("external_charge", "poly_residual"):
            residual_mode = capw.mode == "poly_residual"
            lines = [
                "* CV polynomial residual wrapper: BSIM core capacitance plus Bcap residual matches target CV."
                if residual_mode else
                "* CV external-charge wrapper: positive total Cgs/Cgd/Cds are polynomial functions in Farads.",
                "* Polynomial metadata comments support GUI re-import.",
            ]
            if not residual_mode:
                lines.append("* CGSO/CGDO/CGBO/TT in BSIM3_core are exported as zero to avoid obvious double-counting.")
            if capw.cgs:
                lines.extend(self._format_poly_cap_function("cgs", capw.cgs, capw.mode))
            if capw.cgd:
                lines.extend(self._format_poly_cap_function("cgd", capw.cgd, capw.mode))
            if capw.cds:
                lines.extend(self._format_poly_cap_function("cds", capw.cds, capw.mode))
            if capw.cgs:
                lines.append("Bcap_cgs G S I={SB_CGS(V(D,S))*ddt(V(G,S))}")
            if capw.cgd:
                lines.append("Bcap_cgd G D I={SB_CGD(V(D,S))*ddt(V(G,D))}")
            if capw.cds:
                lines.append("Bcap_cds D S I={SB_CDS(V(D,S))*ddt(V(D,S))}")
            return lines

        lines = [
            "* CV residual wrapper: table capacitance values are in Farads",
            "* Residual sources are connected at external package pins to match",
            "* datasheet-style Ciss/Coss/Crss terminal measurements.",
        ]
        if capw.cgs:
            lines.append(self._format_table_function("cgs", capw.cgs))
        if capw.cgd:
            lines.append(self._format_table_function("cgd", capw.cgd))
        if capw.cds:
            lines.append(self._format_table_function("cds", capw.cds))
        if capw.cgs:
            lines.append("Bcv_cgs G S I={SB_CGS(V(D,S))*ddt(V(G,S))}")
        if capw.cgd:
            lines.append("Bcv_cgd G D I={SB_CGD(V(D,S))*ddt(V(G,D))}")
        if capw.cds:
            lines.append("Bcv_cds D S I={SB_CDS(V(D,S))*ddt(V(D,S))}")
        return lines

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
