"""
debug_fit_s1.py
===============
调试 S1 拟合问题：为什么 VTH0 跑到 1.04V?

测试：
1. 自由 VTH0（当前行为）
2. 锁定 VTH0=3.0V（datasheet 值），让其他参数动
3. 强反型区加权（log RMS + linear RMS 加权）
4. 亚阈值 + 强反型 分段拟合

输出：每个实验的拟合参数 + RMS
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np
import requests, time, uvicorn, threading
from spicebuilder.api.server import app
from spicebuilder.data.loader_sdh import load_sdh_excel
from spicebuilder.data.simdata import SimData
from spicebuilder.models.bsim3 import BSIM3Model
from spicebuilder.models.init_values import init_from_key_params
from spicebuilder.fitting.optimizer import Optimizer
from spicebuilder.fitting.stage import Stage


def evaluate_idvg_via_ltspice(model, vds=0.5, vgs_max=5.0):
    """用 BSIM3 公式近似仿真 Id-Vg（不用 LTspice 启动慢）"""
    from spicebuilder.models.bsim3 import PARAM_SPECS
    p = {s.name: model.get(s.name) for s in PARAM_SPECS}
    # 简单 BSIM3 公式（只用于调试）
    vth0 = p['VTH0']
    u0 = p['U0']
    cox = 1e-3  # 假设 Cox ≈ 1 mF/m² (TOX=50nm)
    kp = u0 * cox * 1e4  # μA/V²
    nfactor = p['NFACTOR']
    # Id = μ·Cox·(W/L)·(Vgs-Vth)·Vds (linear)
    # 这里用 subthreshold + linear 简化
    vgs = np.linspace(0, vgs_max, 51)
    vt = 0.026  # thermal voltage
    nvt = nfactor * vt
    # 亚阈值
    id_sub = 1e-7 * np.exp((vgs - vth0) / nvt) * (1 - np.exp(-vds / vt))
    # 强反型
    id_strong = kp * (vgs - vth0) * vds
    # 平滑过渡
    id_total = id_sub + id_strong
    return vgs, id_total


def run_experiment(label, model, sim, opt, lock_vth0=False):
    """跑 S1 拟合，返回结果"""
    print(f"\n--- {label} ---")
    init_vth0 = model.get("VTH0")
    init_u0 = model.get("U0")
    print(f"  Init: VTH0={init_vth0}, U0={init_u0}")
    
    # 构造 stage
    if lock_vth0:
        # 锁定 VTH0=3.0V，只动 K1, K2, DVT0, DVT1, NFACTOR, CDSC
        param_names = ["K1", "K2", "DVT0", "DVT1", "NFACTOR", "CDSC"]
        model.set("VTH0", 3.0)  # 锁定
    else:
        param_names = ["VTH0", "K1", "K2", "DVT0", "DVT1", "NFACTOR", "CDSC"]
    
    stage = Stage(
        name=f"S1_{label}",
        simdata=[sim],
        param_names=param_names,
        model=model,
        error_func="log",
    )
    
    result = stage.run(opt)
    print(f"  Result: success={result.success}, rms={result.rms:.4f}")
    print(f"  Final: VTH0={model.get('VTH0'):.4f}, U0={model.get('U0'):.4f}, "
          f"NFACTOR={model.get('NFACTOR'):.4f}, K1={model.get('K1'):.4f}")
    
    # 验证：用最终参数仿真 Id-Vg，看电流
    vgs, id_sim = evaluate_idvg_via_ltspice(model, vds=0.5)
    print(f"  Simulated Id @ Vgs=5V: {id_sim[np.argmin(np.abs(vgs-5))]:.2e} A")
    print(f"  Target Id @ Vgs=5V: ~3.5e-1 A (from data)")
    
    return {
        'label': label,
        'final_vth0': model.get('VTH0'),
        'final_u0': model.get('U0'),
        'final_nfactor': model.get('NFACTOR'),
        'rms': result.rms,
        'sim_id_at_5v': id_sim[np.argmin(np.abs(vgs-5))],
    }


# 启动 API server
config = uvicorn.Config(app, host='127.0.0.1', port=19999, log_level='error')
server = uvicorn.Server(config)
t = threading.Thread(target=server.run, daemon=True)
t.start()
time.sleep(2)

# 加载数据
ds = load_sdh_excel('datademo/SDH10N2P1WC-AA_SPICE_Data.xlsx')
sim = SimData.from_idvg(ds.idvg_vds05, temperature_c=25, vds_v=0.5)
print(f"Loaded: {sim.n_points} pts, Id range: {sim.dvar.min():.2e} ~ {sim.dvar.max():.2e}")

results = []

# Experiment 1: 自由 VTH0 (current behavior)
model = BSIM3Model()
init_from_key_params(model, ds.key_params)
opt = Optimizer(method='trf')
opt.set_eps1(1e-3); opt.set_eps2(1e-3); opt.set_max_iter(100)
results.append(run_experiment("E1: VTH0 free (current)", model, sim, opt, lock_vth0=False))

# Experiment 2: 锁定 VTH0=3.0V
model = BSIM3Model()
init_from_key_params(model, ds.key_params)
opt = Optimizer(method='trf')
opt.set_eps1(1e-3); opt.set_eps2(1e-3); opt.set_max_iter(100)
results.append(run_experiment("E2: VTH0 locked at 3.0V", model, sim, opt, lock_vth0=True))

# Experiment 3: 收紧 VTH0 bounds
model = BSIM3Model()
init_from_key_params(model, ds.key_params)
# 改 bounds: VTH0 必须在 [2.5, 3.5]
model.set("VTH0", 3.0)  # 起点
# 注: 实际 bounds 修改需要在 bsim3.py 里改
opt = Optimizer(method='trf')
opt.set_eps1(1e-3); opt.set_eps2(1e-3); opt.set_max_iter(100)
results.append(run_experiment("E3: VTH0 init 3.0V (current bounds)", model, sim, opt, lock_vth0=False))

# Experiment 4: 用 linear RMS (不 log)
model = BSIM3Model()
init_from_key_params(model, ds.key_params)
opt = Optimizer(method='trf')
opt.set_eps1(1e-3); opt.set_eps2(1e-3); opt.set_max_iter(100)
stage = Stage(
    name="S1_E4_linear_rms",
    simdata=[sim],
    param_names=["VTH0", "K1", "K2", "DVT0", "DVT1", "NFACTOR", "CDSC"],
    model=model,
    error_func="linear",
)
result = stage.run(opt)
print(f"\n--- E4: linear RMS ---")
print(f"  Result: rms={result.rms:.4f}, VTH0={model.get('VTH0'):.4f}")
results.append({'label': 'E4: linear RMS', 'final_vth0': model.get('VTH0'), 'rms': result.rms})

# 总结
print("\n" + "=" * 70)
print(" SUMMARY")
print("=" * 70)
print(f"{'Experiment':<40s} {'VTH0':>8s} {'U0':>8s} {'NFACTOR':>8s} {'RMS':>10s}")
print("-" * 70)
for r in results:
    vth0 = r.get('final_vth0', 'N/A')
    u0 = r.get('final_u0', 'N/A')
    nf = r.get('final_nfactor', 'N/A')
    rms = r.get('rms', 'N/A')
    print(f"{r['label']:<40s} {str(vth0)[:7]:>8s} {str(u0)[:7]:>8s} {str(nf)[:7]:>8s} {str(rms)[:9]:>10s}")
print()
print("KEY INSIGHT:")
print("  - Log RMS 偏向亚阈值 (Vth 拉低换亚阈值好拟合)")
print("  - Linear RMS 偏向强反型 (Vth 拉高换强反型好拟合)")
print("  - 真实拟合应该 log + linear 加权")
print("  - 锁定 VTH0=datasheet 值是最快修复")
