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

from .optimizer import Optimizer, EarlyStop
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
    # Log-domain R² (默认), 适合跨数量级数据
    # NaN-stamped if the stage had no fitted points (e.g. mask filtered them all).
    r_squared: float = float("nan")
    # Linear-domain R² (适合视觉直观比较)
    r_squared_linear: float = float("nan")


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
                 simulator=None,
                 history_interval: int = 0,
                 auto_expand_bounds: bool = False,
                 max_bound_expansions: int = 0,
                 bound_expand_factor: float = 3.0,
                 stop_r2_log: float | None = None,
                 stop_r2_linear: float | None = None,
                 stop_r2_primary_only: bool = True):
        """history_interval: 每 N 次 residual 评估保存一次中间状态 (0=不保存)。
        用于前端实时动画展示拟合收敛过程。
        """
        if simulator is None:
            raise ValueError(
                "Stage 必须传入 LTspice simulator (LTspiceEvaluator)。"
                "本工程不允许任何简化/mock 评估器。"
            )
        self.name = name
        self.simdata = simdata
        self.param_names = param_names
        self.model = model
        self.error_func_name = error_func
        self.error_func = ERROR_FUNCS[error_func]
        self.simulator = simulator
        self.history_interval = history_interval
        self.auto_expand_bounds = auto_expand_bounds
        self.max_bound_expansions = max(0, int(max_bound_expansions))
        self.bound_expand_factor = max(1.1, float(bound_expand_factor))
        self.bound_events: list[dict] = []
        self.history: list[dict] = []  # [{"step": n, "params": {...}, "rms": ...}, ...]
        self._history_listeners: list = []  # 实时回调 (step, history_entry) -> None
        self.stop_r2_log = stop_r2_log
        self.stop_r2_linear = stop_r2_linear
        self.stop_r2_primary_only = stop_r2_primary_only

    def add_history_listener(self, fn) -> None:
        """添加 history 实时回调 (用于 SSE 流式响应)."""
        self._history_listeners.append(fn)

    def _emit_history(self, entry: dict) -> None:
        for fn in self._history_listeners:
            try:
                fn(entry)
            except Exception:
                pass

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
        """计算残差向量。

        每个 SimData 必须用 simulator (LTspiceEvaluator) 评估,不允许任何 mock。
        """
        self._set_params_from_x(x)
        # history 记录: 每 N 次评估保存一次 (1=每步都存, 5=每5步存一次)
        if self.history_interval > 0:
            n = len(self.history)
            # residual 函数可能被同一次迭代调用 2-3 次 (有限差分), 所以用 n 与 interval 判断
            # 第 0 步必存, 之后每 N 步存
            should_record = (n == 0) or (n < self.history_interval * 50) and ((n - 1) % self.history_interval == 0)
            # 简化: 每次都存, history_interval=1; history_interval=5 则每 5 步存
            should_record = (n == 0) or (self.history_interval == 1) or (n % self.history_interval == 0)
            if should_record:
                self._record_history(n)
        residuals = []
        for sd in self.simdata:
            fit = self._eval(sd)
            if fit is None:
                raise RuntimeError(
                    f"[stage {self.name}] LTspice 评估失败,曲线类型={sd.curve_type}。"
                    "本工程禁止 mock 评估。"
                )
            meas = sd.dvar
            mask = (meas > 1e-9) & np.isfinite(meas) & np.isfinite(fit)

            # 区间过滤
            if "vmin" in sd.metadata:
                mask &= sd.ivar >= sd.metadata["vmin"]
            if "vmax" in sd.metadata:
                mask &= sd.ivar <= sd.metadata["vmax"]

            # Id-Vg 的可选下限
            if sd.curve_type == "IdVg":
                vgs_min = sd.metadata.get("vgs_floor_v")
                if vgs_min is not None and "vmin" not in sd.metadata:
                    mask &= sd.ivar >= vgs_min

            # Id-Vd 物理下限
            if sd.curve_type == "IdVd":
                mask &= sd.ivar >= 0

            if not mask.any():
                continue
            if self.error_func_name == "log":
                r = np.log10(fit[mask] / meas[mask])
            else:
                r = (fit[mask] - meas[mask]) / (np.maximum(np.abs(meas[mask]), 1e-12))
            weight = float(sd.metadata.get("loss_weight", 1.0))
            if weight <= 0:
                continue
            if weight != 1.0:
                r = r * np.sqrt(weight)
            residuals.append(r)
        if not residuals:
            return np.array([0.0])
        return np.concatenate(residuals)

    def _record_history(self, step: int) -> None:
        """记录一次当前参数 + sim 曲线状态。"""
        try:
            sim_curves: dict[str, list[float]] = {}
            for sd in self.simdata:
                # 跑全段 sim
                if sd.curve_type == "IdVg":
                    vds = sd.metadata.get("vds_v", 0.5)
                    sim_arr = self.simulator.eval_idvg(self.model, sd.ivar, vds=vds)
                elif sd.curve_type == "IdVd":
                    vgs = sd.metadata.get("vgs_v", 10.0)
                    sim_arr = self.simulator.eval_idvd(self.model, sd.ivar, vgs=vgs, vds_max=float(sd.ivar.max() * 1.1))
                else:
                    continue
                sim_curves[sd.name] = sim_arr.tolist()

            # R² on each sim.  log-domain is the most meaningful progress
            # indicator for Id-Vg because the optimizer itself minimizes
            # log residuals across orders of magnitude.
            r2_log: dict[str, float] = {}
            r2_linear: dict[str, float] = {}
            residuals: list[np.ndarray] = []
            for sd in self.simdata:
                if sd.name not in sim_curves:
                    continue
                sim_arr = np.asarray(sim_curves[sd.name], dtype=float)
                m = np.asarray(sd.dvar, dtype=float)
                mask = self._fit_mask(sd, sim_arr)
                if mask.sum() > 1:
                    r2_log[sd.name] = self._r2_score(m[mask], sim_arr[mask], domain="log")
                    r2_linear[sd.name] = self._r2_score(m[mask], sim_arr[mask], domain="linear")
                    if self.error_func_name == "log":
                        r = np.log10(sim_arr[mask] / m[mask])
                    else:
                        r = (sim_arr[mask] - m[mask]) / np.maximum(np.abs(m[mask]), 1e-12)
                    weight = float(sd.metadata.get("loss_weight", 1.0))
                    if weight > 0:
                        if weight != 1.0:
                            r = r * np.sqrt(weight)
                        residuals.append(r)
                else:
                    r2_log[sd.name] = 0.0
                    r2_linear[sd.name] = 0.0

            if residuals:
                all_res = np.concatenate(residuals)
                cost = float(0.5 * np.sum(all_res ** 2))
                fit_rms = float(np.sqrt(np.mean(all_res ** 2)))
            else:
                cost = 0.0
                fit_rms = 0.0

            params = {p: self.model.get(p) for p in self.param_names}
            prev = self.history[-1] if self.history else None
            ftol_metric = 0.0
            xtol_metric = 0.0
            gtol_metric = 0.0
            if prev:
                prev_cost = float(prev.get("cost", cost))
                prev_rms = float(prev.get("fit_rms", fit_rms))
                ftol_metric = abs(prev_cost - cost) / max(abs(prev_cost), abs(cost), 1e-30)
                prev_params = prev.get("params", {})
                delta = []
                curr = []
                for p in self.param_names:
                    if p in prev_params:
                        delta.append(params[p] - float(prev_params[p]))
                        curr.append(params[p])
                if delta:
                    xtol_metric = float(np.linalg.norm(delta) / (1.0 + np.linalg.norm(curr)))
                gtol_metric = abs(prev_rms - fit_rms) / max(abs(prev_rms), abs(fit_rms), 1e-30)

            self.history.append({
                "step": step,
                "params": params,
                "sim_curves": sim_curves,
                "r2_log": r2_log,
                "r2_linear": r2_linear,
                "cost": cost,
                "fit_rms": fit_rms,
                "ftol_metric": float(ftol_metric),
                "xtol_metric": float(xtol_metric),
                "gtol_metric": float(gtol_metric),
                "bound_events": list(self.bound_events),
            })
            self._emit_history(self.history[-1])
            self._raise_if_r2_stop_reached(
                r2_log=r2_log,
                r2_linear=r2_linear,
                params=params,
                fit_rms=fit_rms,
                cost=cost,
            )
        except EarlyStop:
            raise
        except Exception as e:
            print(f"[Stage {self.name}] history record failed: {e}")

    def _raise_if_r2_stop_reached(
        self,
        *,
        r2_log: dict[str, float],
        r2_linear: dict[str, float],
        params: dict[str, float],
        fit_rms: float,
        cost: float,
    ) -> None:
        if self.stop_r2_log is None or self.stop_r2_linear is None:
            return
        if not self.simdata:
            return
        names = [self.simdata[0].name] if self.stop_r2_primary_only else [sd.name for sd in self.simdata]
        if not names:
            return
        for name in names:
            if r2_log.get(name, 0.0) < self.stop_r2_log:
                return
            if r2_linear.get(name, 0.0) < self.stop_r2_linear:
                return
        x = np.array([params[p] for p in self.param_names], dtype=float)
        primary = names[0]
        raise EarlyStop(
            x=x,
            rms=fit_rms,
            fun=2.0 * cost,
            message=(
                "R2 stop reached: "
                f"R²(log)={r2_log.get(primary, 0.0):.4f} >= {self.stop_r2_log:.4f}, "
                f"R²(linear)={r2_linear.get(primary, 0.0):.4f} >= {self.stop_r2_linear:.4f}"
            ),
        )

    def _fit_mask(self, sd: SimData, fit: np.ndarray) -> np.ndarray:
        meas = np.asarray(sd.dvar, dtype=float)
        mask = (meas > 1e-30) & np.isfinite(meas) & np.isfinite(fit) & (fit > 0)
        if "vmin" in sd.metadata:
            mask &= sd.ivar >= sd.metadata["vmin"]
        if "vmax" in sd.metadata:
            mask &= sd.ivar <= sd.metadata["vmax"]
        if sd.curve_type == "IdVg":
            vgs_min = sd.metadata.get("vgs_floor_v")
            if vgs_min is not None and "vmin" not in sd.metadata:
                mask &= sd.ivar >= vgs_min
        if sd.curve_type == "IdVd":
            mask &= sd.ivar >= 0
        return mask

    @staticmethod
    def _r2_score(meas: np.ndarray, fit: np.ndarray, domain: str = "log") -> float:
        if domain == "log":
            valid = (meas > 0) & (fit > 0) & np.isfinite(meas) & np.isfinite(fit)
            if valid.sum() <= 1:
                return 0.0
            y = np.log10(meas[valid])
            yhat = np.log10(fit[valid])
        else:
            valid = np.isfinite(meas) & np.isfinite(fit)
            if valid.sum() <= 1:
                return 0.0
            y = meas[valid]
            yhat = fit[valid]
        ss_res = float(np.sum((y - yhat) ** 2))
        ss_tot = float(np.sum((y - y.mean()) ** 2))
        if ss_tot <= 0:
            return 0.0
        return max(0.0, 1.0 - ss_res / ss_tot)

    def _eval(self, sd: SimData) -> Optional[np.ndarray]:
        """仅通过 LTspice simulator 评估,不允许任何 mock。"""
        return self._eval_ltspice(sd)

    def _eval_ltspice(self, sd: SimData) -> Optional[np.ndarray]:
        """用 LTspice evaluator 评估曲线。失败直接抛出,不准兜底。"""
        if sd.curve_type == "IdVg":
            vds = sd.metadata.get('vds_v', 5.0)
            return self.simulator.eval_idvg(self.model, sd.ivar, vds=vds)
        elif sd.curve_type == "IdVd":
            vgs = sd.metadata.get('vgs_v', 10.0)
            return self.simulator.eval_idvd(self.model, sd.ivar, vgs=vgs)
        elif sd.curve_type == "CvVds":
            cap = sd.metadata.get("cap_type") or "ciss"
            return self.simulator.eval_cv(self.model, sd.ivar, cap_type=cap)
        elif sd.curve_type == "IsVsd":
            raise NotImplementedError(
                "体二极管 LTspice 仿真暂未实现 (评估器尚无 .model D 包装)。"
                "请等 Step 6 电容 + 体二极管一起做。"
            )
        raise NotImplementedError(
            f"未实现的曲线类型: {sd.curve_type}"
        )

    def run(self, optimizer: Optimizer) -> StageResult:
        """运行拟合"""
        x0, lo, hi = self._get_x0_and_bounds()
        # 检查 bounds
        if np.any(x0 < lo) or np.any(x0 > hi):
            # clip 到 bounds
            x0 = np.clip(x0, lo, hi)

        # 如果开了 history, 在 minimize 末尾记录初始状态 (x0)
        if self.history_interval > 0:
            self._set_params_from_x(x0)
            self._record_history(step=0)

        # 构造 callback 让 scipy 每步通知 (用于记录 history)
        callback = None
        if self.history_interval > 0:
            def _callback(xk, *_):
                # scipy.least_squares 的 callback 每 step 都调用, 不支持 nfev
                # 在 history_interval>1 时按 step 间隔记录
                if len(self.history) % self.history_interval == 0:
                    self._set_params_from_x(xk)
                    self._record_history(step=len(self.history))
                return False  # 继续

        result = None
        current_x0 = x0
        current_lo = lo
        current_hi = hi
        for expansion_round in range(self.max_bound_expansions + 1):
            result = optimizer.minimize(
                residual_func=self._residual,
                x0=current_x0,
                bounds=(current_lo, current_hi),
                callback=callback,
            )
            self._record_active_bounds(result.x, current_lo, current_hi)
            if not self.auto_expand_bounds or expansion_round >= self.max_bound_expansions:
                break
            expanded = self._expand_active_bounds(result.x, current_lo, current_hi)
            if not expanded:
                break
            current_x0 = np.clip(result.x, expanded[0], expanded[1])
            current_lo, current_hi = expanded

        if result is None:
            raise RuntimeError("Optimizer did not return a result")

        # 写回 model
        self._set_params_from_x(result.x)
        for pname, val in zip(self.param_names, result.x):
            self.model.set(pname, float(val))

        # 把拟合结果存到 simdata
        for sd in self.simdata:
            fit = self._eval(sd)
            if fit is not None:
                sd.set_fit(fit)

        # Compute R² on the same simdata points used by the residual function.
        # - log-domain R² (default): 对数域, 适合跨数量级数据 (1mA vs 200A)
        # - linear-domain R²: 线性域, 适合视觉直观比较
        r_squared = self._stage_r_squared(domain="log")
        r_squared_linear = self._stage_r_squared(domain="linear")

        return StageResult(
            stage_name=self.name,
            success=result.success,
            rms=result.rms,
            iterations=result.nit,
            nfev=result.nfev,
            fitted_params={p: float(v) for p, v in zip(self.param_names, result.x)},
            message=result.message,
            r_squared=r_squared,
            r_squared_linear=r_squared_linear,
        )

    def _active_bound_events(self, x: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> list[dict]:
        span = np.maximum(np.abs(hi - lo), 1e-30)
        tol = np.maximum(span * 1e-4, 1e-18)
        events = []
        for i, pname in enumerate(self.param_names):
            value = float(x[i])
            lower_hit = value <= lo[i] + tol[i]
            upper_hit = value >= hi[i] - tol[i]
            if not lower_hit and not upper_hit:
                continue
            events.append({
                "param": pname,
                "value": value,
                "old": [float(lo[i]), float(hi[i])],
                "new": [float(lo[i]), float(hi[i])],
                "side": "both" if lower_hit and upper_hit else ("lower" if lower_hit else "upper"),
            })
        return events

    def _record_active_bounds(self, x: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> None:
        for event in self._active_bound_events(x, lo, hi):
            key = (event["param"], event["side"], tuple(event["old"]))
            exists = any(
                (e.get("param"), e.get("side"), tuple(e.get("old", []))) == key
                for e in self.bound_events
            )
            if not exists:
                self.bound_events.append(event)

    def _expand_active_bounds(self, x: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> Optional[tuple[np.ndarray, np.ndarray]]:
        next_lo = lo.copy()
        next_hi = hi.copy()
        events = []

        for event in self._active_bound_events(x, lo, hi):
            pname = event["param"]
            i = self.param_names.index(pname)
            value = float(x[i])
            lower_hit = event["side"] in ("lower", "both")
            upper_hit = event["side"] in ("upper", "both")

            old_lo = float(lo[i])
            old_hi = float(hi[i])
            width = max(old_hi - old_lo, max(abs(value), 1.0) * 1e-6, 1e-30)

            if lower_hit:
                if old_lo >= 0:
                    new_lo = max(0.0, old_lo / self.bound_expand_factor)
                else:
                    new_lo = old_lo - width * (self.bound_expand_factor - 1.0)
                next_lo[i] = min(new_lo, old_lo)
            if upper_hit:
                if old_hi <= 0:
                    new_hi = old_hi / self.bound_expand_factor
                else:
                    new_hi = old_hi + width * (self.bound_expand_factor - 1.0)
                next_hi[i] = max(new_hi, old_hi)

            if next_lo[i] < old_lo or next_hi[i] > old_hi:
                self.model.set_bounds(pname, float(next_lo[i]), float(next_hi[i]))
                events.append({
                    "param": pname,
                    "value": value,
                    "old": [old_lo, old_hi],
                    "new": [float(next_lo[i]), float(next_hi[i])],
                    "side": "both" if lower_hit and upper_hit else ("lower" if lower_hit else "upper"),
                })

        if not events:
            return None
        self.bound_events.extend(events)
        return next_lo, next_hi

    def _stage_r_squared(self, domain: str = "log") -> float:
        """Per-stage R² (in [0, 1]; 1 is perfect; NaN if no data).

        R² = 1 - SSR / SST
        domain: "log" (默认) 或 "linear"
          - "log": SSR/SST 在 log10(meas) 上算, 适合跨数量级数据
          - "linear": SSR/SST 在原始量上算, 适合视觉直观比较
        """
        meas_arr: list = []
        fit_arr: list = []
        for sd in self.simdata:
            if sd.dvar is None or sd.fit is None:
                continue
            m = np.asarray(sd.dvar, dtype=float)
            f = np.asarray(sd.fit, dtype=float)
            mask = self._fit_mask(sd, f)
            if mask.any():
                if domain == "log":
                    meas_arr.append(np.log10(m[mask]))
                    fit_arr.append(np.log10(f[mask]))
                else:  # linear
                    meas_arr.append(m[mask])
                    fit_arr.append(f[mask])
        if not meas_arr:
            return float("nan")
        m_arr = np.concatenate(meas_arr)
        f_arr = np.concatenate(fit_arr)
        ss_res = float(np.sum((m_arr - f_arr) ** 2))
        ss_tot = float(np.sum((m_arr - m_arr.mean()) ** 2))
        if ss_tot <= 0:
            return 0.0
        return max(0.0, 1.0 - ss_res / ss_tot)
