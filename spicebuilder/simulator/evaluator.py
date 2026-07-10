"""
LTspiceEvaluator: 用 LTspice 跑 BSIM3 仿真作为目标函数
比 stage.py 的简化公式更准确（真 BSIM3 物理）。
"""
from __future__ import annotations
import hashlib
import tempfile
from pathlib import Path
from typing import Optional, Tuple, List

import numpy as np

from spicebuilder.models.bsim3 import BSIM3Model
from spicebuilder.models.cap_wrapper import PowerCapWrapper
from spicebuilder.models.exporter import LibExporter
from spicebuilder.models.powermos import PowerMOSSubcktParams
from spicebuilder.simulator.ltspice import (
    LTspiceBackend,
    gen_idvg_netlist,
    gen_idvd_netlist,
    gen_bv_netlist,
    gen_cv_netlist,
)


class LTspiceEvaluator:
    """用 LTspice 评估 BSIM3 model

    用法:
        ev = LTspiceEvaluator(subckt_name='SDH10N2P1', rg_ohm=1.6)
        id_arr = ev.eval_idvg(model, vgs_arr, vds=5.0)
        id_arr = ev.eval_idvd(model, vds_arr, vgs=10.0)
    """

    def __init__(self,
                 subckt_name: str = "MOS",
                 rg_ohm: float = 1.6,
                 backend: Optional[LTspiceBackend] = None,
                 work_dir: Optional[Path] = None,
                 verbose: bool = False,
                 cell_count: int = 100,
                 cell_w_m: float = 0.2,
                 power_params: PowerMOSSubcktParams | dict | None = None,
                 cap_wrapper: PowerCapWrapper | dict | None = None):
        self.subckt_name = subckt_name
        legacy_base = PowerMOSSubcktParams(
            rg_ohm=rg_ohm,
            cell_count=cell_count,
            cell_w_m=cell_w_m,
        )
        if isinstance(power_params, dict):
            pwr = PowerMOSSubcktParams.from_dict(power_params, base=legacy_base)
        elif power_params is None:
            pwr = PowerMOSSubcktParams()
        else:
            pwr = power_params
        if power_params is None:
            pwr = pwr.with_overrides(rg_ohm=rg_ohm, cell_count=cell_count, cell_w_m=cell_w_m)
        else:
            pwr = pwr.with_overrides(
                rg_ohm=None if rg_ohm == 1.6 else rg_ohm,
                cell_count=None if cell_count == 100 else cell_count,
                cell_w_m=None if cell_w_m == 0.2 else cell_w_m,
            )
        self.power_params = pwr
        self.rg_ohm = pwr.rg_ohm
        self.backend = backend or LTspiceBackend()
        self.work_dir = Path(work_dir) if work_dir else Path(tempfile.gettempdir())
        self.exporter = LibExporter(part_number="EVAL")
        self.verbose = verbose
        self.cell_count = pwr.cell_count
        self.cell_w_m = pwr.cell_w_m
        if isinstance(cap_wrapper, dict):
            self.cap_wrapper = PowerCapWrapper.from_dict(cap_wrapper)
        else:
            self.cap_wrapper = cap_wrapper
        self.cache: dict = {}  # param_hash -> array
        self.stats = {"calls": 0, "cache_hits": 0, "time": 0.0}

    def _param_hash(self, model: BSIM3Model, scenario: str, ivar: np.ndarray = None) -> str:
        """用关键参数生成 hash (用作 cache key)

        Args:
            ivar: 输入数组（加进 hash 以防不同长度复用缓存）
        """
        keys = [
            "VTH0", "K1", "K2", "K3", "K3B",
            "DVT0", "DVT1", "DVT2", "NFACTOR", "CDSC", "CDSCD", "CDSCB",
            "U0", "UA", "UB", "UC",
            "VSAT", "A0", "AGS", "KETA", "DWG", "DWB",
            "PCLM", "PVAG", "DROUT",
            "TOX", "XJ", "RS", "RD",
            "IS", "N", "BV", "IBV", "IGS0", "VGSLP", "BVGSP", "BVGSN",
        ]
        vals = []
        for k in keys:
            try:
                vals.append(f"{k}={model.get(k):.12g}")  # 提高精度 6g → 12g，避免缓存键冲突
            except (KeyError, ValueError):
                pass
        cap_key = self.cap_wrapper.cache_key() if self.cap_wrapper else "capwrap=off"
        s = scenario + "|" + self.power_params.cache_key() + "|" + cap_key + "|" + "|".join(vals)
        if ivar is not None:
            # 加 ivar shape + min/max 到 key 以防不同长度复用
            s += f"|n={len(ivar)}|min={ivar.min():.4g}|max={ivar.max():.4g}"
        return hashlib.md5(s.encode()).hexdigest()[:16]

    def _write_lib(self, model: BSIM3Model) -> Path:
        """写一个临时 .lib"""
        tmpdir = Path(tempfile.mkdtemp(prefix="lteval_", dir=str(self.work_dir)))
        lib_path = tmpdir / "model.lib"
        self.exporter.export_subckt(model, lib_path,
                                     subckt_name=self.subckt_name,
                                     power_params=self.power_params,
                                     cap_wrapper=self.cap_wrapper)
        return lib_path

    def eval_idvg(self,
                  model: BSIM3Model,
                  vgs_arr: np.ndarray,
                  vds: float = 5.0) -> np.ndarray:
        """评估 Id-Vg 曲线

        Args:
            model: BSIM3 model
            vgs_arr: 目标 Vgs 数组 (V)
            vds: Vds 偏置 (V)

        Returns:
            |Id| 数组 (A)，与 vgs_arr 同长度
        """
        import time
        key = self._param_hash(model, f"idvg_vds{vds}", vgs_arr)
        if key in self.cache:
            self.stats["cache_hits"] += 1
            return self.cache[key]

        t0 = time.time()
        self.stats["calls"] += 1
        lib_path = self._write_lib(model)
        vgs_min, vgs_max = float(vgs_arr.min()), float(vgs_arr.max())
        n = len(vgs_arr)
        step = (vgs_max - vgs_min) / max(1, n - 1)
        netlist = gen_idvg_netlist(str(lib_path), vgs_min=vgs_min, vgs_max=vgs_max,
                                    vgs_step=step, vds_v=vds,
                                    model_name=self.subckt_name, use_subckt=True,
                                    m_factor=1)
        res = self.backend.run_netlist_text(netlist, timeout_s=15, cleanup=False)
        self.stats["time"] += time.time() - t0

        if not res.success or not res.raw_path or not res.raw_path.exists():
            out = np.full_like(vgs_arr, 1e-12, dtype=float)
            self.cache[key] = out
            return out

        try:
            raw = self.backend.parse_raw(res.raw_path)
            if 'V(g)' not in raw or 'I(Vds)' not in raw:
                out = np.full_like(vgs_arr, 1e-12, dtype=float)
            else:
                fit_vgs = np.array(raw['V(g)']['ivar'])
                fit_id = np.abs(np.array(raw['I(Vds)']['dvar']))
                out = np.interp(vgs_arr, fit_vgs, fit_id, left=1e-12, right=1e-12)
        except Exception as e:
            if self.verbose:
                print(f"[eval_idvg] parse error: {e}")
            out = np.full_like(vgs_arr, 1e-12, dtype=float)
        finally:
            try:
                lib_path.parent.rmdir()
            except OSError:
                pass

        self.cache[key] = out
        return out

    def eval_idvd(self,
                  model: BSIM3Model,
                  vds_arr: np.ndarray,
                  vgs: float = 10.0,
                  vds_max: float = 12.0) -> np.ndarray:
        """评估 Id-Vd 曲线"""
        import time
        key = self._param_hash(model, f"idvd_vgs{vgs}", vds_arr)
        if key in self.cache:
            self.stats["cache_hits"] += 1
            return self.cache[key]

        t0 = time.time()
        self.stats["calls"] += 1
        lib_path = self._write_lib(model)
        n = len(vds_arr)
        step = vds_max / max(1, n - 1)
        netlist = gen_idvd_netlist(str(lib_path), vds_max=vds_max, vds_step=step,
                                    vgs_v=vgs, model_name=self.subckt_name, use_subckt=True,
                                    m_factor=1)
        res = self.backend.run_netlist_text(netlist, timeout_s=15, cleanup=False)
        self.stats["time"] += time.time() - t0

        if not res.success or not res.raw_path or not res.raw_path.exists():
            out = np.full_like(vds_arr, 1e-12, dtype=float)
            self.cache[key] = out
            return out

        try:
            raw = self.backend.parse_raw(res.raw_path)
            if 'V(d)' not in raw or 'I(Vds)' not in raw:
                out = np.full_like(vds_arr, 1e-12, dtype=float)
            else:
                fit_vds = np.array(raw['V(d)']['ivar'])
                fit_id = np.abs(np.array(raw['I(Vds)']['dvar']))
                out = np.interp(vds_arr, fit_vds, fit_id, left=1e-12, right=1e-12)
        except Exception as e:
            if self.verbose:
                print(f"[eval_idvd] parse error: {e}")
            out = np.full_like(vds_arr, 1e-12, dtype=float)
        finally:
            try:
                lib_path.parent.rmdir()
            except OSError:
                pass

        self.cache[key] = out
        return out

    def eval_bv(self,
                model: BSIM3Model,
                sweep_arr: np.ndarray,
                kind: str = "bvdss") -> np.ndarray:
        """Evaluate BVDSS/BVGSS leakage curves."""
        import time
        norm_kind = kind.lower()
        key = self._param_hash(model, f"bv_{norm_kind}", sweep_arr)
        if key in self.cache:
            self.stats["cache_hits"] += 1
            return self.cache[key]

        t0 = time.time()
        self.stats["calls"] += 1
        lib_path = self._write_lib(model)
        vmin, vmax = float(sweep_arr.min()), float(sweep_arr.max())
        n = len(sweep_arr)
        step = abs(vmax - vmin) / max(1, n - 1)
        if step <= 0:
            step = max(abs(vmax), 1.0) * 0.01
        netlist = gen_bv_netlist(
            str(lib_path),
            kind=norm_kind,
            vmin=vmin,
            vmax=vmax,
            vstep=step,
            model_name=self.subckt_name,
            use_subckt=True,
        )
        res = self.backend.run_netlist_text(netlist, timeout_s=15, cleanup=False)
        self.stats["time"] += time.time() - t0

        if not res.success or not res.raw_path or not res.raw_path.exists():
            out = np.full_like(sweep_arr, 1e-18, dtype=float)
            self.cache[key] = out
            return out

        try:
            raw = self.backend.parse_raw(res.raw_path)
            trace_x = "V(d)" if norm_kind == "bvdss" else "V(g)"
            trace_i = "I(Vds)" if norm_kind == "bvdss" else "I(Vgs)"
            if trace_x not in raw or trace_i not in raw:
                out = np.full_like(sweep_arr, 1e-18, dtype=float)
            else:
                fit_x = np.array(raw[trace_x]["ivar"])
                fit_i = np.abs(np.array(raw[trace_i]["dvar"]))
                order = np.argsort(fit_x)
                out = np.interp(sweep_arr, fit_x[order], fit_i[order], left=1e-18, right=1e-18)
        except Exception as e:
            if self.verbose:
                print(f"[eval_bv] parse error: {e}")
            out = np.full_like(sweep_arr, 1e-18, dtype=float)
        finally:
            try:
                lib_path.parent.rmdir()
            except OSError:
                pass

        self.cache[key] = out
        return out

    def eval_cv(self,
                model: BSIM3Model,
                vds_arr: np.ndarray,
                freq: float = 1e6,
                vds_max: float = 25.0,
                cap_type: str = "ciss") -> Optional[np.ndarray]:
        """评估 C-V 曲线 (返回 C in pF; None on LTspice failure).

        cap_type selects both the netlist pattern and which current trace
        we read back.  The CV netlists use a 1 V AC source, so C=|I|/omega.
        """
        import time
        import sys
        key = self._param_hash(model, f"cv_f{freq}_{cap_type}", vds_arr)
        if key in self.cache:
            self.stats["cache_hits"] += 1
            if self.cache[key] is None:
                del self.cache[key]   # invalidate stale None cache entry
            else:
                return self.cache[key]

        t0 = time.time()
        self.stats["calls"] += 1
        lib_path = self._write_lib(model)
        netlist = gen_cv_netlist(str(lib_path), vds_max=vds_max, vds_step=vds_max / 50,
                                  freq=freq, model_name=self.subckt_name, use_subckt=True,
                                  vds_values=vds_arr,
                                  cap_type=cap_type)
        res = self.backend.run_netlist_text(netlist, timeout_s=45, cleanup=False)
        self.stats["time"] += time.time() - t0

        if not res.success or not res.raw_path or not res.raw_path.exists():
            self.cache[key] = None
            return None

        try:
            raw = self.backend.parse_raw(res.raw_path, complex_mode="imag_abs")
            # LTspice returns trace names with source names preserved by
            # the parser; try canonical and lowercase variants.
            candidates = {
                "ciss": ("I(Vg_ac)", "I(vg_ac)"),
                "coss": ("I(Vd_ac)", "I(vd_ac)"),
                "crss": ("I(Vg_short)", "I(vg_short)"),
            }.get(cap_type, ("I(Vg_ac)", "I(vg_ac)"))
            i_trace = next((name for name in candidates if name in raw), None)
            if i_trace is None:
                self.cache[key] = None
                return None
            i_ac = np.abs(np.asarray(raw[i_trace]['dvar'], dtype=float))
            if i_ac.size == 0:
                self.cache[key] = None
                return None
            # The excitation amplitude is 1 V, so C = |I| / omega.
            # Convert F -> pF so it matches SimData.from_cv CSV values.
            omega = 2 * np.pi * freq
            c = i_ac / omega * 1e12
            if len(c) == len(vds_arr):
                out = c[: len(vds_arr)]
                self.cache[key] = out
                return out
            # Pad / interpolate to vds_arr length when fewer points
            # were returned than requested.
            x_axis = np.linspace(vds_arr[0], vds_arr[-1], len(c)) \
                if vds_arr.size else np.linspace(0, vds_max, len(c))
            out = np.interp(vds_arr, x_axis, c)
            self.cache[key] = out
            return out
        except Exception as e:
            if self.verbose:
                print(f"[eval_cv] parse error: {e}")
            out = np.full_like(vds_arr, 1e-12, dtype=float)
        finally:
            try:
                lib_path.parent.rmdir()
            except OSError:
                pass

        self.cache[key] = out
        return out

    def print_stats(self):
        print(f"  LTspice eval: {self.stats['calls']} calls, "
              f"{self.stats['cache_hits']} cache hits, "
              f"{self.stats['time']:.1f}s sim time")
