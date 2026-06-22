"""
init_values.py
==============
从 SpiceKeyParams (datasheet 关键参数) 推 BSIM3 初始值。

使用 datasheet 关键参数估算 BSIM3 30+ 参数的初值。
这是拟合的"种子"，后续会被 scipy 优化。
"""
from __future__ import annotations
from .bsim3 import BSIM3Model, PARAM_SPECS
from ..data.loader_sdh import SpiceKeyParams


def _gfs_to_u0(gfs_s: float, weff_mm: float = 2.0, leff_um: float = 1.0) -> float:
    """从 gfs 估算 U0

    注: gfs 在 datasheet 里是在 Id 较高点 (如 Id=10A) 测的,
    对应的 W/L 可能被 BSIM3 的非线性模型考虑。简单做法是直接给经验值。

    对于 100V SGT MOSFET, U0 典型 400-600 cm²/Vs。
    """
    # 经验值: SGT 100V/100A die 的 U0 ~ 450
    return 450.0


def _cgdo_cgso_from_crss(crss_pf: float) -> float:
    """从 Crss 估算 CGDO 和 CGSO (F/m)

    Crss = CGDO + 单位沟道长度的 Cgd
    简单估算: CGDO = CGSO = Crss_pf * 1e-12 / 5
    """
    return crss_pf * 1e-12 / 5.0


def _cgbo_default() -> float:
    """CGBO 默认值（典型）"""
    return 1.0e-10


def _is_from_vsd(vsd_v: float, area: float = 1.0) -> float:
    """从 VSD 反推 IS（体二极管饱和电流）

    IS = If * exp(-Vsd / (N * Vt))
    Vt = 0.0259V @ 25°C
    默认 N=1.5
    """
    import math
    vt = 0.0259
    n = 1.5
    # 假设 If=10A 在 Vsd=0.9V（典型）
    if_vsd = 0.9
    if_a = 10.0
    is_val = if_a * math.exp(-if_vsd / (n * vt))
    return max(1e-18, min(1e-3, is_val))


def init_from_key_params(model: BSIM3Model, kp: SpiceKeyParams) -> BSIM3Model:
    """从 datasheet 关键参数初始化 BSIM3 模型

    Args:
        model: 要初始化的 BSIM3Model
        kp: SpiceKeyParams（从 SPICE_Params sheet 读出的 45 个参数）

    Returns:
        初始化后的 model（in-place + return）
    """
    # === Threshold (S1) ===
    # VTH0: datasheet 标称 3.0V, 但实测 100V SGT 实际 2-3V.  设为 2.5
    model.set_initial("VTH0", 2.5)
    model.set_initial("K1", 0.5)                       # 体效应系数
    model.set_initial("K2", 0.0)
    model.set_initial("DVT0", 2.2)
    model.set_initial("DVT1", 0.53)
    model.set_initial("NFACTOR", 2.0)
    model.set_initial("CDSC", 2.4e-4)

    # === Subthreshold (S2) ===
    model.set_initial("CDSCD", 2.4e-4)
    model.set_initial("CDSCB", 0.0)

    # === Mobility (S3) ===
    # U0 从 gfs 估算
    u0_est = _gfs_to_u0(kp.gfs_25c_s)
    model.set_initial("U0", u0_est)
    model.set_initial("UA", 2.0e-9)
    model.set_initial("UB", 5.0e-19)
    model.set_initial("UC", 5.0e-11)

    # === Saturation (S4) ===
    model.set_initial("VSAT", 1.0e5)                  # 默认 1e5 m/s
    model.set_initial("A0", 1.0)
    model.set_initial("AGS", 0.0)
    model.set_initial("KETA", 0.0)

    # === Output Resistance (S5) ===
    model.set_initial("PCLM", 0.5)
    model.set_initial("PDIBLC1", 0.3)
    model.set_initial("PDIBLC2", 0.05)
    model.set_initial("DROUT", 0.5)
    model.set_initial("PVAG", 1.0)

    # === Parasitic Resistance (S4) ===
    # RD + RS ≈ Rds_on(25C) - Rds_on_internal_estimate
    # 假设 Rds_on 测量值已包含 bond wire + clip，BSIM3 的 RD+RS 是 die-level
    # 简化: RD = RS = Rds_on_25C * 0.1
    rdson_total_ohm = kp.rdson_25c_10v_ohm
    rd_each = rdson_total_ohm * 0.05  # 5% 给 RD, 5% 给 RS, 90% 给沟道
    model.set_initial("RD", rd_each)
    model.set_initial("RS", rd_each)

    # === Capacitance (S6) ===
    # CGSO, CGDO 从 Crss 估算
    cgso_est = _cgdo_cgso_from_crss(kp.crss_25v_pf)
    model.set_initial("CGSO", cgso_est)
    model.set_initial("CGDO", cgso_est)
    model.set_initial("CGBO", _cgbo_default())

    # Junction parameters
    model.set_initial("MJ", 0.5)
    model.set_initial("MJSW", 0.33)
    model.set_initial("PB", 0.8)
    model.set_initial("PBSW", 0.8)
    model.set_initial("TT", 1.0e-12)

    # === Temperature (S5) ===
    # KT1 ≈ -dVth/dT (mV/°C → V/°C)
    kt1_est = abs(kp.dvth_dT_mv_per_c) * 1e-3
    model.set_initial("KT1", -kt1_est)  # 负温度系数（Vth 随 T 下降）
    model.set_initial("KT2", 0.022)
    model.set_initial("UTE", -1.5)
    model.set_initial("UA1", 1.0e-9)
    model.set_initial("UB1", -1.0e-18)
    model.set_initial("UC1", -5.6e-11)
    # PRT: 从 Rds_on 温度系数反推
    # R(T) = R(25) * (T/25)^PRT  →  PRT = log(R150/R25) / log(150/25)
    if kp.rdson_25c_10v_ohm > 0:
        import math
        ratio = kp.rdson_150c_10v_ohm / kp.rdson_25c_10v_ohm
        if ratio > 0:
            prt = math.log(ratio) / math.log(150 / 25)
            model.set_initial("PRT", prt)

    # === Process ===
    model.set_initial("TOX", 5.0e-8)                  # 50 nm
    model.set_initial("NSUB", 1.0e17)
    model.set_initial("XL", 0.0)
    model.set_initial("XW", 0.0)
    model.set_initial("DELTA", 0.01)
    model.set_initial("TNOM", 25.0)

    # === Body Diode (S6) ===
    is_est = _is_from_vsd(kp.vsd_25c_v)
    model.set_initial("IS", is_est)
    model.set_initial("N", 1.5)
    # BV 取 datasheet 击穿电压的 95%（更安全）
    model.set_initial("BV", kp.bvdss_0vgs_v * 0.95)
    model.set_initial("IBV", 1.0e-3)

    return model


def summary_init_from_key_params(kp: SpiceKeyParams) -> dict[str, float]:
    """纯函数版本：返回 dict 而不修改 model"""
    m = BSIM3Model()
    init_from_key_params(m, kp)
    return m.to_dict()
