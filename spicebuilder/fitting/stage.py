"""
stage.py
========
Stage - 单阶段拟合（对标 Mystic DoStage）。

一个 Stage = 用一组参数拟合一组 SimData：
  - 优化哪些参数（param_names）
  - 拟合哪些曲线（simdata）
  - 用什么误差函数（error_func）
  - 怎么评估拟合曲线（simulator）
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import numpy as np

from .optimizer import Optimizer
from .error_funcs import ERROR_FUNCS, rms_log
from ..data.simdata import SimData
from ..models.bsim3 import BSIM3Model


@dataclass
class StageResult:
    stage_name: str
    success: bool
    rms: float
    iterations: int
    nfev: int
    fitted_params: dict[str, float] = field(default_factory=dict)
    message: str = ""
    # Log-domain R² over this stage's fitted points only (in [0, 1]; 1 is perfect).
    # NaN-stamped if the stage had no fitted points (e.g. mask filtered them all).
    r_squared: float = float("nan")


class Stage:
    """单阶段拟合

    用法:
        stage = Stage(
            name="S1_Threshold",
            simdata=[idvg_25c, idvg_150c],
            param_names=["VTH0", "K1", "K2", "NFACTOR"],
            model=model,
            error_func="log",
        )
        result = stage.run(optimizer)
    """

    def __init__(self,
                 name: str,
                 simdata: list[SimData],
                 param_names: list[str],
                 model: BSIM3Model,
                 error_func: str = "log",
                 # simulator 在 Phase 2 (LTspice 接入) 时用
                 simulator=None):
        self.name = name
        self.simdata = simdata
        self.param_names = param_names
        self.model = model
        self.error_func_name = error_func
        self.error_func = ERROR_FUNCS[error_func]
        self.simulator = simulator  # 暂时 None，使用内置的简单 model 评估

    def _get_x0_and_bounds(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """取当前参数值作为 x0，bounds 从 model spec 取"""
        x0 = np.array([self.model.get(p) for p in self.param_names])
        lo = np.array([self.model.get_bounds(p)[0] for p in self.param_names])
        hi = np.array([self.model.get_bounds(p)[1] for p in self.param_names])
        return x0, lo, hi

    def _set_params_from_x(self, x: np.ndarray) -> None:
        """把优化结果写回 model"""
        for pname, val in zip(self.param_names, x):
            self.model.set(pname, float(val))

    def _residual(self, x: np.ndarray) -> np.ndarray:
        """计算残差向量

        当前实现：使用解析的 BSIM3 简化 model 估算 Id-Vg, Id-Vd
        Phase 2 接入 LTspice 时替换为 simulator 评估
        """
        self._set_params_from_x(x)
        residuals = []
        for sd in self.simdata:
            fit = self._eval(sd)
            if fit is None:
                # 无法评估，加一个 dummy
                residuals.append(np.ones(len(sd.ivar)) * 0.1)
                continue
            meas = sd.dvar
            # 物理 mask:
            #   - meas > 1e-9 （避免 log(0)）
            #   - Id-Vg: 动态 Vgs 下限（从 metadata 读取，per-stage 定制）
            #   - Id-Vd: 过滤 Vds < 0 的点
            mask = (meas > 1e-9) & np.isfinite(meas) & np.isfinite(fit)

            # Id-Vg 动态 Vgs 下限（per-stage 定制，通过 metadata 传递）
            if sd.curve_type == "IdVg":
                vgs_min = sd.metadata.get("vgs_floor_v")
                if vgs_min is not None:
                    mask &= sd.ivar >= vgs_min

            # Id-Vd 基础物理 mask
            if sd.curve_type == "IdVd":
                mask &= sd.ivar >= 0
            if not mask.any():
                continue
            if self.error_func_name == "log":
                r = np.log10(fit[mask] / meas[mask])
            else:
                r = (fit[mask] - meas[mask]) / (np.maximum(np.abs(meas[mask]), 1e-12))
            residuals.append(r)
        if not residuals:
            return np.array([0.0])
        return np.concatenate(residuals)

    def _eval(self, sd: SimData) -> Optional[np.ndarray]:
        """评估拟合曲线 (LTspice 优先，否则用简化 model)"""
        if self.simulator is not None:
            return self._eval_ltspice(sd)
        return self._eval_simple(sd)

    def _eval_ltspice(self, sd: SimData) -> Optional[np.ndarray]:
        """用 LTspice evaluator 评估曲线"""
        try:
            if sd.curve_type == "IdVg":
                vds = sd.metadata.get('vds_v', 5.0)
                return self.simulator.eval_idvg(self.model, sd.ivar, vds=vds)
            elif sd.curve_type == "IdVd":
                vgs = sd.metadata.get('vgs_v', 10.0)
                return self.simulator.eval_idvd(self.model, sd.ivar, vgs=vgs)
            elif sd.curve_type == "CvVds":
                cap = sd.metadata.get("cap_type") or "ciss"
                return self.simulator.eval_cv(self.model, sd.ivar, cap_type=cap)
            # Diode 暂用简化 (LTspice diode 仿真另需模型)
            elif sd.curve_type == "IsVsd":
                return self._eval_diode_simple(sd)
        except Exception as e:
            if self.simulator.verbose:
                print(f"[stage {self.name}] LTspice eval error: {e}")
        return self._eval_simple(sd)

    def _eval_simple(self, sd: SimData) -> Optional[np.ndarray]:
        """简化版 BSIM3 评估器（Phase 1 用，Phase 2 替换为 LTspice）

        支持 Id-Vg（log 域）和 Id-Vd（线性区近似）
        C-V / Qg 用简单模型
        """
        if sd.curve_type == "IdVg":
            return self._eval_idvg_simple(sd)
        elif sd.curve_type == "IdVd":
            return self._eval_idvd_simple(sd)
        elif sd.curve_type == "CvVds":
            return self._eval_cv_simple(sd)
        elif sd.curve_type == "IsVsd":
            return self._eval_diode_simple(sd)
        return None

    def _eval_idvg_simple(self, sd: SimData) -> np.ndarray:
        """简化 Id-Vg 评估（使用正确 BSIM3-like 公式，含 mobility degradation）

        注: 100V/100A SGT MOSFET 典型 die 参数:
          - 总沟道宽度 W ~ 100mm = 0.1m
          - 沟道长度 L ~ 1um
          - W/L ~ 1e5
        """
        vgs = sd.ivar
        vth = self.model.get("VTH0")
        n = self.model.get("NFACTOR")
        u0_cm2 = self.model.get("U0")  # cm²/Vs
        vsat = self.model.get("VSAT")  # m/s
        ua = self.model.get("UA")  # mobility degradation 1
        ub = self.model.get("UB")  # mobility degradation 2
        vt = 0.0259  # 26 mV @ 25°C
        cox = 6.9e-4  # F/m² (TOX=50nm)
        w_m = 4.0  # 4m = 40000 cells × 100um (full die沟道总宽)
        l_m = 1e-6    # 沟道长度 1um
        mu = u0_cm2 * 1e-4  # 转换为 m²/Vs

        vov = np.maximum(vgs - vth, 0)

        # 亚阈值电流 (指数区)
        # Id_sub = I0 * exp((Vgs-Vth) / (n·Vt))
        i0 = (w_m / l_m) * cox * mu * vt**2
        i_sub = i0 * np.exp(np.clip((vgs - vth) / (n * vt), -50, 50))

        # 强反型（饱和 + vsat 限制 + mobility degradation）
        # mobility: mu_eff = u0 / (1 + UA·vov + UB·vov²)
        mu_eff = mu / (1.0 + ua * vov + ub * vov**2)
        # Id_sat_full = 0.5 · mu_eff · Cox · (W/L) · vov²
        i_sat_full = 0.5 * (w_m / l_m) * cox * mu_eff * vov**2
        # Id_vsat = W · Cox · vov · vsat
        i_vsat = w_m * cox * vov * vsat
        # Id = 1 / (1/Id_sat + 1/Id_vsat) （vsat-limited）
        i_strong = i_sat_full * i_vsat / (i_sat_full + i_vsat + 1e-12)

        # 平滑过渡 (sigmoid 在 Vth 附近)
        alpha = 1.0 / (1.0 + np.exp(-(vgs - vth) / 0.05))
        i_d = i_sub * (1 - alpha) + i_strong * alpha
        # Floor set well below the sub-threshold measurement range (~1e-9 A)
        # so model predictions follow natural exp() decay.  The previous
        # 1e-15 floor caused 6-decade residuals vs measured sub-threshold
        # data, which masked as RMS=0.17 but blew R² to 0.
        return np.maximum(i_d, 1e-30)

    def _eval_idvd_simple(self, sd: SimData) -> np.ndarray:
        """简化 Id-Vd 评估（含 mobility degradation）"""
        vds = sd.ivar
        vgs_v = sd.metadata.get('vgs_v', 5.0)
        vth = self.model.get("VTH0")
        cox = 6.9e-4
        vsat = self.model.get("VSAT")
        ua = self.model.get("UA")
        ub = self.model.get("UB")
        w_m = 4.0  # 4m = 40000 cells × 100um (full die沟道总宽)
        l_m = 1e-6
        u0_cm2 = self.model.get("U0")
        mu = u0_cm2 * 1e-4
        vov = max(vgs_v - vth, 0)
        # mobility degradation
        mu_eff = mu / (1.0 + ua * vov + ub * vov**2)
        # 饱和电流 (vsat-limited)
        i_sat = w_m * cox * mu_eff * vov * vsat / (vov + vsat * l_m + 1e-9)
        # 线性区
        rdson = max(self.model.get("RD") + self.model.get("RS"), 1e-6)
        vds_clip = np.minimum(vds, vov)
        # Linear-region current is Vds / R_dson, NOT Vov * Vds / R_dson.
        # The original formula had an extra `vov` factor that was a
        # mis-typed "ohmic" model; it produced I_lin ~ 200 A for Vds=30mV
        # and Vov=6.4, far above the real ~30 A from a 1.8 mΩ Rdson.
        # Id,linear = Vds / R_dson (BSIM3 ohmic-region formulation)
        i_lin = vds_clip / rdson
        i_d = np.where(vds < vov, i_lin, i_sat)
        # 沟道长度调制
        pclm = self.model.get("PCLM")
        i_d = np.where(vds < vov, i_d, i_d * (1 + pclm * (vds - vov)))
        return np.maximum(i_d, 1e-9)

    def _eval_cv_simple(self, sd: SimData) -> np.ndarray:
        """简化 C-V 评估 (与 die 几何一致: W=0.1m, L=1e-6m)"""
        vds = sd.ivar
        cap_type = sd.metadata.get('cap_type', 'ciss')
        cgdo = self.model.get("CGDO")  # F/m
        cgso = self.model.get("CGSO")
        cgbo = self.model.get("CGBO")
        w_m = 4.0  # 4m = 40000 cells × 100um (full die沟道总宽)
        l_m = 1e-6
        # 单位: CGDO (F/m) × W (m) = 寄生电容
        if cap_type == 'ciss':
            base = (cgdo + cgso) * w_m + cgbo * l_m
        elif cap_type == 'coss':
            base = cgdo * w_m
        elif cap_type == 'crss':
            base = cgdo * w_m  # 简化: Crss ≈ Cgd
        else:
            base = cgdo * w_m
        # C-V 随 Vds 衰减（简化）
        decay = 1.0 / (1.0 + np.maximum(vds, 0) / 5.0)
        return base * (1.0 + 0.5 * decay) * 1e12  # 转 pF

    def _eval_diode_simple(self, sd: SimData) -> np.ndarray:
        """简化体二极管评估"""
        vsd = sd.ivar
        is_ = self.model.get("IS")
        n = self.model.get("N")
        vt = 0.0259
        i_d = is_ * (np.exp(vsd / (n * vt)) - 1)
        # Diode curve is in absolute-A units; keep the floor very low
        # so the residual on near-zero measurements (Vsd ~ 0) doesn't
        # get artificially inflated by an arbitrary clamp.
        return np.maximum(i_d, 1e-30)

    def run(self, optimizer: Optimizer) -> StageResult:
        """运行拟合"""
        x0, lo, hi = self._get_x0_and_bounds()
        # 检查 bounds
        if np.any(x0 < lo) or np.any(x0 > hi):
            # clip 到 bounds
            x0 = np.clip(x0, lo, hi)

        result = optimizer.minimize(
            residual_func=self._residual,
            x0=x0,
            bounds=(lo, hi),
        )

        # 写回 model
        self._set_params_from_x(result.x)
        for pname, val in zip(self.param_names, result.x):
            self.model.set(pname, float(val))

        # 把拟合结果存到 simdata
        for sd in self.simdata:
            fit = self._eval(sd)
            if fit is not None:
                sd.set_fit(fit)

        # Compute stage-level log-domain R² on the same simdata points
        # used by the residual function.  This is per-stage, so it
        # avoids the cross-magnitude SST corruption that would happen
        # if we pooled C-V (pF) with body-diode (A) and IdVd (A) into
        # a single R².
        r_squared = self._stage_r_squared()

        return StageResult(
            stage_name=self.name,
            success=result.success,
            rms=result.rms,
            iterations=result.nit,
            nfev=result.nfev,
            fitted_params={p: float(v) for p, v in zip(self.param_names, result.x)},
            message=result.message,
            r_squared=r_squared,
        )

    def _stage_r_squared(self) -> float:
        """Per-stage log-domain R² (in [0, 1]; 1 is perfect; NaN if no data).

        R² = 1 - SSR / SST
        SST is computed relative to the mean of THIS stage's points
        only, not pooled across stages — so per-stage R² is meaningful
        even when stage magnitudes span orders.
        """
        import math
        meas_logs: list = []
        fit_logs: list = []
        for sd in self.simdata:
            if sd.dvar is None or sd.fit is None:
                continue
            m = np.asarray(sd.dvar, dtype=float)
            f = np.asarray(sd.fit, dtype=float)
            mask = (m > 0) & (f > 0)
            if mask.any():
                meas_logs.append(np.log10(m[mask]))
                fit_logs.append(np.log10(f[mask]))
        if not meas_logs:
            return float("nan")
        m_arr = np.concatenate(meas_logs)
        f_arr = np.concatenate(fit_logs)
        ss_res = float(np.sum((m_arr - f_arr) ** 2))
        ss_tot = float(np.sum((m_arr - m_arr.mean()) ** 2))
        if ss_tot <= 0:
            return 0.0
        return max(0.0, 1.0 - ss_res / ss_tot)
