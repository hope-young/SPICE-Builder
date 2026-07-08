#!/usr/bin/env python3
"""快速测试 Id-Vg 拟合质量 - 使用新的动态 Vth 下限"""
import numpy as np
import matplotlib.pyplot as plt
from spicebuilder.data.loader_sdh import load_sdh_excel
from spicebuilder.models.bsim3 import BSIM3Model
from spicebuilder.models.init_values import init_from_key_params
from spicebuilder.data.simdata import SimData
from spicebuilder.fitting.stage import Stage
from spicebuilder.fitting.optimizer import Optimizer
from spicebuilder.simulator.evaluator import LTspiceEvaluator

print('=' * 60)
print('快速测试: Id-Vg 拟合质量 (动态 Vth 下限)')
print('=' * 60)

# 加载数据
dataset = load_sdh_excel('datademo/SDH10N2P1WC-AA_SPICE_Data.xlsx')
model = BSIM3Model()
init_from_key_params(model, dataset.key_params)

print(f'\n器件信息:')
print(f'  型号: {dataset.device_info.part_number}')
print(f'  Vth @ 25°C: {dataset.key_params.vth_25c_v:.2f} V')
print(f'  Rdson @ 25°C: {dataset.key_params.rdson_25c_10v_ohm*1000:.2f} mΩ')

simulator = LTspiceEvaluator(subckt_name='SDH10N2P1', rg_ohm=1.6, verbose=False)

# === 测试 S1: Id-Vg @ Vds=0.5V ===
print('\n[测试 S1] Id-Vg @ Vds=0.5V')
s1_sim = SimData.from_idvg(dataset.idvg_vds05, temperature_c=25, vds_v=0.5)
print(f'  原始数据点: {s1_sim.n_points}')
print(f'  Vgs 范围: {s1_sim.ivar.min():.2f} - {s1_sim.ivar.max():.2f} V')

# 在过滤之前，先检查初始模型的 LTspice 仿真 vs 实测（baseline）
print('\n  [Baseline] 初始模型 LTspice vs 实测 (Vds=0.5V, 超阈值区):')
baseline_sim = simulator.eval_idvg(model, s1_sim.ivar, vds=0.5)
for i in range(len(s1_sim.ivar)):
    v = s1_sim.ivar[i]
    m = s1_sim.dvar[i]
    s = baseline_sim[i]
    if v >= 3.0:  # 只看超阈值区
        ratio = s / m if m > 0 else float('inf')
        print(f'    Vgs={v:.2f}V: meas={m:.3e}A, sim={s:.3e}A, sim/meas={ratio:.2f}')

# 使用新策略：动态 Vth 下限
vth_25c = dataset.key_params.vth_25c_v
s1_vgs_floor = max(vth_25c, 2.0)
print(f'  新策略: Vgs >= {s1_vgs_floor:.2f} V (Vth={vth_25c:.2f} V)')

s1_sim_filtered = s1_sim.filter("ge", s1_vgs_floor, dtype="ivar")
print(f'  过滤后数据点: {s1_sim_filtered.n_points}')
print(f'  Vgs 范围: {s1_sim_filtered.ivar.min():.2f} - {s1_sim_filtered.ivar.max():.2f} V')
print(f'  Id 范围: {s1_sim_filtered.dvar.min():.3e} - {s1_sim_filtered.dvar.max():.3e} A')

s1_sim_filtered.metadata["vgs_floor_v"] = s1_vgs_floor
s1 = Stage(
    name="S1_Threshold",
    simdata=[s1_sim_filtered],
    param_names=['VTH0', 'K1', 'K2', 'DVT0', 'DVT1', 'NFACTOR', 'CDSC'],
    model=model,
    error_func="log",
    simulator=simulator,
)

print('\n  运行拟合...')
opt = Optimizer(method='trf')

# 先测试 LTspice 评估器是否正常工作
print('\n  [调试] 测试 LTspiceEvaluator...')
test_vgs = np.array([2.0, 3.0, 4.0, 5.0, 6.0])
try:
    test_result = simulator.eval_idvg(model, test_vgs, vds=0.5)
    print(f'    LTspice eval_idvg 测试成功: {test_result}')
    print(f'    模型当前 VTH0={model.get("VTH0"):.4f}')
    print(f'    模型 U0={model.get("U0"):.4f}')
    print(f'    模型 K1={model.get("K1"):.4f}')
    print(f'    模型 K2={model.get("K2"):.4f}')
    print(f'    模型 DVT0={model.get("DVT0"):.4f}')
    print(f'    模型 DVT1={model.get("DVT1"):.4f}')
