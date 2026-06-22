"""
debug_fit_s3.py
===============
S3 单独调试：U0 为什么不从 450 动？
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np
from spicebuilder.data.loader_sdh import load_sdh_excel
from spicebuilder.data.simdata import SimData
from spicebuilder.models.bsim3 import BSIM3Model
from spicebuilder.models.init_values import init_from_key_params
from spicebuilder.fitting.optimizer import Optimizer
from spicebuilder.fitting.stage import Stage
from spicebuilder.fitting.error_funcs import rms_log, rms_linear


ds = load_sdh_excel('datademo/SDH10N2P1WC-AA_SPICE_Data.xlsx')
sim = SimData.from_idvg(ds.idvg_vds5, temperature_c=25, vds_v=5.0)
print(f"Loaded: {sim.n_points} pts, Id range: {sim.dvar.min():.2e} ~ {sim.dvar.max():.2e}")

# 准备: VTH0 已 fix 到 2.0, 跑 S3
model = BSIM3Model()
init_from_key_params(model, ds.key_params)
model.set("VTH0", 2.0)  # 模拟上次 S1 后的结果
print(f"Init: VTH0={model.get('VTH0')}, U0={model.get('U0')}, NFACTOR={model.get('NFACTOR')}")

# 看拟合前后
opt = Optimizer(method='trf')
opt.set_eps1(1e-3); opt.set_eps2(1e-3); opt.set_max_iter(200)

stage = Stage(
    name="S3_test",
    simdata=[sim],
    param_names=["U0", "UA", "UB", "UC"],
    model=model,
    error_func="log",
)
print("\nRunning S3...")
result = stage.run(opt)
print(f"Result: rms={result.rms:.4f}")
print(f"After: VTH0={model.get('VTH0')}, U0={model.get('U0')}, NFACTOR={model.get('NFACTOR')}")

# 看 VTH0=3.0 时
print("\n--- Try VTH0=3.0 ---")
model = BSIM3Model()
init_from_key_params(model, ds.key_params)
model.set("VTH0", 3.0)  # 强制 datasheet 值
print(f"Init: VTH0={model.get('VTH0')}, U0={model.get('U0')}")

stage = Stage(
    name="S3_test_vth3",
    simdata=[sim],
    param_names=["U0", "UA", "UB", "UC"],
    model=model,
    error_func="log",
)
result = stage.run(opt)
print(f"Result: rms={result.rms:.4f}")
print(f"After: VTH0={model.get('VTH0')}, U0={model.get('U0')}, UA={model.get('UA'):.2e}, UB={model.get('UB'):.2e}")

# 试 linear RMS
print("\n--- linear RMS, VTH0=3.0 ---")
model = BSIM3Model()
init_from_key_params(model, ds.key_params)
model.set("VTH0", 3.0)

stage = Stage(
    name="S3_linear",
    simdata=[sim],
    param_names=["U0", "UA", "UB", "UC"],
    model=model,
    error_func="linear",
)
result = stage.run(opt)
print(f"Result: rms={result.rms:.4f}")
print(f"After: VTH0={model.get('VTH0')}, U0={model.get('U0')}")
