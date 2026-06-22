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
            fit = self._eval_simple(sd)
            if fit is None:
                # 无法评估，加一个 dummy
                residuals.append(np.ones(len(sd.ivar)) * 0.1)
                continue
            meas = sd.dvar
            # 物理 mask:
            #   - meas > 1e-9 （避免 log(0)）
            #   - Id-Vg: 过滤 Vgs < 0.5V 的 OFF 状态点（工程师不关心）
            #   - Id-Vd: 过滤 Vds < 0 的点
            mask = (meas > 1e-9) & np.isfinite(meas) & np.isfinite(fit)
            if sd.curve_type == "IdVg":
                mask &= sd.ivar >= 1.0  # 跳过 Vgs < 1V （亚阈值以下，简化模型不准）
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
        """简化 Id-Vg 评估（使用正确 BSIM3-like 公式）

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
        vt = 0.0259  # 26 mV @ 25°C
        cox = 6.9e-4  # F/m² (TOX=50nm)
        w_m = 0.1     # 总沟道宽度 0.1m = 100mm (100V/100A SGT die)
        l_m = 1e-6    # 沟道长度 1um
        mu = u0_cm2 * 1e-4  # 转换为 m²/Vs

        vov = np.maximum(vgs - vth, 0)

        # 亚阈值电流 (指数区)
        # Id_sub = I0 * exp((Vgs-Vth) / (n·Vt))
        # I0 ≈ μ·Cox·(W/L)·Vt²
        i0 = (w_m / l_m) * cox * mu * vt**2
        i_sub = i0 * np.exp(np.clip((vgs - vth) / (n * vt), -50, 50))

        # 强反型（饱和 + vsat 限制）
        # Id_sat_full = 0.5 · μ · Cox · (W/L) · vov²
        # Id_vsat = W · Cox · vov · vsat
        # Id = 1 / (1/Id_sat + 1/Id_vsat) （vsat-limited）
        i_sat_full = 0.5 * (w_m / l_m) * cox * mu * vov**2
        i_vsat = w_m * cox * vov * vsat
        i_strong = i_sat_full * i_vsat / (i_sat_full + i_vsat + 1e-12)

        # 平滑过渡 (sigmoid 在 Vth 附近)
        alpha = 1.0 / (1.0 + np.exp(-(vgs - vth) / 0.05))
        i_d = i_sub * (1 - alpha) + i_strong * alpha
        return np.maximum(i_d, 1e-15)

    def _eval_idvd_simple(self, sd: SimData) -> np.ndarray:
        """简化 Id-Vd 评估（与 _eval_idvg_simple 同样的 w_m, l_m）"""
        vds = sd.ivar
        vgs_v = sd.metadata.get('vgs_v', 5.0)
        vth = self.model.get("VTH0")
        cox = 6.9e-4
        vsat = self.model.get("VSAT")
        w_m = 0.1  # 与 Id-Vg 一致
        l_m = 1e-6
        u0_cm2 = self.model.get("U0")
        mu = u0_cm2 * 1e-4
        vov = max(vgs_v - vth, 0)
        # 饱和电流 (vsat-limited)
        i_sat = w_m * cox * vov * vsat / (vov + vsat * l_m + 1e-9)
        # 线性区
        rdson = max(self.model.get("RD") + self.model.get("RS"), 1e-6)
        vds_clip = np.minimum(vds, vov)
        i_lin = vov * vds_clip / rdson
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
        w_m = 0.1  # 与 Id-Vg/Id-Vd 一致
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
        return np.maximum(i_d, 1e-15)

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
            fit = self._eval_simple(sd)
            if fit is not None:
                sd.set_fit(fit)

        return StageResult(
            stage_name=self.name,
            success=result.success,
            rms=result.rms,
            iterations=result.nit,
            nfev=result.nfev,
            fitted_params={p: float(v) for p, v in zip(self.param_names, result.x)},
            message=result.message,
        )
