# SpiceBuilder

> SPICE Model Extraction Tool for Si SGT Power MOSFETs (BSIM3v3)
> Tauri+React desktop app + Python FastAPI backend + LTspice simulator

---

## ⚡ Quick start (dev mode, **REAL-TIME PREVIEW**)


### Dev mode workflow

```
dev.bat  (double-click)
  ↓
  [Window 1] Python API server (port 8765)
  [Window 2] Tauri dev (Vite + WebView)
  
  ↓ You edit src/app/components/FittingPipeline.tsx
  ↓ Vite HMR detects change
  ↓ Tauri window refreshes automatically
  ↓ No rebuild needed!
```

Speed comparison:

| Mode | Edit .tsx | Edit Python | Edit Rust |
|---|---|---|---|
| `npm run tauri dev` (HMR) | **< 1s** ⚡ | 3s (restart API) | 30s (rebuild) |
| `npx tauri build --no-bundle` | 30s (full) | 30s | 2-3 min |
| `npx tauri build` (.msi) | 1-2 min | 1-2 min | 5+ min |

**Always use `dev.bat` for development.** Only build when you need a distributable .exe.

---

## 🏗️ Project structure

```
E:\AICoding\SpiceBuilder\
├── dev.bat                          # ⭐ Double-click for dev mode (real-time preview)
├── README.md                        # This file
│
├── spicebuilder/                    # Python backend (~3000 lines)
│   ├── data/        Loader (SDH Excel) + SimData
│   ├── models/      BSIM3 49 params + initial values + exporter
│   ├── fitting/     Optimizer (scipy trf) + Stage + Engine
│   ├── strategy/    sgt_6stage.py
│   ├── simulator/   LTspice -b backend + raw parser
│   └── api/         FastAPI 8 endpoints
│
├── src/                             # React frontend (Vite + recharts)
│   ├── app/
│   │   ├── App.tsx                  # main router (state-based 8 screens)
│   │   └── components/              # 8 screens + 5 UI components
│   └── lib/                         # types + api + utils
│
├── src-tauri/                       # Rust IPC + window
│   ├── tauri.conf.json
│   ├── icons/                       # full icon set
│   └── src/commands/                # python_backend + proxy + filesystem
│
├── scripts/                         # Demos + plots
│   ├── run_demo.py                  # end-to-end CLI demo
│   ├── plot_fit_results.py          # 5 subplots, 3 output formats
│   └── plot_fit_comparison.py       # target vs LTspice-simulated fit
│
├── datademo/                        # Sample data + outputs
│   ├── SDH10N2P1WC-AA_SPICE_Data.xlsx
│   ├── SDH10N2P1WC-AA.lib           # Exported fitted model
│   ├── fit_comparison.png           # 5 subplots (default scales)
│   ├── fit_comparison_all_log.png   # all log scale
│   └── fit_comparison.html          # Plotly interactive
│
├── figma/                           # Chinese Figma prompts
├── figma_extracted/                 # Figma React source (70+ files)
├── 来自SentaurusTCAD的参考/         # 3 TCAD reference docs
│
├── pyproject.toml                   # uv-compatible
├── package.json                     # npm + tauri
├── tsconfig.json + tsconfig.node.json
├── INTERFACES.md                    # Module interface spec
└── requirements-api.txt             # fastapi, uvicorn, pydantic
```

---

## 🛠️ Prerequisites (Windows)

| Tool | Version | Verify | Install |
|---|---|---|---|
| Python | 3.10+ | `python --version` | https://www.python.org |
| Node.js | 18+ | `node --version` | https://nodejs.org |
| Rust | 1.70+ | `rustc --version` | https://rustup.rs |
| Tauri prereqs | — | `npx tauri info` | https://tauri.app |
| LTspice | XVII+ | `where ltspice` | https://www.analog.com/en/design-center/design-tools-and-calculators/ltspice-simulator.html |

First-time setup:
```bash
# Python deps
pip install -e .
pip install -r requirements-api.txt
pip install openpyxl matplotlib  # for data loading + plotting

# Node deps
npm install
```

---

## 📦 Three modes of running

### Mode 1: `dev.bat` ⭐ **RECOMMENDED for development**