except Exception as e:
    print(f'    LTspice eval_idvg 失败: {e}')

result = s1.run(opt)

# 调试：检查拟合后的模型参数写回是否正确
print('\n  [调试] 拟合后模型参数:')
for pname in ['VTH0', 'K1', 'K2', 'DVT0', 'DVT1', 'NFACTOR', 'U0']:
    print(f'    {pname}: {model.get(pname):.4f}')

# 手动用最终模型参数跑一次 LTspice，对比仿真 vs 实测
print('\n  [调试] 最终模型 LTspice 验证:')
final_vgs = s1_sim_filtered.ivar
final_sim = simulator.eval_idvg(model, final_vgs, vds=0.5)
for i in range(min(5, len(final_vgs))):
    meas = s1_sim_filtered.dvar[i]
    sim = final_sim[i]
    print(f'    Vgs={final_vgs[i]:.2f}V: meas={meas:.3e}A, sim={sim:.3e}A, err={abs(sim-meas)/meas*100:.1f}%')

print(f'\n  拟合结果:')
print(f'    RMS: {result.rms:.4f}')
print(f'    R2: {result.r_squared:.4f}')
print(f'    Success: {result.success}')
print(f'    Iterations: {result.iterations}')
print(f'    nfev: {result.nfev}')

# 计算相对误差
if s1_sim_filtered.fit is not None:
    errors = np.abs((s1_sim_filtered.fit - s1_sim_filtered.dvar) / s1_sim_filtered.dvar) * 100
    print(f'    Mean error: {errors.mean():.2f}%')
    print(f'    Median error: {np.median(errors):.2f}%')
    print(f'    Max error: {errors.max():.2f}%')

    # 显示关键参数
    print(f'\n  拟合参数:')
    for pname in ['VTH0', 'K1', 'NFACTOR', 'U0']:
        val = result.fitted_params.get(pname, model.get(pname))
        bounds = model.get_bounds(pname)
        print(f'    {pname}: {val:.4f}  (bounds: [{bounds[0]:.2f}, {bounds[1]:.2f}])')

# === 测试 S3: Id-Vg @ Vds=5V ===
print('\n[测试 S3] Id-Vg @ Vds=5V')
s3_sim = SimData.from_idvg(dataset.idvg_vds5, temperature_c=25, vds_v=5.0)
print(f'  原始数据点: {s3_sim.n_points}')

s3_vgs_floor = max(vth_25c, 2.0)
print(f'  新策略: Vgs >= {s3_vgs_floor:.2f} V (Vth={vth_25c:.2f} V)')

s3_sim_filtered = s3_sim.filter("ge", s3_vgs_floor, dtype="ivar")
print(f'  过滤后数据点: {s3_sim_filtered.n_points}')
print(f'  Vgs 范围: {s3_sim_filtered.ivar.min():.2f} - {s3_sim_filtered.ivar.max():.2f} V')
print(f'  Id 范围: {s3_sim_filtered.dvar.min():.3e} - {s3_sim_filtered.dvar.max():.3e} A')

s3_sim_filtered.metadata["vgs_floor_v"] = s3_vgs_floor
s3 = Stage(
    name="S3_LinearMobility",
    simdata=[s3_sim_filtered],
    param_names=['U0', 'UA', 'UB', 'UC'],
    model=model,
    error_func="log",
    simulator=simulator,
)

print('\n  运行拟合...')
result3 = s3.run(opt)

print(f'\n  拟合结果:')
print(f'    RMS: {result3.rms:.4f}')
print(f'    R2: {result3.r_squared:.4f}')
print(f'    Success: {result3.success}')
print(f'    Iterations: {result3.iterations}')
print(f'    nfev: {result3.nfev}')

if s3_sim_filtered.fit is not None:
    errors = np.abs((s3_sim_filtered.fit - s3_sim_filtered.dvar) / s3_sim_filtered.dvar) * 100
    print(f'    Mean error: {errors.mean():.2f}%')
    print(f'    Median error: {np.median(errors):.2f}%')
    print(f'    Max error: {errors.max():.2f}%')

    print(f'\n  拟合参数:')
    for pname in ['U0', 'UA', 'UB']:
        val = result3.fitted_params.get(pname, model.get(pname))
        bounds = model.get_bounds(pname)
        print(f'    {pname}: {val:.4f}  (bounds: [{bounds[0]:.2f}, {bounds[1]:.2f}])')

