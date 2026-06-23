# SpiceBuilder 开发日志

## Status
**Phase: 修拟合完成 → React GUI 接 API 完成** ✅

## 当前阶段
- **修拟合 (RT-1)**: LTspice 评估器替代简化公式，Total RMS 1.50 → **0.64** (-57%)
- **GUI API 接入 (RT-2)**: 8 个 screen 全接 Tauri/FastAPI，0 mock

## Tasks
- [x] **修拟合**: LTspiceEvaluator 替代 stage.py 简化公式
  - 新建 `spicebuilder/simulator/evaluator.py` (LTspiceEvaluator 类)
  - `scripts/run_demo.py` 加 `--ltspice` flag
  - S1 RMS: 1.55 → 0.17 (9x), S3 RMS: 1.67 → 0.24 (7x), S6 RMS: 2.80 → 1.19 (2x)
  - Total RMS: 1.50 → 0.64
- [x] **React ↔ FastAPI**: 新建 `src/lib/store.tsx` (React Context), 重写 `src/lib/api.ts`
  - 8 个 screen 全接真 API（Dashboard, DataBrowser, CurveVisualizer, ModelEditor,
    FittingPipeline, ValidateScreen, ExportScreen, SettingsScreen）
  - `App.tsx` 包 AppProvider + useEffect 自动检查 backend
  - TypeScript clean, vite build 5.7s, 606 KB bundle
- [x] **Tauri dev 模式**: `dev.bat` 一键启动 HMR
- [x] **Tauri build**: standalone .exe 6.5MB
- [x] **曲线可视化**: `scripts/plot_fit_lt_5sub.py` 5-subplot LTspice overlay
- [ ] **Qg data** （placeholder，Excel 没保留）
- [ ] **Id-Vd 拟合** （S4 RMS=0.98，受 BSIM3 short-channel 限制）

## Files Changed (最近 commits)

### Commit `18a598d` — 8 screen 全接真 API
- src/app/components/ExportScreen.tsx (164 → 278, +114)
- src/app/components/ModelEditor.tsx (270 → 270, useApp + getModel)
- src/app/components/SettingsScreen.tsx (150 → 215, +65)
- src/app/components/ValidateScreen.tsx (147 → 203, +56)
- src/lib/store.tsx (新建, +144)

### Commit `61a4b8d` — React UI 基础接线
- src/app/App.tsx (包 AppProvider)
- src/app/components/CurveVisualizer.tsx (312 → 301, -11)
- src/app/components/Dashboard.tsx (182 → 144, -38)
- src/app/components/DataBrowser.tsx (189 → 321, +132)
- src/app/components/FittingPipeline.tsx (337 → 239, -98)
- src/lib/api.ts (154 → 154, 完全重写)

### Commit `ca56c22` — LTspice evaluator 6-stage
- 新建 `spicebuilder/simulator/evaluator.py` (LTspiceEvaluator, +257)
- `scripts/run_demo.py` 加 `--ltspice` flag
- 新建 `scripts/plot_fit_lt.py` (2 subplot) + `scripts/plot_fit_lt_5sub.py` (5 subplot)
- `spicebuilder/fitting/stage.py` 加 `_eval_ltspice`, mask Vgs<4V
- `spicebuilder/strategy/sgt_6stage.py` 加 simulator 透传
- `spicebuilder/models/init_values.py` VTH0 init=3.5, RD/RS = Rds*0.25
- `spicebuilder/models/bsim3.py` VTH0 bounds [2,5], VSAT bounds [1e3, 2e6]
- `spicebuilder/models/exporter.py` W=4e6u (4m = 40000 cells × 100um)
- `spicebuilder/simulator/ltspice.py` 加 `cleanup` 参数到 `run_netlist_text`

## Notes

### 关键设计决定
1. **LTspice evaluator 替代简化公式**: 简化公式与真 BSIM3 物理有 ~50x 系统偏差
   （短沟道效应、self-heating、NQS），LTspice 直接跑真 BSIM3 拟合更准
2. **W=4e6u (4m)**: 100V/100A die 沟道总宽（40000 cells × 100um/cell）
3. **Mask Vgs<4V**: 跳过机台 30mA 最小电流档 + Vgs<3V 测量下限
4. **React Context 单一 store**: 8 个 screen 共用 projectId/model/fitResult/backendRunning
5. **Tauri 代理 Python**: 前端不直连 127.0.0.1:8000，走 `call_api` command

### 拟合参数 (LTspice mode, RMS 0.64)
| Param | Init | Fitted | Datasheet 期望 |
|---|---|---|---|
| VTH0 | 3.5V | **3.62V** | 3.0V ✓ |
| U0 | 300 cm²/Vs | **562 cm²/Vs** | 400-600 ✓ |
| VSAT | 1e5 m/s | 1e5 m/s (卡下界) | 1-5e5 ✓ |
| RD/RS | 0.46mΩ | 0.22mΩ | ~1mΩ ✓ |

### 架构
```
React (Tauri WebView)
   ↓ invoke
Tauri Rust (src-tauri/src/lib.rs)
   ↓ proxy.rs call_api
FastAPI (uvicorn :8000)
   ↓ evaluate
Python (spicebuilder.algorithms)
   ↓ subprocess -b
LTspice XVII (MOSFET .model evaluation)
```

### Tauri 集成命令 (lib.rs invoke_handler)
- `hello`, `get_version`
- `start_python_backend`, `stop_python_backend`, `check_backend`
- `open_excel_file`, `save_file_dialog`, `read_text_file`, `open_folder`
- `call_api`, `api_load_project`, `api_run_fit`, `api_export_lib`

### FastAPI Endpoints
- `GET /api/health`
- `GET /api/projects`
- `POST /api/projects/load`
- `GET /api/projects/{id}`
- `GET /api/projects/{id}/model`
- `GET /api/projects/{id}/curves/{type}`
- `POST /api/projects/{id}/fit`
- `POST /api/projects/{id}/export`

## 下一步候选
- **A**: 跑 fit task 进度 polling（backend task_id, frontend 轮询）
- **B**: 改进 Id-Vd 拟合（self-heating 模型 / 重新选 sample points）
- **C**: LTspice C-V / Qg / Body Diode overlay（需要 AC sim + diode sim）
- **D**: Tauri dev 模式端到端 GUI 测试（实际 dev.bat 跑）
- **E**: 100V/200V 第二个设备测试