Double-click `dev.bat`. Opens 2 windows:
- Python API server (port 8765)
- Tauri dev window (auto-opens, HMR enabled)

**Edit `.tsx` → GUI auto-refreshes in < 1s.** No rebuild needed.

### Mode 2: Standalone `.exe` (for distribution)

```bash
npx tauri build --no-bundle
# → src-tauri\target\release\spicebuilder.exe (6.5 MB)
```

Double-click the .exe to run. **Requires Python + spicebuilder on the same machine** (Tauri spawns it as sidecar).

### Mode 3: Full installer `.msi`

```bash
npx tauri build
# → src-tauri\target\release\bundle\msi\SpiceBuilder_0.1.0_x64_en-US.msi (~15 MB)
```

User double-clicks .msi, gets Start Menu + Desktop shortcut.

---

## 🔧 Python API (8 endpoints)

`POST /api/projects/load` → `{project_id, device_info, key_params}`
`POST /api/projects/{id}/fit` → `{task_id}` (background)
`GET /api/tasks/{id}` → `{status, progress, result: {total_rms, stages}}`
`GET /api/projects/{id}/model` → `{n_params, n_fitted, params: [...]}`
`POST /api/projects/{id}/export` → `{success, file_path}`
`GET /api/projects/{id}/curves/{type}` → `{name, curve_type, data, metadata}`
`GET /api/health` → `{status, version}`
`GET /api/projects` / `GET /api/tasks` (list)

Start API standalone:
```bash
python -m spicebuilder.api.scripts.run_api
# http://127.0.0.1:8765
```

Test:
```bash
curl http://127.0.0.1:8765/api/health
```

---

## 📊 6-stage extraction strategy

| Stage | Target curve | Parameters |
|---|---|---|
| S1: Threshold | Id-Vg @ Vds=0.5V | VTH0, K1, K2, DVT0-1, NFACTOR, CDSC |
| S2: Subthreshold | Id-Vg @ Vds=0.5V (Vgs<3.5V) | NFACTOR, CDSCD, CDSCB |
| S3: Linear Mobility | Id-Vg @ Vds=5V | U0, UA, UB, UC |
| S4: Saturation | Id-Vd @ Vgs=5/6/8/10V | VSAT, A0, AGS, KETA, RD, RS |
| S5: Output Resistance | Id-Vd saturation region | PCLM, PDIBLC1-2, DROUT, PVAG, KT1-2, UTE, UA1, UB1, UC1, PRT |
| S6: Capacitance + Diode | Ciss/Coss/Crss + Is-Vsd | CGBO, CGDO, CGSO, MJ, MJSW, PB, PBSW, TT, IS, N, BV, IBV |

---

## 🎨 5-subplot preview

`python scripts/plot_fit_results.py` generates:
- `datademo/fit_comparison.png` — default scales (IdVg/IdVd/Qg=linear, Cap/Isd=log)
- `datademo/fit_comparison_all_log.png` — all log
- `datademo/fit_comparison.html` — Plotly interactive (click to toggle log/linear)

---

## 🐛 Known issues

1. **VTH0 fit stuck at 1.04V** (should ~3V). Initial value / bounds need tuning.
2. **U0 not extracted** (stays at default 100 cm²/V·s).
3. **S5 Output Resistance has 0 data points** (filter too strict).
4. **Id-Vg @150°C data not provided** (removed during cleaning).
5. **Qg data not provided** (subplot shows placeholder).

---

## 🔍 Troubleshooting

### `npx tauri build` fails with "拒绝访问"
Your old .exe is still running. **Close it** (task manager) and rebuild.

### `npx tauri dev` window doesn't open
Tauri needs **WebView2 Runtime** (Windows 10 1809+ has it built-in; Windows 7 needs install).

### Tauri window opens but API shows "Python not found"
Tauri spawns `python -m spicebuilder.api.scripts.run_api`. You need:
- `python` in PATH
- `pip install -e .` (or `pip install spicebuilder`) in same Python

### LTspice not found
```bash
setx PATH "%PATH%;C:\Users\<user>\AppData\Local\Programs\ADI\LTspice"
```

### Dev mode is slow
- First run: 3-5 min (compiles all Rust deps)
- Incremental: 30-60s for Rust, **< 1s for React HMR**

---

## License

Single-user self-use. Not for redistribution.
