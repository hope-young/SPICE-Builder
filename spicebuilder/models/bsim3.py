"""
bsim3.py
========
BSIM3v3 (Level 49) 30+ 参数定义。

6 阶段参数映射：
  S1 Threshold:    VTH0, K1, K2, DVT0, DVT1, NFACTOR, CDSC
  S2 Subthreshold: NFACTOR, CDSCD, CDSCB
  S3 Linear Mob:   U0, UA, UB, UC
  S4 Saturation:   VSAT, A0, AGS, KETA
  S5 Output Res:   PCLM, PDIBLC1, PDIBLC2, DROUT, PVAG
  S6 Capacitance:  CGBO, CGDO, CGSO, MJ, MJSW, PB, PBSW

参考：BSIM3v3.2 Manual (UC Berkeley, 1999)
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class BSIM3ParamSpec:
    """单个 BSIM3 参数的完整定义"""
    name: str
    default: float
    lower: float
    upper: float
    unit: str
    category: str
    stage: str
    description: str = ""


# ==================== 参数定义 ====================
# 分类: Threshold / Mobility / Saturation / Channel Length Mod / Capacitance / Junction / Temperature / Diode / Process

PARAM_SPECS: list[BSIM3ParamSpec] = [
    # === Threshold & Body Effect (S1) ===
    BSIM3ParamSpec("VTH0",   3.0,    2.0,   5.0,    "V",      "Threshold",     "S1", "零偏阈值电压 @ Vbs=0 (target Vth≈3.5V)"),
    BSIM3ParamSpec("K1",     0.5,    0.0,   2.0,    "V^0.5",  "Threshold",     "S1", "体效应系数一阶"),
    BSIM3ParamSpec("K2",     0.0,   -1.0,   1.0,    "—",      "Threshold",     "S1", "体效应系数二阶"),
    BSIM3ParamSpec("DVT0",   2.2,    0.0,   10.0,   "—",      "Threshold",     "S1", "短沟道 Vth 衰减系数 0"),
    BSIM3ParamSpec("DVT1",   0.53,   0.0,   5.0,    "—",      "Threshold",     "S1", "短沟道 Vth 衰减系数 1"),
    BSIM3ParamSpec("NFACTOR",2.0,    0.5,   5.0,    "—",      "Subthreshold",  "S1", "亚阈值摆幅因子"),
    BSIM3ParamSpec("CDSC",   2.4e-4, 0.0,   1e-2,   "F/m^2",  "Subthreshold",  "S1", "源/漏与沟道耦合电容"),

    # === Subthreshold (S2) ===
    BSIM3ParamSpec("CDSCD",  2.4e-4, 0.0,   1e-2,   "F/m^2",  "Subthreshold",  "S2", "D/S 与沟道耦合电容（漏偏相关）"),
    BSIM3ParamSpec("CDSCB",  0.0,   -1e-2,  1e-2,   "F/m^2",  "Subthreshold",  "S2", "体与沟道耦合电容"),

    # === Mobility (S3) ===
    BSIM3ParamSpec("U0",     300.0,  50.0,  800.0, "cm^2/Vs","Mobility",      "S3", "低场迁移率（零偏，约束以防简化公式误判）"),
    BSIM3ParamSpec("UA",     2.0e-9, 0.0,   1e-7,   "m/V",    "Mobility",      "S3", "迁移率一阶退化系数"),
    BSIM3ParamSpec("UB",     5.0e-19,0.0,   1e-16,  "(m/V)^2","Mobility",      "S3", "迁移率二阶退化系数"),
    BSIM3ParamSpec("UC",     5.0e-11,0.0,   1e-9,   "m/V^2",  "Mobility",      "S3", "迁移率体偏系数"),

    # === Saturation Velocity (S4) ===
    BSIM3ParamSpec("VSAT",   1.0e5,  5.0e4, 2.0e6,  "m/s",    "Saturation",    "S4", "饱和载流子速度 (SGT 可达 1e6+)"),
    BSIM3ParamSpec("A0",     1.0,    0.0,   10.0,   "—",      "Saturation",    "S4", "沟长调制 bulk 偏置系数"),
    BSIM3ParamSpec("AGS",    0.0,   -1.0,   1.0,    "—",      "Saturation",    "S4", "Vsat 栅偏系数"),
    BSIM3ParamSpec("KETA",   0.0,   -1.0,   1.0,    "—",      "Saturation",    "S4", "Vsat 体偏系数"),

    # === Channel Length Modulation (S5) ===
    BSIM3ParamSpec("PCLM",   0.5,    0.0,   10.0,   "—",      "ChanLenMod",    "S5", "沟长调制系数"),
    BSIM3ParamSpec("PDIBLC1",0.3,    0.0,   1.0,    "—",      "ChanLenMod",    "S5", "DIBL 系数 1"),
    BSIM3ParamSpec("PDIBLC2",0.05,   0.0,   1.0,    "—",      "ChanLenMod",    "S5", "DIBL 系数 2"),
    BSIM3ParamSpec("DROUT",  0.5,    0.0,   5.0,    "—",      "ChanLenMod",    "S5", "DIBL 沟长系数"),
    BSIM3ParamSpec("PVAG",   1.0,    0.0,   5.0,    "—",      "ChanLenMod",    "S5", "Vsat 体偏迁移率"),

    # === Capacitance (S6) ===
    BSIM3ParamSpec("CGBO",   1.0e-10,0.0,   1e-8,   "F/m",    "Capacitance",   "S6", "栅-体交叠电容/沟道宽度"),
    BSIM3ParamSpec("CGDO",   1.0e-9, 0.0,   1e-7,   "F/m",    "Capacitance",   "S6", "栅-漏交叠电容/沟道宽度"),
    BSIM3ParamSpec("CGSO",   1.0e-9, 0.0,   1e-7,   "F/m",    "Capacitance",   "S6", "栅-源交叠电容/沟道宽度"),
    BSIM3ParamSpec("MJ",     0.5,    0.1,   1.5,    "—",      "Junction",      "S6", "底结电容梯度"),
    BSIM3ParamSpec("MJSW",   0.33,   0.1,   1.0,    "—",      "Junction",      "S6", "侧壁结电容梯度"),
    BSIM3ParamSpec("PB",     0.8,    0.1,   2.0,    "V",      "Junction",      "S6", "底结内建电势"),
    BSIM3ParamSpec("PBSW",   0.8,    0.1,   2.0,    "V",      "Junction",      "S6", "侧壁结内建电势"),
    BSIM3ParamSpec("TT",     1.0e-12,0.0,   1e-9,   "s",      "Capacitance",   "S6", "本征渡越时间"),

    # === Series Resistance ===
    BSIM3ParamSpec("RD",     1.0e-4, 0.0,   1.0,    "Ω",      "Parasitic",     "S4", "漏极串联电阻"),
    BSIM3ParamSpec("RS",     1.0e-4, 0.0,   1.0,    "Ω",      "Parasitic",     "S4", "源极串联电阻"),

    # === Temperature ===
    BSIM3ParamSpec("KT1",   -0.11,  -1.0,   1.0,    "V",      "Temperature",   "S5", "Vth 温度系数"),
    BSIM3ParamSpec("KT2",    0.022, -1.0,   1.0,    "—",      "Temperature",   "S5", "Vth 温度二阶系数"),
    BSIM3ParamSpec("UTE",   -1.5,   -3.0,   0.0,    "—",      "Temperature",   "S5", "迁移率温度指数"),
    BSIM3ParamSpec("UA1",    1.0e-9, 0.0,   1e-7,   "m/V",    "Temperature",   "S5", "UA 温度系数"),
    BSIM3ParamSpec("UB1",   -1.0e-18,-1e-15, 0.0,   "(m/V)^2","Temperature",   "S5", "UB 温度系数"),
    BSIM3ParamSpec("UC1",   -5.6e-11,-1e-9, 0.0,   "m/V^2",  "Temperature",   "S5", "UC 温度系数"),
    BSIM3ParamSpec("PRT",    0.0,   -1.0,   1.0,    "—",      "Temperature",   "S5", "Rds 温度系数"),
    BSIM3ParamSpec("TNOM",   25.0,  -50.0,  100.0,  "°C",     "Process",       "—",  "标称测量温度"),

    # === Process ===
    BSIM3ParamSpec("TOX",    5.0e-8, 1.0e-9, 1.0e-6, "m",      "Process",       "—",  "栅氧厚度"),
    BSIM3ParamSpec("NSUB",   1.0e17, 1.0e15, 1.0e19, "cm^-3",  "Process",       "—",  "沟道掺杂浓度"),
    BSIM3ParamSpec("XL",     0.0,   -1.0e-6, 1.0e-6, "m",      "Process",       "—",  "沟道长度的光刻偏差"),
    BSIM3ParamSpec("XW",     0.0,   -1.0e-6, 1.0e-6, "m",      "Process",       "—",  "沟道宽度的光刻偏差"),
    BSIM3ParamSpec("DELTA",  0.01,   0.0,   1.0,    "—",      "Process",       "—",  "窄沟道 Vth 偏移"),

    # === Body Diode ===
    BSIM3ParamSpec("IS",     1.0e-12,1.0e-18,1.0e-3, "A",      "Diode",         "S6", "体二极管饱和电流"),
    BSIM3ParamSpec("N",      1.5,    0.5,   5.0,    "—",      "Diode",         "S6", "体二极管发射系数"),
    BSIM3ParamSpec("BV",     100.0,  1.0,   1500.0, "V",      "Diode",         "S6", "反向击穿电压"),
    BSIM3ParamSpec("IBV",    1.0e-3, 1.0e-9, 1.0,   "A",      "Diode",         "S6", "击穿电压处的电流"),
]

# 索引
SPEC_BY_NAME: dict[str, BSIM3ParamSpec] = {s.name: s for s in PARAM_SPECS}


# 6 阶段参数映射（必须严格遵守）
STAGE_PARAM_MAP: dict[str, list[str]] = {
    "S1": ["VTH0", "K1", "K2", "DVT0", "DVT1", "NFACTOR", "CDSC"],
    "S2": ["NFACTOR", "CDSCD", "CDSCB"],
    "S3": ["U0", "UA", "UB", "UC"],
    "S4": ["VSAT", "A0", "AGS", "KETA", "RD", "RS"],
    "S5": ["PCLM", "PDIBLC1", "PDIBLC2", "DROUT", "PVAG",
            "KT1", "KT2", "UTE", "UA1", "UB1", "UC1", "PRT"],
    "S6": ["CGBO", "CGDO", "CGSO", "MJ", "MJSW", "PB", "PBSW", "TT",
            "IS", "N", "BV", "IBV"],
}


class BSIM3Model:
    """BSIM3 模型对象，封装 30+ 参数及 dot-path 访问"""

    def __init__(self, name: str = "nmos1"):
        self.name = name
        # 参数值 dict（name -> current value）
        self._values: dict[str, float] = {}
        # 参数是否被 fitted
        self._fitted: set[str] = set()
        # 初始值（用作 reset）
        self._initial: dict[str, float] = {}
        for spec in PARAM_SPECS:
            self._values[spec.name] = spec.default
            self._initial[spec.name] = spec.default

    # ---------- 基础操作 ----------

    def get(self, param: str) -> float:
        """获取参数值（dot-path 也支持，如 'nmos1.VTH0'）"""
        name = self._strip_path(param)
        if name not in self._values:
            raise KeyError(f"未知参数: {param}")
        return self._values[name]

    def set(self, param: str, value: float) -> None:
        """设置参数值（同时记为已 fitted）"""
        name = self._strip_path(param)
        if name not in self._values:
            raise KeyError(f"未知参数: {param}")
        # bounds 检查
        lo, hi = self.get_bounds(name)
        if value < lo or value > hi:
            raise ValueError(
                f"参数 {name}={value} 超出 bounds [{lo}, {hi}]"
            )
        self._values[name] = float(value)
        self._fitted.add(name)

    def set_initial(self, param: str, value: float) -> None:
        """设置初始值（不会被 set() 覆盖）"""
        name = self._strip_path(param)
        if name not in self._values:
            raise KeyError(f"未知参数: {param}")
        lo, hi = self.get_bounds(name)
        if value < lo or value > hi:
            raise ValueError(
                f"参数 {name}={value} 超出 bounds [{lo}, {hi}]"
            )
        self._values[name] = float(value)
        self._initial[name] = float(value)
        # 不标记为 fitted

    def get_bounds(self, param: str) -> tuple[float, float]:
        name = self._strip_path(param)
        spec = SPEC_BY_NAME[name]
        return (spec.lower, spec.upper)

    def get_spec(self, param: str) -> BSIM3ParamSpec:
        return SPEC_BY_NAME[self._strip_path(param)]

    def get_params_by_stage(self, stage: str) -> list[str]:
        return list(STAGE_PARAM_MAP.get(stage, []))

    def get_params_by_category(self, category: str) -> list[str]:
        return [s.name for s in PARAM_SPECS if s.category == category]

    def is_fitted(self, param: str) -> bool:
        return self._strip_path(param) in self._fitted

    def reset(self, param: str | None = None) -> None:
        """重置一个或全部参数到初始值"""
        if param is None:
            for name, init_val in self._initial.items():
                self._values[name] = init_val
            self._fitted.clear()
        else:
            name = self._strip_path(param)
            self._values[name] = self._initial[name]
            self._fitted.discard(name)

    def _strip_path(self, path: str) -> str:
        """处理 dot-path: 'nmos1.VTH0' -> 'VTH0'"""
        if '.' in path:
            return path.split('.')[-1]
        return path

    # ---------- 输出 ----------

    def to_spice_card(self, model_name: str | None = None) -> str:
        """输出 .model card 文本（不含 .model 行）

        过滤掉 category='Diode' 的参数（IS, N, BV, IBV），
        这些应该放在 .MODEL Dbody_diode 里。
        """
        lines = []
        for spec in PARAM_SPECS:
            if spec.category == "Diode":
                continue
            val = self._values[spec.name]
            # 格式化数值（提高精度以避免优化器梯度计算问题）
            if val == 0:
                fmt = "0"
            elif abs(val) < 1e-3 or abs(val) > 1e6:
                fmt = f"{val:.8e}"  # 科学计数法，8位精度
            else:
                fmt = f"{val:.8g}"  # 普通格式，8位有效数字
            lines.append(f"+{spec.name}={fmt}")
        return "\n".join(lines)

    def to_dict(self) -> dict:
        """输出所有参数的 dict"""
        return dict(self._values)

    def __repr__(self):
        n_fitted = len(self._fitted)
        return f"BSIM3Model({self.name}, {len(self._values)} params, {n_fitted} fitted)"
