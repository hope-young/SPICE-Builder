# SpiceBuilder 开发日志

## [Unreleased] — 2026-07-02

### 重大修复

**Id-Vg 5-6V 区间拟合失败（核心 bug）**

经过三步排查与修复：

1. **删除所有简化评估器（mock）
** — `spicebuilder/fitting/stage.py`
   - Stage 构造函数强制要求传 `simulator`（LTspiceEvaluator），传 None 直接抛 ValueError
   - 完全删除 `_eval_simple`、`_eval_idvg_simple`、`_eval_idvd_simple`、`_eval_cv_simple`、`_eval_diode_simple`
   - `_residual` 中如果 LTspice 评估失败，直接抛 RuntimeError，不允许 fallback

2. **放宽 BSIM3 边界**
   - `UA` 上界 `1e-7` → `1e-6`（迁移率一阶退化系数）
   - `UB` 上界 `1e-16` → `1e-15`（迁移率二阶退化系数）
   - 这两个参数对 5V 以上高电流段曲线趋势起关键作用

3. **修复 LTspice subckt 中 M 倍乘不生效的问题** — **`spicebuilder/simulator/evaluator.py`** & **`ltspice.py`**
   - **问题**：LTspice 的 BSIM3v3 在 SUBCKT 内部的 `M=` 倍乘因子会被忽略（已知问题）
   - **解决**：把 `M=` 移到外层 `X1 ... SDH10N2P1 M=N` 的 instance 上
   - 新增 `cell_count`（并联 cell 数）和 `cell_w_m`（单 cell 宽度）参数到 `LTspiceEvaluator`
   - 通过 netlist 的 `X1 ... M={cell_count}` 显式倍乘

**关键验证（Vds=0.5V Id-Vg，cell_count=100, cell_w_m=0.2）**

| Vgs | 实测 | LTspice 仿真 | 比例 |
|-----|------|-------------|------|
| 5.0V | 115.3A | 132.9A | 1.15 |
| 5.5V | ~177A | ~158A | 0.89 |
| 6.0V | 210.7A | 172.2A | 0.82 |

5-6V 区间拟合结果：

| 优化参数 | 初始值 | 拟合后 |
|----------|--------|--------|
| VTH0 | 3.5 | 4.847 |
| U0 | 450 | 92.05 |
| TOX | 5e-8 | 3.72e-7 |

- **RMS = 0.0109，R² = 0.9794**（对数域）

---

### 新增功能

**单曲线 IdVg 拟合工作流（SingleCurveFit）** — Figma 重规划后的首个 GUI

- `docs/CSV_FORMAT.md`：曲线数据 CSV 格式规范（IdVg / IdVd / CV / Qg / BodyDiode）
- `scripts/clean_and_export_csv.py`：把 SDH Excel 按曲线类型清洗为独立 CSV 文件
- `spicebuilder/data/loader_csv.py`：从 CSV 加载 SimData（5 个 loader）
- `spicebuilder/data/simdata.py` 新增 `filter_range(vmin, vmax)` 方法
- `spicebuilder/fitting/stage.py`：mask 支持通用 `vmin`/`vmax` 元数据
- 后端端点：
  - `POST /api/projects/{id}/load_csv` — CSV → SimData
  - `POST /api/projects/{id}/fit_single` — 用户选定区间内的单曲线拟合（带 vmin/vmax metadata）
- 前端组件：
  - `ParamSliders.tsx` — 参数滑块通用组件（复选框 + 滑块 + 防抖 300ms）
  - `SingleCurveFit.tsx` — 三栏布局（CSV 加载 + 区间选择 + 参数 + recharts 双图）
- 导航：`Single Fit` 项（图标 `Activity`）

**多 cell 并联支持** — `spicebuilder/simulator/evaluator.py` & `exporter.py`

- `LTspiceEvaluator.__init__(..., cell_count=100, cell_w_m=0.2)`
- `LibExporter.export_subckt(..., cell_count, cell_w_m)`
- subckt 内 `M1 ... L=1u W={cell_w_m} M=1`（cell_count=1 让内部不倍乘）
- 外层 netlist `X1 ... M={cell_count}`（保证倍乘生效）

---

### Bug Fixes

**端口配置统一（避免改一处忘一处）** — 修复 `proxy.rs` / `run_api.py` / `python_backend.rs` 端口不一致导致后端 404 的问题
- 全部统一为 `8765`
- 改 LTspice 单元宽单位为裸数字 `0.2`（去掉 `m` 后缀，LTspice 默认识别米）

**Python / Rust 死锁修复** — `src-tauri/src/commands/python_backend.rs`
- 在 `await` 前取走 `MutexGuard`，避免 `child_lock` 跨 await 点持有导致 `!Send` 编译错误

**Tauri 参数命名修正** — `src/lib/api.ts`
- Tauri Rust proxy 要求 `body: Option<String>`，前端必须用 `JSON.stringify({...})` 传字符串，不能传对象
- 修复 `load_csv`、`fit_single`、`simulate`、`startFitting` 4 个 API 调用

**DataBrowser 白屏修复** — `src/app/components/DataBrowser.tsx`
- API 返回 `project_id` 可能为 undefined，加 `?.slice(0, 8)` 容错
- 重写整个 DataBrowser.tsx 避免复杂三元运算符嵌套导致的语法错误

**Stage 强制传 simulator** — `spicebuilder/fitting/stage.py`
- 之前 Stage(None) 会用 mock 评估，导致 5-6V 拟合根本是错的
- 现在初始化抛 ValueError

**S2 stage 仍禁用** — 数据中 Vgs<2.5V 所有点都是 23-36 mA 仪器噪声，不是真实亚阈值电流

---

### 工程基础设施

- Tauri Rust 编译错误修复：MutexGuard 跨 await Send 错误
- 端口从 8000 → 8765（避免和其他工具冲突）
- 创建 `docs/` 和 `scripts/` 文档组织
- 端口管理基本规则：**改 Rust 端 (proxy.rs、python_backend.rs) 时一定要同步改 Python 端 (run_api.py)**
