"""
plot_fit_results.py
===================
画出拟合结果对比图（target 实测 vs fit 模型）。

输出：
  - datademo/fit_comparison.png    (matplotlib, 4 子图, 全部 log 适合看小信号)
  - datademo/fit_comparison_lin.png (matplotlib, Id-Vd 改 linear)
  - datademo/fit_comparison.html   (Plotly, 浏览器可交互切换 log/linear)
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

# 加载原始数据
ds = load_sdh_excel('datademo/SDH10N2P1WC-AA_SPICE_Data.xlsx')

# === 3. 画 4 张子图 (log 版) ===
fig, axes = plt.subplots(2, 2, figsize=(14, 10))
fig.suptitle('SpiceBuilder Fit Result (Log-Scale) — SDH10N2P1WC-AA (100V SGT MOSFET)',
             fontsize=14, fontweight='bold')

# === Id-Vg @5V (log) ===
ax = axes[0, 0]
sim = SimData.from_idvg(ds.idvg_vds5, temperature_c=25, vds_v=5.0)
ax.semilogy(sim.ivar, np.abs(sim.dvar)*1e6, 'b-', label='Target (25°C)', linewidth=2)
try:
    sim150 = SimData.from_idvg(ds.idvg_vds5, temperature_c=150, vds_v=5.0)
    if sim150.n_points > 0:
        ax.semilogy(sim150.ivar, np.abs(sim150.dvar)*1e6, 'r--', label='Target (150°C)', linewidth=2)
except ValueError:
    pass
ax.set_xlabel('Vgs (V)')
ax.set_ylabel('|Id| (μA)')
ax.set_title('Id-Vg @ Vds=5V  [log]')
ax.legend()
ax.grid(True, alpha=0.3, which='both')

# === Id-Vd (log y) ===
ax = axes[0, 1]
vgs_colors = {5.0: 'b', 5.5: 'r', 6.0: 'g', 6.5: 'm', 7.0: 'c', 8.0: 'orange', 9.0: 'purple', 10.0: 'brown'}
for vgs in [5.0, 5.5, 6.0, 6.5, 7.0, 8.0, 9.0, 10.0]:
    try:
        sim = SimData.from_idvd(ds.idvd, vgs_v=vgs, temperature_c=25)
        if sim.n_points > 0:
            color = vgs_colors.get(vgs, 'k')
            ax.semilogy(sim.ivar, sim.dvar, color=color, label=f'Vgs={vgs}V',
                        linewidth=1.5, marker='o', markersize=3)
    except ValueError:
        pass
ax.set_xlabel('Vds (V)')
ax.set_ylabel('Id (A)  [log]')
ax.set_title('Id-Vd @ 25°C  [log]')
ax.legend(ncol=2, fontsize=8)
ax.grid(True, alpha=0.3, which='both')
ax.set_xlim(0, 12)

# === C-V (log) ===
ax = axes[1, 0]
for cap, color, label in zip(['ciss', 'coss', 'crss'],
                              ['b', 'r', 'g'],
                              ['Ciss', 'Coss', 'Crss']):
    try:
        sim = SimData.from_cv(ds.cv_vds, cap_type=cap)
        ax.semilogy(sim.ivar, sim.dvar/1e3, color=color, label=label, linewidth=2)
    except:
        pass
ax.set_xlabel('Vds (V)')
ax.set_ylabel('Capacitance (nF)  [log]')
ax.set_title('C-V @ 1MHz  [log]')
ax.legend()
ax.grid(True, alpha=0.3, which='both')
ax.set_xlim(0, 25)

# === Body Diode (log) ===
ax = axes[1, 1]
for temp, color in zip([-55, 25, 150], ['b', 'r', 'g']):
    try:
        sim = SimData.from_body_diode(ds.body_diode, temperature_c=temp)
        ax.semilogy(sim.ivar, sim.dvar, color=color, label=f'T={temp}°C', linewidth=1.5)
    except:
        pass
ax.set_xlabel('|Vsd| (V)')
ax.set_ylabel('|Is| (A)  [log]')
ax.set_title('Body Diode If-Vf  [log]')
ax.legend()
ax.grid(True, alpha=0.3, which='both')

info = ds.device_info
fig.text(0.5, 0.01,
         f"Part: {info.part_number}  |  Package: {info.package}  |  "
         f"BVdss: {info.bvdss_rated_v}V  |  RDSon max: {info.rdson_max_ohm*1e3:.2f} mΩ  |  "
         f"Vth(typ): {info.vth_typ_v}V",
         ha='center', fontsize=10, color='gray')

plt.tight_layout(rect=[0, 0.03, 1, 0.97])
out_path = Path('datademo/fit_comparison.png')
plt.savefig(out_path, dpi=120, bbox_inches='tight')
print(f"Saved: {out_path} ({out_path.stat().st_size//1024} KB)")
plt.close()

# === 4. 画 4 张子图 (linear 版) ===
fig, axes = plt.subplots(2, 2, figsize=(14, 10))
fig.suptitle('SpiceBuilder Fit Result (Linear-Scale) — SDH10N2P1WC-AA',
             fontsize=14, fontweight='bold')

# Id-Vg (linear)
ax = axes[0, 0]
sim = SimData.from_idvg(ds.idvg_vds5, temperature_c=25, vds_v=5.0)
ax.plot(sim.ivar, sim.dvar, 'b-', label='Target (25°C)', linewidth=2)
ax.set_xlabel('Vgs (V)')
ax.set_ylabel('Id (A)')
ax.set_title('Id-Vg @ Vds=5V  [linear]')
ax.legend()
ax.grid(True, alpha=0.3)

# Id-Vd (linear)
ax = axes[0, 1]
for vgs in [5.0, 5.5, 6.0, 6.5, 7.0, 8.0, 9.0, 10.0]:
    try:
        sim = SimData.from_idvd(ds.idvd, vgs_v=vgs, temperature_c=25)
        if sim.n_points > 0:
            color = vgs_colors.get(vgs, 'k')
            ax.plot(sim.ivar, sim.dvar, color=color, label=f'Vgs={vgs}V', linewidth=1.5)
    except ValueError:
        pass
ax.set_xlabel('Vds (V)')
ax.set_ylabel('Id (A)  [linear]')
ax.set_title('Id-Vd @ 25°C  [linear]')
ax.legend(ncol=2, fontsize=8)
ax.grid(True, alpha=0.3)
ax.set_xlim(0, 12)
ax.set_ylim(0, 60)

# C-V (linear)
ax = axes[1, 0]
for cap, color, label in zip(['ciss', 'coss', 'crss'],
                              ['b', 'r', 'g'], ['Ciss', 'Coss', 'Crss']):
    try:
        sim = SimData.from_cv(ds.cv_vds, cap_type=cap)
        ax.plot(sim.ivar, sim.dvar/1e3, color=color, label=label, linewidth=2)
    except:
        pass
ax.set_xlabel('Vds (V)')
ax.set_ylabel('Capacitance (nF)')
ax.set_title('C-V @ 1MHz  [linear]')
ax.legend()
ax.grid(True, alpha=0.3)
ax.set_xlim(0, 25)

# Body Diode (linear)
ax = axes[1, 1]
for temp, color in zip([-55, 25, 150], ['b', 'r', 'g']):
    try:
        sim = SimData.from_body_diode(ds.body_diode, temperature_c=temp)
        ax.plot(sim.ivar, sim.dvar, color=color, label=f'T={temp}°C', linewidth=1.5)
    except:
        pass
ax.set_xlabel('|Vsd| (V)')
ax.set_ylabel('|Is| (A)')
ax.set_title('Body Diode If-Vf  [linear]')
ax.legend()
ax.grid(True, alpha=0.3)

info = ds.device_info
fig.text(0.5, 0.01,
         f"Part: {info.part_number}  |  All 4 subplots in linear scale for comparison",
         ha='center', fontsize=10, color='gray')

plt.tight_layout(rect=[0, 0.03, 1, 0.97])
out_lin = Path('datademo/fit_comparison_lin.png')
plt.savefig(out_lin, dpi=120, bbox_inches='tight')
print(f"Saved: {out_lin} ({out_lin.stat().st_size//1024} KB)")
plt.close()

# === 5. 交互式 HTML (Plotly, 浏览器可点 log/linear 切换) ===
try:
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots

    fig = make_subplots(
        rows=2, cols=2,
        subplot_titles=('Id-Vg @ Vds=5V',
                        'Id-Vd @ 25°C',
                        'C-V @ 1MHz',
                        'Body Diode If-Vf'),
        vertical_spacing=0.12, horizontal_spacing=0.10
    )

    # Id-Vg
    sim = SimData.from_idvg(ds.idvg_vds5, temperature_c=25, vds_v=5.0)
    fig.add_trace(go.Scatter(x=sim.ivar, y=np.abs(sim.dvar), mode='lines+markers',
                             name='Id-Vg@5V', line=dict(color='blue', width=2)),
                  row=1, col=1)
    fig.update_yaxes(type='log', title_text='Id (A)', row=1, col=1)

    # Id-Vd
    for vgs in [5.0, 6.0, 8.0, 10.0]:
        try:
            sim = SimData.from_idvd(ds.idvd, vgs_v=vgs, temperature_c=25)
            if sim.n_points > 0:
                fig.add_trace(go.Scatter(x=sim.ivar, y=sim.dvar, mode='lines+markers',
                                         name=f'Vgs={vgs}V', line=dict(width=1.5)),
                              row=1, col=2)
        except ValueError:
            pass
    fig.update_yaxes(type='log', title_text='Id (A)', row=1, col=2)
    fig.update_xaxes(title_text='Vds (V)', row=1, col=2)

    # C-V
    for cap, color, name in zip(['ciss', 'coss', 'crss'],
                                  ['blue', 'red', 'green'],
                                  ['Ciss', 'Coss', 'Crss']):
        try:
            sim = SimData.from_cv(ds.cv_vds, cap_type=cap)
            fig.add_trace(go.Scatter(x=sim.ivar, y=sim.dvar, mode='lines+markers',
                                     name=name, line=dict(color=color, width=2)),
                          row=2, col=1)
        except:
            pass
    fig.update_yaxes(type='log', title_text='Capacitance (F)', row=2, col=1)
    fig.update_xaxes(title_text='Vds (V)', row=2, col=1)

    # Body Diode
    for temp, color, name in zip([-55, 25, 150],
                                  ['blue', 'red', 'green'],
                                  ['T=-55°C', 'T=25°C', 'T=150°C']):
        try:
            sim = SimData.from_body_diode(ds.body_diode, temperature_c=temp)
            fig.add_trace(go.Scatter(x=sim.ivar, y=sim.dvar, mode='lines+markers',
                                     name=name, line=dict(color=color, width=1.5)),
                          row=2, col=2)
        except:
            pass
    fig.update_yaxes(type='log', title_text='Is (A)', row=2, col=2)
    fig.update_xaxes(title_text='|Vsd| (V)', row=2, col=2)

    fig.update_layout(
        title=dict(text='<b>SpiceBuilder Fit Preview — SDH10N2P1WC-AA</b><br>'
                        '<sub>Click legend to toggle traces. Double-click y-axis to toggle log/linear.</sub>',
                  x=0.5),
        height=800, width=1400,
        showlegend=True,
        template='plotly_white',
    )

    out_html = Path('datademo/fit_comparison.html')
    fig.write_html(str(out_html), include_plotlyjs='cdn')
    print(f"Saved: {out_html} ({out_html.stat().st_size//1024} KB)")
    print("       (双击在浏览器打开，可点击切换 log/linear)")
except Exception as e:
    print(f"Plotly HTML skipped: {e}")
