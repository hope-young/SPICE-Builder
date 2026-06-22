"""
plot_fit_results.py
===================
画出拟合结果对比图（target 实测 vs fit 模型）。

5 个子图（Power MOSFET 完整建模）：
  - Id-Vg  (默认 linear)
  - Id-Vd  (默认 linear)
  - C-V    (默认 log) - Ciss/Coss/Crss
  - Qg     (默认 linear) - PLACEHOLDER if no data
  - Isd    (默认 log) - 体二极管

输出 3 个图：
  - datademo/fit_comparison.png    (matplotlib, 5 subplots, 按上面 default scale)
  - datademo/fit_comparison_all_log.png (matplotlib, 全部 log)
  - datademo/fit_comparison.html   (Plotly, 浏览器可交互切换)
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

# 导出 .lib to get fitted model（plot fit overlay）
import subprocess
r = requests.post(f'http://127.0.0.1:19999/api/projects/{pid}/export',
                  json={'format': 'B', 'output_path': 'datademo/SDH10N2P1WC-AA.lib', 'rg_ohm': 1.6})
print(f"Export: {r.json().get('n_bytes', 0)} bytes")

# 获得 fitted model 用于 fit overlay
r = requests.get(f'http://127.0.0.1:19999/api/projects/{pid}/model')
fitted_model_dict = {p['name']: p['value'] for p in r.json()['params']}
print(f"Fitted model: VTH0={fitted_model_dict.get('VTH0', 0):.3f}, "
      f"U0={fitted_model_dict.get('U0', 0):.1f}")

# 是否有 Qg 数据
HAS_QG = False
print(f"Qg data: {'available' if HAS_QG else 'NOT available (placeholder)'}")


def predict_idvg(model_dict, vgs, vds=0.5):
    """用 stage.py 简化公式评估 Id-Vg"""
    vth = model_dict.get('VTH0', 3.0)
    n = model_dict.get('NFACTOR', 2.0)
    u0 = model_dict.get('U0', 450)
    vsat = model_dict.get('VSAT', 1e5)
    vt = 0.0259
    cox = 6.9e-4
    w_m, l_m = 0.1, 1e-6  # 100mm × 1um (SGT die)
    mu = u0 * 1e-4
    vov = np.maximum(vgs - vth, 0)
    i0 = (w_m / l_m) * cox * mu * vt**2
    i_sub = i0 * np.exp(np.clip((vgs - vth) / (n * vt), -50, 50))
    i_sat_full = 0.5 * (w_m / l_m) * cox * mu * vov**2
    i_vsat = w_m * cox * vov * vsat
    i_strong = i_sat_full * i_vsat / (i_sat_full + i_vsat + 1e-12)
    alpha = 1.0 / (1.0 + np.exp(-(vgs - vth) / 0.05))
    return np.maximum(i_sub * (1 - alpha) + i_strong * alpha, 1e-15)


def predict_idvd(model_dict, vds, vgs=10.0):
    """用简化公式评估 Id-Vd"""
    vth = model_dict.get('VTH0', 3.0)
    u0 = model_dict.get('U0', 450)
    vsat = model_dict.get('VSAT', 1e5)
    cox = 6.9e-4
    w_m, l_m = 0.1, 1e-6
    rd = max(model_dict.get('RD', 1e-4) + model_dict.get('RS', 1e-4), 1e-6)
    mu = u0 * 1e-4
    vov = max(vgs - vth, 0)
    i_sat = (w_m / l_m) * cox * mu * vov * vsat / (vov + vsat * l_m + 1e-9)
    vds_clip = np.minimum(vds, vov)
    i_lin = vov * vds_clip / rd
    i_d = np.where(vds < vov, i_lin, i_sat)
    pclm = model_dict.get('PCLM', 0.5)
    i_d = np.where(vds < vov, i_d, i_d * (1 + pclm * (vds - vov)))
    return np.maximum(i_d, 1e-9)


def predict_cv(model_dict, vds, cap_type='ciss'):
    cgdo = model_dict.get('CGDO', 1e-9)
    cgso = model_dict.get('CGSO', 1e-9)
    cgbo = model_dict.get('CGBO', 1e-10)
    w_m, l_m = 0.1, 1e-6
    if cap_type == 'ciss': base = (cgdo + cgso) * w_m + cgbo * l_m
    elif cap_type == 'coss': base = cgdo * w_m
    elif cap_type == 'crss': base = cgdo * w_m
    else: base = cgdo * w_m
    decay = 1.0 / (1.0 + np.maximum(vds, 0) / 5.0)
    return base * (1.0 + 0.5 * decay) * 1e12


def predict_diode(model_dict, vsd):
    is_ = model_dict.get('IS', 1e-12)
    n = model_dict.get('N', 1.5)
    vt = 0.0259
    return np.maximum(is_ * (np.exp(vsd / (n * vt)) - 1), 1e-15)

# === 3. 画 5 张子图 (default scale) ===
fig, axes = plt.subplots(2, 3, figsize=(18, 10))
fig.suptitle('SpiceBuilder Fit Result (Default Scales) — SDH10N2P1WC-AA (100V SGT MOSFET)',
             fontsize=14, fontweight='bold')

# (1) Id-Vg @5V — linear
ax = axes[0, 0]
sim = SimData.from_idvg(ds.idvg_vds5, temperature_c=25, vds_v=5.0)
ax.plot(sim.ivar, sim.dvar * 1e6, 'b-', label='Target (25°C)', linewidth=2)
# Fit overlay
vgs_fit = np.linspace(0, 5.5, 100)
id_fit = predict_idvg(fitted_model_dict, vgs_fit, vds=5.0) * 1e6
ax.plot(vgs_fit, id_fit, 'r--', label='Fit (simplified)', linewidth=2, alpha=0.8)
ax.set_xlabel('Vgs (V)')
ax.set_ylabel('Id (μA)  [linear]')
ax.set_title('Id-Vg @ Vds=5V  [linear]')
ax.set_ylim(-10, 380)
ax.legend()
ax.grid(True, alpha=0.3)

# (2) Id-Vd @25°C — linear
ax = axes[0, 1]
vgs_colors = {5.0: 'b', 5.5: 'r', 6.0: 'g', 6.5: 'm', 7.0: 'c', 8.0: 'orange', 9.0: 'purple', 10.0: 'brown'}
for vgs in [5.0, 5.5, 6.0, 6.5, 7.0, 8.0, 9.0, 10.0]:
    try:
        sim = SimData.from_idvd(ds.idvd, vgs_v=vgs, temperature_c=25)
        if sim.n_points > 0:
            color = vgs_colors.get(vgs, 'k')
            ax.plot(sim.ivar, sim.dvar, color=color, label=f'Vgs={vgs}V', linewidth=1.5, marker='o', markersize=3)
    except ValueError:
        pass
# Fit overlay (red dashed, only for a few Vgs)
vds_fit = np.linspace(0, 12, 100)
for vgs_fit, color in [(5.0, 'b'), (8.0, 'orange'), (10.0, 'brown')]:
    id_fit = predict_idvd(fitted_model_dict, vds_fit, vgs=vgs_fit)
    ax.plot(vds_fit, id_fit, color=color, linestyle='--', linewidth=1.5, alpha=0.6)
ax.set_xlabel('Vds (V)')
ax.set_ylabel('Id (A)  [linear]')
ax.set_title('Id-Vd @ 25°C  [linear]')
ax.set_xlim(0, 12)
ax.set_ylim(-2, 60)
ax.legend(ncol=2, fontsize=8)
ax.grid(True, alpha=0.3)

# (3) C-V @1MHz — log
ax = axes[0, 2]
for cap, color, label in zip(['ciss', 'coss', 'crss'],
                              ['b', 'r', 'g'], ['Ciss', 'Coss', 'Crss']):
    try:
        sim = SimData.from_cv(ds.cv_vds, cap_type=cap)
        ax.semilogy(sim.ivar, sim.dvar/1e3, color=color, label=label, linewidth=2)
    except:
        pass
# Fit overlay
vds_cv = np.linspace(0, 25, 50)
for cap, color in zip(['ciss', 'coss', 'crss'], ['b', 'r', 'g']):
    c_fit = predict_cv(fitted_model_dict, vds_cv, cap_type=cap) / 1e3  # to nF
    ax.semilogy(vds_cv, c_fit, color=color, linestyle='--', linewidth=1.5, alpha=0.6)
ax.set_xlabel('Vds (V)')
ax.set_ylabel('Capacitance (nF)  [log]')
ax.set_title('C-V @ 1MHz  [log]')
ax.set_ylim(0.01, 100)
ax.legend()
ax.grid(True, alpha=0.3, which='both')
ax.set_xlim(0, 25)

# (4) Qg — linear PLACEHOLDER
ax = axes[1, 0]
if HAS_QG:
    # 实测数据会放这里
    pass
else:
    # 灰色 placeholder
    ax.text(0.5, 0.5,
            'Qg data NOT provided\n\nOriginal Excel had VGS-Qg sheet\nbut it was removed during cleaning\n\nAdd VGS-Qg data to enable this subplot',
            transform=ax.transAxes, ha='center', va='center',
            fontsize=12, color='gray',
            bbox=dict(boxstyle='round,pad=0.5', facecolor='#f5f5f5', edgecolor='gray'))
ax.set_xlabel('Vgs (V)')
ax.set_ylabel('Qg (nC)  [linear]')
ax.set_title('Qg (Vgs-Qg)  [linear]  PLACEHOLDER')
ax.set_xlim(0, 10)
ax.set_ylim(0, 200)
ax.grid(True, alpha=0.3)

# (5) Body Diode — log (修 ylim 用 log range)
ax = axes[1, 1]
for temp, color in zip([-55, 25, 150], ['b', 'r', 'g']):
    try:
        sim = SimData.from_body_diode(ds.body_diode, temperature_c=temp)
        # 过滤 0 值（log 不能有 0）
        mask = sim.dvar > 0
        if mask.any():
            ax.semilogy(sim.ivar[mask], sim.dvar[mask], color=color, label=f'T={temp}°C', linewidth=1.5)
    except:
        pass
# Fit overlay (T=25C only)
vsd_fit = np.linspace(0.01, 1.3, 50)
is_fit = predict_diode(fitted_model_dict, vsd_fit)
ax.semilogy(vsd_fit, is_fit, 'r--', linewidth=2, alpha=0.6)
ax.set_xlabel('|Vsd| (V)')
ax.set_ylabel('|Is| (A)  [log]')
ax.set_title('Body Diode If-Vf  [log]')
ax.set_ylim(0.01, 500)  # 固定 4-5 个数量级
ax.legend()
ax.grid(True, alpha=0.3, which='both')

# (6) Device Info 卡片
ax = axes[1, 2]
info = ds.device_info
key = ds.key_params
ax.axis('off')
card_text = (
    f"═══ Device ═══\n"
    f"Part:    {info.part_number}\n"
    f"Package: {info.package}\n"
    f"BVdss:   {info.bvdss_rated_v} V\n"
    f"RDSon:   {info.rdson_max_ohm*1e3:.2f} mΩ\n"
    f"Vth(typ):{info.vth_typ_v} V\n"
    f"\n═══ Key SPICE Params ═══\n"
    f"Vth@25C:  {key.vth_25c_v} V\n"
    f"dVth/dT:  {key.dvth_dT_mv_per_c} mV/°C\n"
    f"RDSon@25C,10V: {key.rdson_25c_10v_ohm*1e3:.2f} mΩ\n"
    f"RDSon@150C:    {key.rdson_150c_10v_ohm*1e3:.2f} mΩ\n"
    f"Ciss@25V: {key.ciss_25v_pf:.0f} pF\n"
    f"Coss@25V: {key.coss_25v_pf:.0f} pF\n"
    f"Crss@25V: {key.crss_25v_pf:.0f} pF\n"
    f"Qg@20V:   {key.qg_on_20v_nc:.1f} nC\n"
    f"Qgd:      {key.qgd_nc:.1f} nC"
)
ax.text(0.05, 0.95, card_text, transform=ax.transAxes, ha='left', va='top',
        family='monospace', fontsize=10,
        bbox=dict(boxstyle='round,pad=0.5', facecolor='#fafafa', edgecolor='#e5e5e5'))
ax.set_title('Device Info')

info = ds.device_info
fig.text(0.5, 0.005,
         f"Part: {info.part_number}  |  Default scales: IdVg=linear, IdVd=linear, Cap=log, Qg=linear (placeholder), Isd=log",
         ha='center', fontsize=10, color='gray')

plt.tight_layout(rect=[0, 0.02, 1, 0.97])
out_path = Path('datademo/fit_comparison.png')
plt.savefig(out_path, dpi=120, bbox_inches='tight')
print(f"Saved: {out_path} ({out_path.stat().st_size//1024} KB)")
plt.close()

# === 4. 画全部 log 版 ===
fig, axes = plt.subplots(2, 3, figsize=(18, 10))
fig.suptitle('SpiceBuilder Fit Result (All-Log) — SDH10N2P1WC-AA',
             fontsize=14, fontweight='bold')

# Id-Vg log
ax = axes[0, 0]
sim = SimData.from_idvg(ds.idvg_vds5, temperature_c=25, vds_v=5.0)
mask = sim.dvar > 0
ax.semilogy(sim.ivar[mask], sim.dvar[mask] * 1e6, 'b-', label='Target (25°C)', linewidth=2)
ax.set_xlabel('Vgs (V)')
ax.set_ylabel('|Id| (μA)  [log]')
ax.set_title('Id-Vg @ Vds=5V  [log]')
ax.set_ylim(0.01, 1000)
ax.legend()
ax.grid(True, alpha=0.3, which='both')

# Id-Vd log
ax = axes[0, 1]
for vgs in [5.0, 5.5, 6.0, 6.5, 7.0, 8.0, 9.0, 10.0]:
    try:
        sim = SimData.from_idvd(ds.idvd, vgs_v=vgs, temperature_c=25)
        if sim.n_points > 0:
            color = vgs_colors.get(vgs, 'k')
            ax.semilogy(sim.ivar, sim.dvar, color=color, label=f'Vgs={vgs}V', linewidth=1.5, marker='o', markersize=3)
    except ValueError:
        pass
ax.set_xlabel('Vds (V)')
ax.set_ylabel('Id (A)  [log]')
ax.set_title('Id-Vd @ 25°C  [log]')
ax.set_xlim(0, 12)
ax.set_ylim(0.1, 500)
ax.legend(ncol=2, fontsize=8)
ax.grid(True, alpha=0.3, which='both')

# C-V log (already)
ax = axes[0, 2]
for cap, color, label in zip(['ciss', 'coss', 'crss'],
                              ['b', 'r', 'g'], ['Ciss', 'Coss', 'Crss']):
    try:
        sim = SimData.from_cv(ds.cv_vds, cap_type=cap)
        ax.semilogy(sim.ivar, sim.dvar/1e3, color=color, label=label, linewidth=2)
    except:
        pass
ax.set_xlabel('Vds (V)')
ax.set_ylabel('Capacitance (nF)  [log]')
ax.set_title('C-V @ 1MHz  [log]')
ax.set_ylim(0.01, 100)
ax.legend()
ax.grid(True, alpha=0.3, which='both')
ax.set_xlim(0, 25)

# Qg log placeholder
ax = axes[1, 0]
ax.text(0.5, 0.5,
        'Qg data NOT provided\n\n(placeholder)',
        transform=ax.transAxes, ha='center', va='center',
        fontsize=12, color='gray',
        bbox=dict(boxstyle='round,pad=0.5', facecolor='#f5f5f5', edgecolor='gray'))
ax.set_xlabel('Vgs (V)')
ax.set_ylabel('Qg (nC)  [log]')
ax.set_title('Qg  [log]  PLACEHOLDER')

# Isd log
ax = axes[1, 1]
for temp, color in zip([-55, 25, 150], ['b', 'r', 'g']):
    try:
        sim = SimData.from_body_diode(ds.body_diode, temperature_c=temp)
        mask = sim.dvar > 0
        if mask.any():
            ax.semilogy(sim.ivar[mask], sim.dvar[mask], color=color, label=f'T={temp}°C', linewidth=1.5)
    except:
        pass
ax.set_xlabel('|Vsd| (V)')
ax.set_ylabel('|Is| (A)  [log]')
ax.set_title('Body Diode If-Vf  [log]')
ax.set_ylim(0.01, 500)
ax.legend()
ax.grid(True, alpha=0.3, which='both')

# Device Info
ax = axes[1, 2]
ax.axis('off')
ax.text(0.05, 0.95, card_text, transform=ax.transAxes, ha='left', va='top',
        family='monospace', fontsize=10,
        bbox=dict(boxstyle='round,pad=0.5', facecolor='#fafafa', edgecolor='#e5e5e5'))
ax.set_title('Device Info')

plt.tight_layout(rect=[0, 0.02, 1, 0.97])
out_log = Path('datademo/fit_comparison_all_log.png')
plt.savefig(out_log, dpi=120, bbox_inches='tight')
print(f"Saved: {out_log} ({out_log.stat().st_size//1024} KB)")
plt.close()

# === 5. 交互式 HTML (Plotly) ===
try:
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots

    fig = make_subplots(
        rows=2, cols=3,
        subplot_titles=('Id-Vg @ Vds=5V  [default: linear]',
                        'Id-Vd @ 25°C  [default: linear]',
                        'C-V @ 1MHz  [default: log]',
                        'Qg (Vgs-Qg)  [default: linear, PLACEHOLDER]',
                        'Body Diode If-Vf  [default: log]',
                        'Device Info'),
        vertical_spacing=0.12, horizontal_spacing=0.08,
        specs=[[{}, {}, {}], [{}, {}, {"type": "domain"}]]  # last cell non-xy
    )

    # Id-Vg
    sim = SimData.from_idvg(ds.idvg_vds5, temperature_c=25, vds_v=5.0)
    fig.add_trace(go.Scatter(x=sim.ivar, y=sim.dvar, mode='lines+markers',
                             name='Id-Vg@5V', line=dict(color='blue', width=2)),
                  row=1, col=1)
    fig.update_yaxes(type='linear', title_text='Id (A)', row=1, col=1)
    fig.update_xaxes(title_text='Vgs (V)', row=1, col=1)

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
    fig.update_yaxes(type='linear', title_text='Id (A)', range=[-5, 60], row=1, col=2)
    fig.update_xaxes(title_text='Vds (V)', row=1, col=2)

    # C-V
    for cap, color, name in zip(['ciss', 'coss', 'crss'],
                                  ['blue', 'red', 'green'],
                                  ['Ciss', 'Coss', 'Crss']):
        try:
            sim = SimData.from_cv(ds.cv_vds, cap_type=cap)
            fig.add_trace(go.Scatter(x=sim.ivar, y=sim.dvar, mode='lines+markers',
                                     name=name, line=dict(color=color, width=2)),
                          row=1, col=3)
        except:
            pass
    fig.update_yaxes(type='log', title_text='Capacitance (F)', range=[-14, -10], row=1, col=3)
    fig.update_xaxes(title_text='Vds (V)', row=1, col=3)

    # Qg placeholder
    fig.add_annotation(text="Qg data NOT provided<br>(placeholder)", xref="x4 domain", yref="y4",
                        x=0.5, y=0.5, showarrow=False, font=dict(size=14, color='gray'),
                        bgcolor='#f5f5f5', bordercolor='gray', borderwidth=2)
    fig.update_xaxes(title_text='Vgs (V)', row=2, col=1)
    fig.update_yaxes(title_text='Qg (nC)', type='linear', range=[0, 200], row=2, col=1)

    # Isd
    for temp, color, name in zip([-55, 25, 150],
                                  ['blue', 'red', 'green'],
                                  ['T=-55°C', 'T=25°C', 'T=150°C']):
        try:
            sim = SimData.from_body_diode(ds.body_diode, temperature_c=temp)
            mask = sim.dvar > 0
            if mask.any():
                fig.add_trace(go.Scatter(x=sim.ivar[mask], y=sim.dvar[mask], mode='lines+markers',
                                         name=name, line=dict(color=color, width=1.5)),
                              row=2, col=2)
        except:
            pass
    fig.update_yaxes(type='log', title_text='Is (A)', range=[-2, 2.7], row=2, col=2)
    fig.update_xaxes(title_text='|Vsd| (V)', row=2, col=2)

    # Device Info 卡片
    fig.add_annotation(text=card_text, xref="paper", yref="y5",
                        x=0.83, y=0.30, showarrow=False, font=dict(size=10, family='monospace'),
                        bgcolor='#fafafa', bordercolor='#e5e5e5', borderwidth=1,
                        align='left')

    fig.update_layout(
        title=dict(text='<b>SpiceBuilder Fit Preview — SDH10N2P1WC-AA (5 subplots)</b><br>'
                        '<sub>Default scales: IdVg/IdVd/Qg=linear, Cap/Isd=log. Double-click any y-axis to toggle.</sub>',
                  x=0.5),
        height=850, width=1500,
        showlegend=True,
        template='plotly_white',
    )

    out_html = Path('datademo/fit_comparison.html')
    fig.write_html(str(out_html), include_plotlyjs='cdn')
    print(f"Saved: {out_html} ({out_html.stat().st_size//1024} KB)")
    print("       (双击在浏览器打开，5 subplots，双击 y 轴切 log/linear)")
except Exception as e:
    print(f"Plotly HTML skipped: {e}")
    import traceback
    traceback.print_exc()
