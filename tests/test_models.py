"""Test BSIM3 model layer"""
import sys
from pathlib import Path

# 强制 UTF-8 输出
sys.stdout.reconfigure(encoding='utf-8')

from spicebuilder.data.loader_sdh import load_sdh_excel
from spicebuilder.models import BSIM3Model, STAGE_PARAM_MAP, init_from_key_params, LibExporter

# 加载数据
ds = load_sdh_excel('datademo/SDH10N2P1WC-AA_SPICE_Data.xlsx')
print('=== Device ===')
print(ds.device_info)

# 测试 1: 默认 model
model = BSIM3Model(name='nmos1')
assert model.get('VTH0') == 2.0
assert model.get('U0') == 450.0
assert len(model.to_dict()) == 49  # 49 个参数
print(f'PASS test_1: default model has {len(model.to_dict())} params')

# 测试 2: dot-path
assert model.get('nmos1.VTH0') == 2.0
print('PASS test_2: dot-path access')

# 测试 3: bounds 检查
try:
    model.set('VTH0', 100)  # 上界 8.0
    assert False, "should raise"
except ValueError:
    print('PASS test_3: bounds check')

# 测试 4: 初始值
init_from_key_params(model, ds.key_params)
vth0 = model.get('VTH0')
assert vth0 == ds.key_params.vth_25c_v, f"VTH0 mismatch: {vth0} vs {ds.key_params.vth_25c_v}"
print(f'PASS test_4: VTH0 init = {vth0} V')

# 测试 5: 阶段参数
s1_params = model.get_params_by_stage('S1')
assert 'VTH0' in s1_params
assert 'NFACTOR' in s1_params
s6_params = model.get_params_by_stage('S6')
assert 'CGBO' in s6_params
assert 'IS' in s6_params
print(f'PASS test_5: stage params (S1={len(s1_params)}, S6={len(s6_params)})')

# 测试 6: 拟合标记
assert not model.is_fitted('VTH0')
model.set('VTH0', 2.5)
assert model.is_fitted('VTH0')
model.reset('VTH0')
assert not model.is_fitted('VTH0')
assert model.get('VTH0') == ds.key_params.vth_25c_v
print('PASS test_6: fitted/reset')

# 测试 7: 导出 A
exp = LibExporter(part_number=ds.device_info.part_number)
a_path = exp.export_bsim3(model, 'tests/out_a.lib')
assert a_path.exists()
content = a_path.read_text(encoding='utf-8')
assert '.MODEL nmos1 NMOS LEVEL=49' in content
assert 'VTH0=3' in content
print(f'PASS test_7: export A ({a_path.stat().st_size} bytes)')

# 测试 8: 导出 B
b_path = exp.export_subckt(model, 'tests/out_b.lib', subckt_name='SDH10N2P1')
content = b_path.read_text(encoding='utf-8')
assert '.SUBCKT SDH10N2P1' in content
assert 'Dbody S D Dbody_diode' in content
assert '.MODEL BSIM3_core NMOS' in content
print(f'PASS test_8: export B ({b_path.stat().st_size} bytes)')

# 测试 9: 输出示例
print()
print('=== Export B 内容预览 ===')
print('\n'.join(content.split('\n')[:25]))

# 测试 10: 所有参数
from spicebuilder.models.bsim3 import PARAM_SPECS
total = len(PARAM_SPECS)
print(f'\nTotal BSIM3 params: {total}')

print('\n✓ All tests passed!')
