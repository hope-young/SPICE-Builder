"""
optimizer.py
============
Optimizer - scipy 优化算法封装。

支持 6 种算法：
  - trf          Trust Region Reflective（默认，类似 Mystic BOUNDED_TRUST_REGION）
  - lm           Levenberg-Marquardt
  - dogbox       Dogleg + Box constraints
  - bfgs         Broyden-Fletcher-Goldfarb-Shanno（无 bounds）
  - l-bfgs-b     L-BFGS-B（带 bounds）
  - differential_evolution  全局进化
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Callable, Optional
import numpy as np
from scipy.optimize import least_squares, minimize, differential_evolution


@dataclass
class OptimizeResult:
    success: bool
    x: np.ndarray
    fun: float               # 最终目标函数值（残差平方和或 RMS）
    nfev: int                # 函数评估次数
    nit: int                 # 迭代次数
    message: str
    rms: float = float('inf')


class Optimizer:
    """scipy 优化算法封装"""

    def __init__(self, method: str = "trf"):
        self.method = method
        # 容差（降低以允许更充分的优化）
        self.eps1: float = 1e-6   # ftol（函数值变化容差）
        self.eps2: float = 1e-6   # xtol（参数变化容差）
        self.eps3: float = 1e-6   # gtol（梯度容差，关键）
        self.max_iter: int = 200  # 增加迭代上限
        # 并行
        self.parallel_jobs: int = 1

    def set_eps1(self, v: float): self.eps1 = v; return self
    def set_eps2(self, v: float): self.eps2 = v; return self
    def set_eps3(self, v: float): self.eps3 = v; return self
    def set_max_iter(self, v: int): self.max_iter = v; return self

    def minimize(self,
                 residual_func: Callable[[np.ndarray], np.ndarray],
                 x0: np.ndarray,
                 bounds: tuple[np.ndarray, np.ndarray]) -> OptimizeResult:
        """最小化

        Args:
            residual_func: (x) -> ndarray of residuals
            x0: 初始参数
            bounds: (lower, upper) arrays
        """
        # LM 不支持 bounds, 自动转 trf
        method = self.method
        if method == "lm":
            method = "trf"
        if method in ("trf", "dogbox"):
            return self._least_squares(residual_func, x0, bounds)
        elif method in ("bfgs", "l-bfgs-b", "powell", "cg", "nelder-mead"):
            return self._minimize(residual_func, x0, bounds)
        elif self.method == "differential_evolution":
            return self._de(residual_func, bounds)
        else:
            raise ValueError(f"未知方法: {self.method}")

    def _least_squares(self, residual_func, x0, bounds) -> OptimizeResult:
        try:
            # 检查初始 residual
            r0 = residual_func(x0)
            if not np.all(np.isfinite(r0)):
                return OptimizeResult(
                    success=False, x=x0, fun=float('inf'),
                    nfev=1, nit=0, message="Initial residual has inf/nan", rms=float('inf'),
                )
            r = least_squares(
                residual_func, x0,
                bounds=bounds,
                method=self.method,
                ftol=self.eps1,
                xtol=self.eps2,
                gtol=self.eps3,
                max_nfev=self.max_iter * max(1, len(x0)),
                diff_step=1e-4,  # 相对步长，对于 VTH0=3.5 → 步长 0.35mV（适配 LTspice 数值精度）
            )
            rms = float(np.sqrt(np.mean(r.fun ** 2)))
            return OptimizeResult(
                success=r.success,
                x=r.x,
                fun=float(np.sum(r.fun ** 2)),
                nfev=r.nfev,
                nit=getattr(r, 'nit', 0),  # scipy 1.16+ 不一定有
                message=str(r.message)[:100],
                rms=rms,
            )
        except Exception as e:
            return OptimizeResult(
                success=False, x=x0, fun=float('inf'),
                nfev=0, nit=0, message=f"Error: {e}", rms=float('inf'),
            )

    def _minimize(self, residual_func, x0, bounds) -> OptimizeResult:
        # 目标函数 = sum(residual^2) / 2（scipy 习惯）
        def obj(x):
            r = residual_func(x)
            return float(0.5 * np.sum(r ** 2))
        try:
            r = minimize(
                obj, x0, method=self.method,
                bounds=list(zip(bounds[0], bounds[1])),
                options={"maxiter": self.max_iter, "gtol": self.eps3},
            )
            return OptimizeResult(
                success=r.success,
                x=r.x,
                fun=float(r.fun),
                nfev=r.nfev,
                nit=r.nit,
                message=str(r.message)[:100],
                rms=float(np.sqrt(r.fun / max(1, len(x0)))) if np.isfinite(r.fun) else float('inf'),
            )
        except Exception as e:
            return OptimizeResult(
                success=False, x=x0, fun=float('inf'),
                nfev=0, nit=0, message=f"Error: {e}", rms=float('inf'),
            )

    def _de(self, residual_func, bounds) -> OptimizeResult:
        def obj(x):
            r = residual_func(x)
            return float(np.sum(r ** 2))
        try:
            r = differential_evolution(
                obj,
                bounds=list(zip(bounds[0], bounds[1])),
                maxiter=self.max_iter,
                tol=self.eps1,
                seed=42,
            )
            rms = float(np.sqrt(r.fun / max(1, len(r.x))))
            return OptimizeResult(
                success=r.success,
                x=r.x,
                fun=float(r.fun),
                nfev=r.nfev,
                nit=r.nit,
                message=str(r.message)[:100],
                rms=rms,
            )
        except Exception as e:
            return OptimizeResult(
                success=False, x=np.zeros(len(bounds[0])),
                fun=float('inf'), nfev=0, nit=0,
                message=f"Error: {e}", rms=float('inf'),
            )
