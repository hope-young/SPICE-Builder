"""Test fitting engine end-to-end"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

from spicebuilder.data.loader_sdh import load_sdh_excel
from spicebuilder.data.simdata import SimData
from spicebuilder.models import BSIM3Model, init_from_key_params
from spicebuilder.fitting import Optimizer, Stage, Engine
from spicebuilder.fitting.error_funcs import rms_log, rms_linear

# 加载数据
ds = load_sdh_excel('datademo/SDH10N2P1WC-AA_SPICE_Data.xlsx')
print(f'Loaded: {ds.device_info.part_number}')

# 创建 SimData
idvg_25c = SimData.from_idvg(ds.idvg_vds5, temperature_c=25, vds_v=5.0)
idvd_v5 = SimData.from_idvd(ds.idvd, vgs_v=5.0, temperature_c=25)
idvd_v10 = SimData.from_idvd(ds.idvd, vgs_v=10.0, temperature_c=25)
cv_ciss = SimData.from_cv(ds.cv_vds, cap_type='ciss')
cv_coss = SimData.from_cv(ds.cv_vds, cap_type='coss')
body_25c = SimData.from_body_diode(ds.body_diode, temperature_c=25)

print(f'SimData: {idvg_25c.n_points}, {idvd_v5.n_points}, {idvd_v10.n_points}, {cv_ciss.n_points}, {cv_coss.n_points}, {body_25c.n_points}')

# 创建 model
model = BSIM3Model(name='nmos1')
init_from_key_params(model, ds.key_params)
print(f'\\nModel init: VTH0={model.get("VTH0")}, U0={model.get("U0")}')

# 创建 optimizer
opt = Optimizer(method='trf')
opt.set_max_iter(200)
opt.set_eps1(1e-3)
opt.set_eps2(1e-3)
opt.set_eps3(1e-3)

# 创建 6 个 stage
print('\\n=== 6 阶段拟合 ===')

# S1: Threshold
s1 = Stage("S1_Threshold", [idvg_25c],
           param_names=["VTH0", "K1", "K2", "NFACTOR"],
           model=model, error_func="log")
r1 = s1.run(opt)
print(f'S1: success={r1.success}, RMS={r1.rms:.4f}, VTH0={model.get("VTH0"):.3f}')

# S3: Linear Mobility
s3 = Stage("S3_Linear_Mob", [idvg_25c],
           param_names=["U0", "UA", "UB", "UC"],
           model=model, error_func="log")
r3 = s3.run(opt)
print(f'S3: success={r3.success}, RMS={r3.rms:.4f}, U0={model.get("U0"):.1f}')

# S4: Saturation
s4 = Stage("S4_Saturation", [idvd_v5, idvd_v10],
           param_names=["VSAT", "A0", "AGS", "KETA", "RD", "RS"],
           model=model, error_func="log")
r4 = s4.run(opt)
print(f'S4: success={r4.success}, RMS={r4.rms:.4f}, VSAT={model.get("VSAT"):.0e}')

# S6: Capacitance
s6 = Stage("S6_Capacitance", [cv_ciss, cv_coss],
           param_names=["CGSO", "CGDO", "CGBO", "MJ", "MJSW"],
           model=model, error_func="linear")
r6 = s6.run(opt)
print(f'S6: success={r6.success}, RMS={r6.rms:.4f}, CGSO={model.get("CGSO"):.3e}')

# Engine 跑全 pipeline
print('\\n=== Engine 跑全 4 阶段 ===')
engine = Engine([s1, s3, s4, s6], error_threshold=0.5, max_loops=2)
result = engine.run(opt)
print(f'Engine: success={result.success}, RMS={result.total_rms:.4f}, iter={result.iterations}')
print(f'  Message: {result.message}')

# 打印最终参数
print('\\n=== Final fitted parameters ===')
for p in model.get_params_by_stage('S1'):
    print(f'  S1: {p} = {model.get(p):.4g} (init was {model._initial.get(p, "?")})')
for p in model.get_params_by_stage('S3'):
    print(f'  S3: {p} = {model.get(p):.4g}')

print('\\n✓ Fitting test passed!')
