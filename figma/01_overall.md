# Figma 提示词 1：整体架构（主框架）

> 用途：在 Figma AI / Galileo AI 中生成 SpiceBuilder 主窗口的整体架构。
> 一次生成 4 个主屏幕，确立风格基调。

---

## 提示词（中文版）

设计一个 Windows 桌面应用 GUI，用于半导体功率器件工程师的 SPICE 模型提取工具。工具名叫 **SpiceBuilder**，用于表征和建模 Si SGT MOSFET（硅屏蔽栅沟槽 MOSFET，<200V），用于电路仿真。

**目标用户**：电力电子工程师，做 SPICE 模型拟合

**风格**：现代专业风格，**亮色主题**，参考 Figma + Linear + Vercel + Apple Design Resources 风格

**布局**：单窗口 + 侧边栏导航 + 多 Tab 主内容区

**信息密度**：信息密集，工程导向，不是消费类 App 风格

---

### 必需的侧边栏导航（8 个主功能区）

1. **仪表板 (Dashboard)** - 工程总览、状态、最近活动
2. **数据 (Data)** - 加载、清洗、浏览原始测量数据
3. **曲线 (Curve)** - 可视化测量曲线（Id-Vg、Id-Vd、Ciss/Coss/Crss、Qg、If-Vf）
4. **模型 (Model)** - 编辑 SPICE 模型参数（BSIM3）
5. **拟合 (Fitting)** - 跑 6 阶段参数提取 Pipeline
6. **验证 (Validate)** - 用未参与拟合的数据交叉验证（Qg vs C-V 积分、开关瞬态）
7. **导出 (Export)** - 导出 .lib 和 .subckt 模型文件
8. **设置 (Settings)** - 优化器配置、LTspice 路径、主题

---

### 生成 4 个主屏幕

1. **主仪表板（Dashboard）** - 项目状态、最近曲线、待办拟合
2. **数据浏览器与清洗器** - 树形数据 + 表格 + 清洗操作
3. **曲线可视化器** - 目标 vs 拟合对比图（最重要的屏幕）
4. **拟合 Pipeline 运行器** - 6 阶段流程卡 + 诊断仪表板

---

### 每个屏幕必须包含的元素

- **顶部工具栏**：新建工程、打开、保存、运行、导出（全局动作）
- **左侧侧边栏**：8 个导航项 + 图标
- **主内容区**：多面板布局
- **底部状态栏**：进度、日志、关键指标
- **浮动面板**：可停靠的子窗口

---

### 颜色方案（**必须使用，亮色主题**）

- 背景主色：`#ffffff`（纯白）
- 表面色：`#fafafa`（卡片，极浅灰）
- 主强调色：`#0d99ff`（鲜蓝）
- 成功色：`#14ae5c`（绿）
- 警告色：`#ffcd29`（金黄）
- 错误色：`#f24822`（红橙）
- 文本色：`#2c2c2c`（深灰）
- 次要文本：`#6b7280`（中灰）
- 边框色：`#e5e5e5`（浅灰）
- 悬停色：`#f5f5f5`
- 选中色：`#e6f4ff`（浅蓝）
- 卡片阴影：`rgba(0,0,0,0.05) 0 2px 4px`（轻投影）

**参考风格**：Figma / Linear / Vercel / Apple Design Resources

---

### 字体

- UI 字体：Inter 或 Segoe UI
- 代码/参数字体：JetBrains Mono 或 Consolas

---

### 关键的工程师专用 UI 模式

- **参数表格**：列包括 值、Bounds、锁定状态、拟合状态
- **多曲线图**：支持 log/linear 切换
- **阶段 Pipeline 视图**：6 个状态卡片顺序排列
- **每阶段 RMS 显示**：作为进度指示器
- **目标 vs 拟合叠图**：并排显示
- **Metadata 检查器**：显示 bias、temperature、instance 参数

---

### 总体要求

让它看起来像 **严肃的专业工程工具**，不是消费类 App。不要花哨的插图、动画、阴影。**信息密度要高，视觉要冷静**。

---

## 给 Figma AI 的英文版本（备选）

如果中文版效果不好，用这个英文版：

```text
Design a professional Windows desktop application GUI for a SPICE Model 
Extraction tool used by semiconductor power device engineers to characterize 
and model Si SGT MOSFETs (Silicon Shielded Gate Trench MOSFETs, <200V) for 
circuit simulation.

App name: SpiceBuilder
Platform: Windows desktop (PyQt5)
Target user: Power electronics engineer doing SPICE model fitting
Style: Modern professional, light theme, similar to Figma + Linear + 
Vercel + Apple Design Resources
Layout: Single window with sidebar navigation + main content area, 
multi-tab interface
Density: Information-rich, engineer-focused, not consumer-style

Sidebar navigation (8 items):
1. Dashboard - Project overview, status, recent activity
2. Data - Load, clean, browse raw measurement data
3. Curve - Visualize measurement curves (Id-Vg, Id-Vd, Ciss/Coss/Crss, Qg, If-Vf)
4. Model - Edit SPICE model parameters (BSIM3)
5. Fitting - Run 6-stage parameter extraction pipeline
6. Validate - Cross-validate model against un-used data
7. Export - Export .lib and .subckt model files
8. Settings - Optimizer config, LTspice path, theme

Generate 4 main screens:
- Main Dashboard
- Data Browser & Cleaner
- Curve Visualizer (target vs fit comparison)
- Fitting Pipeline Runner with diagnostics dashboard

Color palette (use exactly, light theme):
- Background: #ffffff
- Surface: #fafafa
- Primary accent: #0d99ff
- Success: #14ae5c
- Warning: #ffcd29
- Error: #f24822
- Text: #2c2c2c
- Secondary text: #6b7280
- Border: #e5e5e5
- Hover: #f5f5f5
- Selected: #e6f4ff

Reference style: Figma + Linear + Vercel (modern light theme)

Typography:
- UI: Inter or Segoe UI
- Code: JetBrains Mono or Consolas

Make it look like a serious professional engineering tool, not a consumer app.
```

---

## 后续步骤

生成主框架后，依次使用：
- `02_curve_viz.md` 细化曲线可视化器（每天看 1000 次的屏幕）
- `03_fitting.md` 细化拟合 Pipeline（产品灵魂）
- `04_param_editor.md` 细化参数编辑器（信息密度最高）
