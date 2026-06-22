"""
plot_fit_lt.py
=============
用 LTspice 仿真拟合后的 .lib，画 target vs fit (真 BSIM3 仿真)。

修复 plot_fit_results.py 的 fit overlay 跳变问题（简化公式不准确）。
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import requests, time, uvicorn, threading
from pathlib import Path
from spicebuilder.api.server import app
from spicebuilder.data.loader_sdh import load_sdh_excel
from spicebuilder.data.simdata import SimData
from spicebuilder.simulator.ltspice import LTspiceBackend, gen_idvg_netlist, gen_idvd_netlist

# === 1. 启动 API server ===
config = uvicorn.Config(app, host='127.0.0.1', port=19999, log_level='error')
server = uvicorn.Server(config)
t = threading.Thread(target=server.run, daemon=True)
t.start()
time.sleep(2)

# === 2. 加载 + 拟合 + 导出 ===
r = requests.post('http://127.0.0.1:19999/api/projects/load',
                  json={'excel_path': 'datademo/SDH10N2P1WC-AA_SPICE_Data.xlsx'})
pid = r.json()['project_id']

r = requests.post(f'http://127.0.0.1:19999/api/projects/{pid}/fit',
                  json={'stages': ['S1', 'S2', 'S3', 'S4', 'S6'],
                        'max_loops': 1,
                        'optimizer': {'method': 'trf', 'max_iter': 30, 'eps1': 1e-2, 'eps2': 1e-2}})
tid = r.json()['task_id']
for i in range(30):
    r = requests.get(f'http://127.0.0.1:19999/api/tasks/{tid}')
    if r.json()['status'] in ('completed', 'failed'):
        print(f"Fit: {r.json()['status']}, rms={r.json().get('result', {}).get('total_rms', 0):.3f}")
        break
    time.sleep(1)

lib_path = 'datademo/SDH10N2P1WC-AA.lib'
r = requests.post(f'http://127.0.0.1:19999/api/projects/{pid}/export',
                  json={'format': 'B', 'output_path': lib_path, 'rg_ohm': 1.6})
print(f"Export: {r.json()}")

# === 3. LTspice 仿真 ===
backend = LTspiceBackend()
ds = load_sdh_excel('datademo/SDH10N2P1WC-AA_SPICE_Data.xlsx')

# Id-Vg @Vds=5V
print("\nLTspice: Id-Vg @Vds=5V...")
res = backend.run_netlist_text(
    gen_idvg_netlist(lib_path, vgs_min=0, vgs_max=5.5, vgs_step=0.1, vds_v=5.0,
                      model_name='SDH10N2P1', use_subckt=True),
    timeout_s=30,
    cleanup=False,  # 保留 .raw 文件给 parse_raw
)
print(f"  Success: {res.success}, elapsed: {res.elapsed_s:.2f}s")
fit_vgs = fit_id = None
if res.success and res.raw_path:
    raw = backend.parse_raw(res.raw_path)
    if 'V(g)' in raw and 'I(Vds)' in raw:
        fit_vgs = np.array(raw['V(g)']['ivar'])
        fit_id = np.array(raw['I(Vds)']['dvar'])

# Id-Vd @Vgs=10V
print("LTspice: Id-Vd @Vgs=10V...")
res = backend.run_netlist_text(
    gen_idvd_netlist(lib_path, vds_max=12, vds_step=0.5, vgs_v=10.0,
                      model_name='SDH10N2P1', use_subckt=True),
    timeout_s=30,
    cleanup=False,
)
print(f"  Success: {res.success}, elapsed: {res.elapsed_s:.2f}s")
fit_vds = fit_idvd = None
if res.success and res.raw_path:
    raw = backend.parse_raw(res.raw_path)
    # Ids match 'I(Vds)' here too
    if 'V(d)' in raw and 'I(Vds)' in raw:
        fit_vds = np.array(raw['V(d)']['ivar'])
        fit_idvd = np.array(raw['I(Vds)']['dvar'])

# === 4. 画 2x2 图 ===
fig, axes = plt.subplots(1, 2, figsize=(14, 6))
fig.suptitle('SpiceBuilder: Target vs LTspice-Simulated Fit (Real BSIM3)',
             fontsize=14, fontweight='bold')

# Id-Vg @Vds=5V log
ax = axes[0]
target = SimData.from_idvg(ds.idvg_vds5, temperature_c=25, vds_v=5.0)
ax.semilogy(target.ivar, target.dvar, 'b-', label='Target (measured)', linewidth=2, marker='.', markersize=3)
if fit_vgs is not None:
    mask = np.abs(fit_id) > 1e-15
    ax.semilogy(fit_vgs[mask], np.abs(fit_id[mask]), 'r--', label='Fit (LTspice BSIM3 sim)', linewidth=2)
ax.set_xlabel('Vgs (V)', fontsize=12)
ax.set_ylabel('|Id| (A) [log]', fontsize=12)
ax.set_title('Id-Vg @ Vds=5V', fontsize=13)
ax.legend(fontsize=10)
ax.grid(True, alpha=0.3, which='both')
ax.set_ylim(1e-9, 1e2)

# Id-Vd @Vgs=10V log
ax = axes[1]
target_idvd = SimData.from_idvd(ds.idvd, vgs_v=10.0, temperature_c=25)
ax.semilogy(target_idvd.ivar, target_idvd.dvar, 'b-', label='Target (measured)', linewidth=2, marker='o', markersize=3)
if fit_vds is not None:
    mask = np.abs(fit_idvd) > 1e-9
    ax.semilogy(fit_vds[mask], np.abs(fit_idvd[mask]), 'r--', label='Fit (LTspice BSIM3 sim)', linewidth=2)
ax.set_xlabel('Vds (V)', fontsize=12)
ax.set_ylabel('Id (A) [log]', fontsize=12)
ax.set_title('Id-Vd @ Vgs=10V', fontsize=13)
ax.legend(fontsize=10)
ax.grid(True, alpha=0.3, which='both')
ax.set_xlim(0, 12)

plt.tight_layout()
out = Path('datademo/fit_vs_target_lt.png')
plt.savefig(out, dpi=120, bbox_inches='tight')
print(f"\nSaved: {out} ({out.stat().st_size//1024} KB)")
plt.close()
