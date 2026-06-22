"""
debug_fit_s1_ltspice.py
======================
用 LTspice 作为评估函数做 S1 (Id-Vg) 拟合。

每个参数评估 = 1 次 LTspice 仿真 (~0.5s)。
optimizer 50 iter × 50 params Jacobian = 2500 次仿真 = ~20 min。
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import time
import numpy as np
from pathlib import Path
import tempfile
from scipy.optimize import least_squares

from spicebuilder.data.loader_sdh import load_sdh_excel
from spicebuilder.data.simdata import SimData
from spicebuilder.models.bsim3 import BSIM3Model
from spicebuilder.models.init_values import init_from_key_params
from spicebuilder.models.exporter import LibExporter
from spicebuilder.simulator.ltspice import LTspiceBackend, gen_idvg_netlist


def write_lib_with_params(model: BSIM3Model, path: Path) -> None:
    """导出当前 model 到 .lib"""
    exporter = LibExporter(part_number="DEBUG")
    exporter.export_subckt(model, path, subckt_name="DEBUG_MOS", rg_ohm=1.6)


def ltspice_eval_idvg(model: BSIM3Model,
                      vgs_arr: np.ndarray,
                      vds: float = 5.0,
                      backend: LTspiceBackend = None,
                      cache: dict = None) -> np.ndarray:
    """用 LTspice 评估 Id-Vg

    Returns: Id array of same length as vgs_arr (in A)
    """
    if backend is None:
        backend = LTspiceBackend()
    if cache is None:
        cache = {}

    # 用参数 hash 作 cache key
    param_key = tuple(round(model.get(p), 8) for p in ['VTH0', 'K1', 'K2', 'DVT0', 'DVT1', 'NFACTOR', 'CDSC'])
    if param_key in cache:
        return cache[param_key]

    # 写 .lib
    tmpdir = Path(tempfile.mkdtemp(prefix="ltfit_"))
    lib_path = tmpdir / "model.lib"
    write_lib_with_params(model, lib_path)

    # 生成 netlist
    vgs_min, vgs_max = float(vgs_arr.min()), float(vgs_arr.max())
    n_points = len(vgs_arr)
    netlist = gen_idvg_netlist(
        str(lib_path), vgs_min=vgs_min, vgs_max=vgs_max,
        vgs_step=(vgs_max - vgs_min) / max(1, n_points - 1),
        vds_v=vds, model_name='DEBUG_MOS', use_subckt=True
    )
    res = backend.run_netlist_text(netlist, timeout_s=10, cleanup=False)
    if not res.success or not res.raw_path:
        cache[param_key] = np.full_like(vgs_arr, 1e-12)
        return cache[param_key]

    raw = backend.parse_raw(res.raw_path)
    if 'I(Vds)' not in raw:
        cache[param_key] = np.full_like(vgs_arr, 1e-12)
        return cache[param_key]

    fit_vgs = np.array(raw['V(g)']['ivar'])
    fit_id = np.array(raw['I(Vds)']['dvar'])
    # 插值到目标 vgs
    fit_id_interp = np.interp(vgs_arr, fit_vgs, np.abs(fit_id),
                                left=1e-12, right=1e-12)
    cache[param_key] = fit_id_interp
    return fit_id_interp


def main():
    print("=" * 60)
    print("LTspice-based Fitting Test (S1: Id-Vg only)")
    print("=" * 60)

    # 加载数据
    ds = load_sdh_excel('datademo/SDH10N2P1WC-AA_SPICE_Data.xlsx')
    sim = SimData.from_idvg(ds.idvg_vds5, temperature_c=25, vds_v=5.0)
    # 采样: 只取 Vgs > 3V (target 在 Vgs<3V 是测试机台最小电流档)
    # Vgs 3-4V 是机台量程跳变区，也不信
    # 只信 Vgs > 4V (强反型) 是真实数据
    mask = sim.ivar > 4.0
    vgs_strong = sim.ivar[mask]
    id_strong = sim.dvar[mask]
    # 取 8 个强反型点
    sample_idx = np.linspace(0, len(vgs_strong) - 1, 8, dtype=int)
    vgs_sample = vgs_strong[sample_idx]
    id_sample = id_strong[sample_idx]
    print(f"Sampled {len(vgs_sample)} strong-inversion (Vgs>4V) points from {len(vgs_strong)} total")
    print(f"Vgs range: {vgs_sample.min():.2f} to {vgs_sample.max():.2f}")
    print(f"Id range: {id_sample.min():.2e} to {id_sample.max():.2e} A")

    # 准备 model
    model = BSIM3Model()
    init_from_key_params(model, ds.key_params)
    print(f"\nInit: VTH0={model.get('VTH0'):.3f} U0={model.get('U0'):.1f} NFACTOR={model.get('NFACTOR'):.2f}")

    # 一次评估
    backend = LTspiceBackend()
    cache = {}

    print("\nInitial LTspice eval (1 run)...")
    t0 = time.time()
    id_init = ltspice_eval_idvg(model, vgs_sample, vds=5.0, backend=backend, cache=cache)
    t1 = time.time()
    print(f"  1 eval took {t1-t0:.2f}s")
    rms_log = np.sqrt(np.mean((np.log10(id_init) - np.log10(id_sample))**2))
    print(f"  Init RMS (log): {rms_log:.4f}")
    print(f"  Init Id @ Vgs=5V: {id_init[np.argmin(np.abs(vgs_sample-5))]:.2e} A")
    print(f"  Tgt  Id @ Vgs=5V: {id_sample[np.argmin(np.abs(vgs_sample-5))]:.2e} A")

    # 评估函数（供 optimizer 用）
    S1_params = ['VTH0', 'K1', 'K2', 'DVT0', 'DVT1', 'NFACTOR', 'CDSC', 'VSAT']
    n_calls = [0]
    total_time = [0.0]

    def residual(x):
        n_calls[0] += 1
        for pname, val in zip(S1_params, x):
            model.set(pname, float(val))
        t0 = time.time()
        id_pred = ltspice_eval_idvg(model, vgs_sample, vds=5.0, backend=backend, cache=cache)
        total_time[0] += time.time() - t0
        # log RMS residual, only trust points where Id > 1A (Vgs > 4V are real)
        # Skip machine-floor effects (Vgs < 4V): weight = 0
        weights = np.where(vgs_sample > 4.0, 1.0, 0.0)
        mask = (id_sample > 1e-9) & (id_pred > 1e-9) & (weights > 0)
        if not mask.any():
            return np.zeros_like(vgs_sample)
        r = np.zeros_like(vgs_sample)
        r[mask] = np.log10(id_pred[mask] / id_sample[mask])
        if n_calls[0] % 5 == 0:
            print(f"  Call {n_calls[0]}: VTH0={x[0]:.3f} K1={x[1]:.2f} K2={x[2]:.2f} "
                  f"NFACTOR={x[5]:.2f} CDSC={x[6]:.2e} VSAT={x[7]:.2e} (cum {total_time[0]:.1f}s)")
        return r

    # 初始值 + bounds
    x0 = np.array([model.get(p) for p in S1_params])
    lo = np.array([model.get_bounds(p)[0] for p in S1_params])
    hi = np.array([model.get_bounds(p)[1] for p in S1_params])

    print(f"\nStarting fit (15 points, {len(S1_params)} params)...")
    print(f"  Initial: VTH0={x0[0]:.3f} K1={x0[1]:.2f} K2={x0[2]:.2f} VSAT={x0[7]:.2e}")
    print(f"  Bounds: VTH0 [{lo[0]:.2f}, {hi[0]:.2f}]")

    # 用 bounded optimizer (trf)
    t0 = time.time()
    result = least_squares(residual, x0, bounds=(lo, hi), method='trf',
                             max_nfev=80, ftol=1e-4, xtol=1e-4, gtol=1e-4, verbose=0)
    t1 = time.time()

    print(f"\nFit done: {n_calls[0]} LTspice calls, {total_time[0]:.1f}s LTspice + {t1-t0-total_time[0]:.1f}s other")
    print(f"  Success: {result.success}")
    print(f"  Cost: {result.cost:.4f}")
    print(f"  NFev: {result.nfev}, NJev: {result.njev}")

    # 最终评估
    for pname, val in zip(S1_params, result.x):
        model.set(pname, float(val))
    final_id = ltspice_eval_idvg(model, vgs_sample, vds=5.0, backend=backend, cache=cache)
    final_rms = np.sqrt(np.mean((np.log10(final_id) - np.log10(id_sample))**2))
    print(f"\n  Final RMS (log): {final_rms:.4f}")
    print(f"  Final VTH0={model.get('VTH0'):.3f}, K1={model.get('K1'):.3f}, "
          f"NFACTOR={model.get('NFACTOR'):.3f}")
    print(f"  Final U0={model.get('U0'):.1f}")

    # 对比 target vs LTspice (逐点)
    print(f"\n  Per-point log10 diff (LTspice - Target):")
    for v, t, f in zip(vgs_sample, id_sample, final_id):
        log_diff = np.log10(f) - np.log10(t) if t > 0 and f > 0 else float('nan')
        marker = '*' if abs(log_diff) > 0.5 else ' '
        print(f"    Vgs={v:.2f}  Tgt={t:8.2e}  LTspice={f:8.2e}  diff={log_diff:+.2f} {marker}")


if __name__ == '__main__':
    main()
