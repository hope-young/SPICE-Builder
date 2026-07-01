"""
sgt_6stage.py
=============
Si SGT MOSFET 6 阶段参数提取策略。

Stage 1 - Threshold (S1):
    拟合 VTH0, K1, K2, DVT0, DVT1, NFACTOR, CDSC
    目标曲线: Id-Vg @ Vds=0.5V, 25°C

Stage 2 - Subthreshold (S2):
    拟合 NFACTOR, CDSCD, CDSCB
    目标曲线: Id-Vg @ Vds=0.5V (亚阈值区)

Stage 3 - Linear Mobility (S3):
    拟合 U0, UA, UB, UC
    目标曲线: Id-Vg @ Vds=5V (线性区)

Stage 4 - Saturation (S4):
    拟合 VSAT, A0, AGS, KETA, RD, RS
    目标曲线: Id-Vd @ Vgs=5, 6, 8, 10V

Stage 5 - Output Resistance (S5):
    拟合 PCLM, PDIBLC1, PDIBLC2, DROUT, PVAG
             KT1, KT2, UTE, UA1, UB1, UC1, PRT (温度)
    目标曲线: Id-Vd (饱和区) + 多温度

Stage 6 - Capacitance & Diode (S6):
    拟合 CGBO, CGDO, CGSO, MJ, MJSW, PB, PBSW, TT
             IS, N, BV, IBV
    目标曲线: C-V + Body Diode
"""
from __future__ import annotations
from typing import List, Optional, Set

from ..data.loader_sdh import SpiceDataSet
from ..data.simdata import SimData
from ..models.bsim3 import BSIM3Model
from ..fitting import Optimizer, Stage, Engine


def _resolve_subthreshold_hi(dataset: SpiceDataSet) -> float:
    """Pick the upper Vgs bound for S2 subthreshold mask.

    Use the dataset's typical Vth-0.5V so the mask adapts to the device.
    Falls back to 2.5V if the key param is missing or implausible.
    """
    vth = getattr(dataset.key_params, "vth_25c_v", None)
    if vth is None or vth <= 0:
        return 2.5
    return max(1.5, vth - 0.5)


def _resolve_saturation_lo(dataset: SpiceDataSet) -> float:
    """Pick the lower Vds bound for S5 saturation mask.

    Id-Vd datasets often have a dense low-Vds linear region and a
    sparser high-Vds saturation region.  Anchoring the cut to half
    of vds_max is fragile on short-range sweeps (e.g. SDH10N2P1WC-AA's
    Id-Vd only sweeps to ~5.4V, so vds_max*0.5=2.7V excludes everything).
    Use the 40th percentile instead so at least ~60% of Vds points
    survive the cut regardless of the test sweep range.
    """
    import statistics
    vds_vals = [pt.get("vds_v") for pt in (dataset.idvd or [])
                if pt.get("vds_v") is not None]
    if not vds_vals:
        return 2.0
    return float(statistics.quantiles(vds_vals, n=10, method="inclusive")[3])  # 40th percentile