# === 可视化对比 ===
print('\n生成对比图...')

# 用最终模型重新跑 LTspice 得到完整拟合曲线
# 先获取初始模型用于对比
init_model = BSIM3Model()
init_from_key_params(init_model, dataset.key_params)

final_vgs_all = s1_sim.ivar  # 所有原始数据点
final_sim_all = simulator.eval_idvg(model, final_vgs_all, vds=0.5)

fig, axes = plt.subplots(1, 2, figsize=(16, 7))

# S1: Id-Vg @ Vds=0.5V - 完整曲线对比（线性坐标）
ax1 = axes[0]
ax1.plot(s1_sim.ivar, s1_sim.dvar, 'o', color='blue', label='Measured (all)', markersize=4, alpha=0.5)
ax1.plot(s1_sim_filtered.ivar, s1_sim_filtered.dvar, 'o', color='green', label='Measured (fitted region)', markersize=6)
mask_valid = final_sim_all > 1e-15
ax1.plot(final_vgs_all[mask_valid], final_sim_all[mask_valid], '-', color='red', linewidth=2, label='LTspice sim (final model)')
init_sim_all = simulator.eval_idvg(init_model, final_vgs_all, vds=0.5)
mask_init = init_sim_all > 1e-15
ax1.plot(final_vgs_all[mask_init], init_sim_all[mask_init], '--', color='gray', linewidth=1.5, label='LTspice sim (init model)')
ax1.axvline(s1_vgs_floor, color='orange', linestyle='--', linewidth=1.5, alpha=0.8, label=f'Vgs floor={s1_vgs_floor:.2f}V (Vth={vth_25c:.2f}V)')
ax1.axvline(vth_25c, color='gray', linestyle=':', linewidth=1, alpha=0.8)
ax1.set_xlabel('Vgs (V)', fontsize=12)
ax1.set_ylabel('Id (A)', fontsize=12)
ax1.set_title(f'S1: Id-Vg @ Vds=0.5V\nRMS={result.rms:.4f}, R2={result.r_squared:.4f}\nFit: VTH0={model.get("VTH0"):.2f}, K1={model.get("K1"):.3f}', fontsize=11)
ax1.legend(fontsize=9)
ax1.grid(True, alpha=0.3)

# S3: Id-Vg @ Vds=5V - 完整曲线对比（线性坐标）
ax2 = axes[1]
s3_sim_all = SimData.from_idvg(dataset.idvg_vds5, temperature_c=25, vds_v=5.0)
final_sim_s3 = simulator.eval_idvg(model, s3_sim_all.ivar, vds=5.0)
ax2.plot(s3_sim_all.ivar, s3_sim_all.dvar, 'o', color='blue', label='Measured (all)', markersize=4, alpha=0.5)
ax2.plot(s3_sim_filtered.ivar, s3_sim_filtered.dvar, 'o', color='green', label='Measured (fitted region)', markersize=6)
mask_valid_s3 = final_sim_s3 > 1e-15
ax2.plot(s3_sim_all.ivar[mask_valid_s3], final_sim_s3[mask_valid_s3], '-', color='red', linewidth=2, label='LTspice sim (final model)')
ax2.axvline(s3_vgs_floor, color='orange', linestyle='--', linewidth=1.5, alpha=0.8, label=f'Vgs floor={s3_vgs_floor:.2f}V')
ax2.set_xlabel('Vgs (V)', fontsize=12)
ax2.set_ylabel('Id (A)', fontsize=12)
ax2.set_title(f'S3: Id-Vg @ Vds=5V\nRMS={result3.rms:.4f}, R2={result3.r_squared:.4f}\nFit: U0={model.get("U0"):.1f}, UA={model.get("UA"):.4f}', fontsize=11)
ax2.legend(fontsize=9)
ax2.grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig('idvg_fit_comparison.png', dpi=150, bbox_inches='tight')
print(f'  保存对比图: idvg_fit_comparison.png')

print('\n' + '=' * 60)
print('测试完成')
print('=' * 60)
