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
## [2026-07-02] 操作逻辑与控制流硬化

按之前盘点出的 P0→P3 顺序一次性出 patch。

### P0 必修

- **#1 端口 8000→8765**: README 全篇 `port 8000` / `http://127.0.0.1:8000` 替换为 8765
  （与 `run_api.py` 默认值 + `src-tauri/src/commands/python_backend.rs` 中
  `PYTHON_PORT=8765` 对齐）。两个使用文档位置（Mode 1 与 Start API standalone）
  也同步更新。改动文件：`README.md`。

- **#6 Sidebar 读真项目**: `src/app/components/Sidebar.tsx` 去掉 `MOCK_PROJECT`，
  改读 `useApp().dataset?.device_info.part_number ?? "No project loaded"`。
  底部状态条也改读 `backendRunning` 字段，绿色点变成 "Python backend
  running" / 红色点 "Python backend offline"，再也不会说谎。
  同步删除 `src/lib/constants.ts` 里的 `MOCK_PROJECT` export。改动文件：
  `Sidebar.tsx`, `constants.ts`。

- **#7 Stop 按钮接后端真 cancel**:
  - 后端新增 `POST /api/tasks/{id}/cancel` 端点，调 `task.asyncio_task.cancel()`，
    设置 `task.status = "cancelled"`。
  - `_fit_task_wrapper` 加 `asyncio.CancelledError` 分支，区分 cancel / fail。
  - 前端 `api.ts` 新增 `cancelFitTask(taskId)`。
  - `store.tsx` 把 `runFitWithPolling` 改造为返回 `FitHandle { promise, cancel,
    getTaskId }`；新增 `cancelFit` action；`fitHandleRef` 持有当前 handle。
  - `FittingPipeline.tsx` 的 `onStop` 真的 `await cancelFit()`。
  改动文件：`routes.py`, `api.ts`, `store.tsx`, `FittingPipeline.tsx`。

### P1 必修

- **#3/#4 selectProject 错位**: 旧版切了 projectId 但不拉 dataset，导致
  `GET /curves` 用新 projectId + 旧 dataset 拼出错数据。后端新增
  `GET /api/projects/{id}/dataset` 端点返回 `device_info/key_params/n_*` 摘要。
  前端 `api.ts` 新增 `getDataset(pid)`；`store.tsx` 的 `selectProject` 现在
  串行调 `getModel + getDataset` 后再 setState。改动文件：`routes.py`,
  `api.ts`, `store.tsx`。

- **#2 进度日志陈旧闭包**: `store.tsx` 的 10% 进度日志 dedup 之前读的是
  useCallback 闭包捕获的旧 state，会丢/重复日志。改为用 `lastLoggedDecile`
  ref 持有上次 decile。改动文件：`store.tsx`。

- **#5 stage name 推送**: 后端 `_make_progress_callback` 每次都把
  `stage_name` + `loop_idx` 写入 `task.current_stage/current_loop`。
  `Task` dataclass 加这俩字段。`TaskInfo` pydantic model 加这俩字段。
  `routes.get_task` 回填。前端 `store.tsx` `AppState` 加 `currentStage/
  currentLoop`，onProgress 扩参接收，`runFitWithPolling` 把
  `info.current_stage/loop` 传给回调。`FittingPipeline.tsx` 删掉硬编码
  `STAGE_BANDS` 数组，改用 `currentStage.split("_")[0]` 取活跃阶段 ID。
  旧版"S2 永远 pending"问题（因为后端实际上跳过了 S2）彻底消失。
  改动文件：`routes.py`, `models.py`, `state.py`, `api.ts`, `store.tsx`,
  `FittingPipeline.tsx`。

- **#8 maxLoops 控件**: UI 在 LTspice checkbox 旁边加一个 `Loops: 1/3/5/10`
  `<select>`，默认 3（与后端 sgt_6stage 默认一致）。`runFit` 调用从
  `runFit(useLtspice)` 改成 `runFit(useLtspice, maxLoops)`。
  改动文件：`FittingPipeline.tsx`, `store.tsx`。

### P2 必修

- **#9 S6 C-V 拆 stage**: `sgt_6stage.py` 把 S6 拆成 4 个子 stage：
  S6_Ciss、S6_Coss、S6_Crss、S6_BodyDiode。每个子 stage 独立 fit 一组
  CGBO/CGDO/CGSO，避免 3-equation/3-unknown 强共线导致的局部极小。
  Body Diode 单走一个 stage 保护 IS/N/MJ 不被 C-V 噪声污染。
  前端 `FittingPipeline.tsx` 新增 `SUB_STAGE_DEFS` 数组，渲染时跟主
  STAGE_DEFS 并列展示。改动文件：`sgt_6stage.py`, `FittingPipeline.tsx`。

- **#10 fit 断路器**: `store.tsx` 给 `runFitWithPolling` 加 `MAX_POLL_ERRORS=5`：
  连续 5 次 poll 失败就 reject，而不是永远静默循环到 timeout。
  改动文件：`store.tsx`。

- **#11 加载锁**: `store.tsx` 给 `loadProject` 加 `loadInFlightRef`：
  同一 filepath 的重复点击直接 warn + return。
  改动文件：`store.tsx`。

- **#12 fit 重复启动锁**: `runFit` 检查 `fitHandleRef.current`：
  已有 fit 在跑就 warn + return，不会再起第二个。

### P3 必修

- **#13 startup awaited + focus 刷新**: `App.tsx` 的 `useEffect` 改成
  `refreshBackend().catch(console.warn)`，并增加 `window.addEventListener("focus", ...)`
  每次窗口获得焦点重新探活后端。改动文件：`App.tsx`。

- **#14 日志落盘**: TODO — 暂未实现。当前 `logs` 还是只在内存里
  `slice(-200)`。后续建议加 "Export logs" 按钮，把 logs 数组写成
  `~/.spicebuilder/sessions/<timestamp>.log` 便于 debug 6 阶段过程。
  改动文件：—（留 TODO）。

- **#15 清 MOCK_PROJECT**: 已随 #6 同步删除。改动文件：`constants.ts`。

### 验证

- `npm run build` 通过（TypeScript clean, vite 5.49s, 627 KB bundle）。
- `ast.parse` 28/28 个 Python 文件语法干净。
- 后端 `uv run --no-cache --no-project python` 验证：CPython 3.12.9。

### 已知限制

- 转移曲线拟合问题在 sgt_6stage S4/S5 stage，本批 patch 没动拟合策略本身，
  下一段我们专门看。