def build_sgt_engine(dataset: SpiceDataSet,
                      model: BSIM3Model,
                      optimizer: Optimizer,
                      error_threshold: float = 0.5,
                      max_loops: int = 3,
                      verbose: bool = True,
                      simulator=None,
                      progress_callback=None,
                      stages: Optional[List[str]] = None) -> Engine:
    """构建 Si SGT 6 阶段提取 pipeline

    Args:
        dataset: 加载的 SPICE 数据
        model: BSIM3 模型（已用 init_from_key_params 初始化）
        optimizer: Optimizer 实例
        error_threshold: Engine 收敛阈值（总 RMS < 此值）
        max_loops: 最大外层循环次数
        verbose: 是否打印阶段信息
        simulator: LTspiceEvaluator 或 None (None=用简化公式)
        progress_callback: Optional callable forwarded to Engine.  See engine.py.
        stages: Optional subset of stage IDs to construct.
                None runs all six stages (default).
                E.g. ['S1', 'S2'] runs only threshold + subthreshold.
    """
    want: Set[str] = set(stages) if stages else {"S1", "S2", "S3", "S4", "S5", "S6"}
    s2_threshold_v = _resolve_subthreshold_hi(dataset)
    s5_saturation_v = _resolve_saturation_lo(dataset)
    out = []

    # === S1: Threshold ===
    if "S1" in want:
        s1_sim = SimData.from_idvg(dataset.idvg_vds05, temperature_c=25, vds_v=0.5)
        # S1 Vgs 下限: 4V（保守策略，避免近阈值区噪声）
        s1_sim.metadata["vgs_floor_v"] = 4.0
        s1 = Stage(
            name="S1_Threshold",
            simdata=[s1_sim],
            param_names=model.get_params_by_stage("S1"),
            model=model,
            error_func="log",
            simulator=simulator,
        )
        out.append(s1)
        if verbose:
            print(f"S1: params={s1.param_names}, data={s1_sim.n_points} pts "
                  f"(Vgs >= {s1_sim.metadata['vgs_floor_v']:.1f}V)")

    # === S2: Subthreshold (禁用 - 数据无效) ===
    # 注释原因：数据集中 Vgs < 2.5V 的所有点电流都在 23-36 mA（仪器下限噪声），
    # 不是真正的亚阈值电流（应为 µA 量级），无法用于 NFACTOR 参数拟合。
    # if "S2" in want:
    #     ...

    # === S3: Linear Mobility ===
    if "S3" in want:
        s3_sim = SimData.from_idvg(dataset.idvg_vds5, temperature_c=25, vds_v=5.0)
        # S3 Vgs 下限: 4V（保守策略）
        s3_sim.metadata["vgs_floor_v"] = 4.0
        s3 = Stage(
            name="S3_LinearMobility",
            simdata=[s3_sim],
            param_names=model.get_params_by_stage("S3"),
            model=model,
            error_func="log",
            simulator=simulator,
        )
        out.append(s3)
        if verbose:
            print(f"S3: params={s3.param_names}, data={s3_sim.n_points} pts "
                  f"(Vgs >= {s3_sim.metadata['vgs_floor_v']:.1f}V)")

    # === S4: Saturation ===
    if "S4" in want:
        s4_sims = []
        for vgs in [5.0, 6.0, 8.0, 10.0]:
            try:
                sd = SimData.from_idvd(dataset.idvd, vgs_v=vgs, temperature_c=25)
                if sd.n_points > 0:
                    s4_sims.append(sd)
            except ValueError:
                pass
        s4 = Stage(
            name="S4_Saturation",
            simdata=s4_sims,
            param_names=model.get_params_by_stage("S4"),
            model=model,
            error_func="log",
            simulator=simulator,
        )
        out.append(s4)
        if verbose:
            print(f"S4: params={s4.param_names}, data={sum(s.n_points for s in s4_sims)} pts ({len(s4_sims)} curves)")

    # === S5: Output Resistance (饱和区段) ===
    if "S5" in want:
        s5_sims = []
        for vgs in [6.0, 8.0, 10.0]:
            try:
                sd = SimData.from_idvd(dataset.idvd, vgs_v=vgs, temperature_c=25)
                if sd.n_points > 0:
                    # dynamic saturation cut: Vds > 40th percentile
                    sd_sat = sd.filter("gt", s5_saturation_v, dtype="ivar")
                    if sd_sat.n_points > 0:
                        s5_sims.append(sd_sat)
            except ValueError:
                pass
        s5 = Stage(
            name="S5_OutputResistance",
            simdata=s5_sims,
            param_names=model.get_params_by_stage("S5"),
            model=model,
            error_func="log",
            simulator=simulator,
        )
        out.append(s5)
        if verbose:
            print(f"S5: params={s5.param_names}, data={sum(s.n_points for s in s5_sims)} pts "
                  f"(mask: Vds > {s5_saturation_v:.2f}V)")

    # === S6: Capacitance & Diode ===
    if "S6" in want:
        s6_sims = []
        for cap in ['ciss', 'coss', 'crss']:
            try:
                sd = SimData.from_cv(dataset.cv_vds, cap_type=cap)
                s6_sims.append(sd)
            except ValueError:
                pass
        try:
            sd_body = SimData.from_body_diode(dataset.body_diode, temperature_c=25)
            s6_sims.append(sd_body)
        except ValueError:
            pass
        s6 = Stage(
            name="S6_Capacitance_Diode",
            simdata=s6_sims,
            param_names=model.get_params_by_stage("S6"),
            model=model,
            error_func="linear",
            simulator=simulator,
        )
        out.append(s6)
        if verbose:
            print(f"S6: params={s6.param_names}, data={sum(s.n_points for s in s6_sims)} pts")

    return Engine(
        out,
        error_threshold=error_threshold,
        max_loops=max_loops,
        progress_callback=progress_callback,
    )


def run_sgt_6stage(dataset: SpiceDataSet,
                    model: BSIM3Model,
                    optimizer: Optimizer,
                    error_threshold: float = 0.5,
                    max_loops: int = 3,
                    verbose: bool = True):
    """构建并运行 SGT 6 阶段 pipeline

    Returns: (engine, engine_result)
    """
    engine = build_sgt_engine(dataset, model, optimizer,
                              error_threshold=error_threshold,
                              max_loops=max_loops, verbose=verbose)
    if verbose:
        print(f"\n=== Running {len(engine.stages)} stages, "
              f"error_threshold={error_threshold}, max_loops={max_loops} ===")
    result = engine.run(optimizer)
    if verbose:
        print(f"\n=== Engine result ===")
        print(f"  Success: {result.success}")
        print(f"  Total RMS: {result.total_rms:.4f}")
        print(f"  Iterations: {result.iterations}")
        print(f"  Message: {result.message}")
        for sr in result.stage_results:
            print(f"  Stage '{sr.stage_name}': success={sr.success}, "
                  f"RMS={sr.rms:.4f}, nfev={sr.nfev}")
    return engine, result
