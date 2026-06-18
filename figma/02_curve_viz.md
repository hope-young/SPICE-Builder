# Figma 提示词 2：曲线可视化器

> 用途：细化 SpiceBuilder 中"曲线可视化器"屏幕的 GUI 设计。
> 这是工程师**每天看 1000 次**的屏幕，必须最舒服。
> 参考：OriginPro、Veusz、Sentaurus Visual

---

## 提示词（中文版）

设计 SpiceBuilder 工具的"**曲线可视化器**"屏幕。SpiceBuilder 是用于 Si SGT Power MOSFET 的 SPICE 模型提取桌面应用。

**整体布局**：3 栏横向分割

---

### 左侧栏（宽度 250px）：曲线树

**结构**：
- 层次化列表，显示已加载的测量数据
- **按曲线类型分组**：
  - Id-Vg（转移特性）
  - Id-Vd（输出特性）
  - Ciss-Vds（输入电容）
  - Coss-Vds（输出电容）
  - Crss-Vds（反向转移电容）
  - Qg-Vgs（栅电荷）
  - If-Vf（体二极管）
- 每个分组可展开，显示单次扫描（不同 Vd、Vg、温度）
- 每条曲线有 checkbox 控制显示/隐藏
- 每条曲线前有颜色色块

**交互**：
- 右键菜单：过滤、对比、设为目标曲线
- 双击：在主图区显示
- 拖拽：重新排序

---

### 中间栏（占 60% 宽度）：主绘图区

**绘图区本身**：
- 大尺寸 matplotlib 风格图区
- 支持显示多条曲线叠加
- 网格线（默认开）
- 鼠标悬停显示坐标（十字光标）

**顶部工具栏**：
- X 轴 log/linear 切换
- Y 轴 log/linear 切换
- 缩放工具（放大、缩小、平移、重置）
- 添加注释按钮
- 添加测量光标（测量两点间 Δx、Δy）
- 导出按钮：PNG、SVG、CSV、PDF
- 多子图布局：1×1、1×2、2×2、2×3

**右侧弹出菜单**（右键图区）：
- 设置坐标范围
- 标记样式（圆点、方块、十字、线）
- 网格线开关
- 图例位置（左/右/上/下/隐藏）
- 字体大小

**底部**：
- 图例：曲线名称、目标 vs 拟合颜色区分
- 左上角：当前光标坐标

**关键**：
- 目标数据用实线 + 圆点
- 拟合数据用虚线 + 不同颜色
- 两条线在同一坐标系叠加显示

---

### 右侧栏（宽度 350px）：检查器面板

**顶部 Tab 切换**：
- **Metadata**（元数据）
- **Statistics**（统计）
- **FoM**（品质因数）

**Metadata Tab 内容**：
- 曲线类型（自动检测）
- 偏置条件：Vd、Vg、Vs、Vb
- 温度（°C）
- 实例参数：L、W、Nfin 等
- 源文件路径
- 数据点数量
- 测试日期

**Statistics Tab 内容**：
- 最小值、最大值、均值、标准差
- 数据范围
- 对数坐标统计
- 一阶导数（dY/dX）

**FoM Tab 内容**（根据曲线类型变化）：
- **Id-Vg**：Vth、Ion、Ioff、SS（亚阈值斜率）、Gm_max
- **Id-Vd**：Rds(on)、Vsat、各 Vg 下的 Ron
- **C-V**：指定 Vds 下的 Ciss、Coss、Crss
- **Qg**：总 Qg、米勒电荷 Qgd、Qgs
- **If-Vf**：Vf@If、整流特性

**底部**：FoM 计算方法下拉选择（如 Vth 用恒定电流法还是外推法）

---

### 整个屏幕的顶部工具栏

- **文件操作**：加载 CSV、加载文件夹、保存清洗后数据
- **对比**：对比模型、对比两条曲线
- **叠加**：目标 + 拟合叠加
- **导出**：PNG、SVG、CSV、PDF
- **快捷按钮**：当前曲线一键重命名、删除、复制

---

### 整个屏幕的底部状态栏

- 当前选中的曲线名、类型
- 数据点数
- 当前 X-Y 范围
- 光标坐标（实时）

---

### 风格规范（**亮色主题**）

- **主题**：现代亮色（`#ffffff` 背景，`#fafafa` 表面）
- **强调色**：蓝色 `#0d99ff`
- **绘图区**：白色背景（`#ffffff`），网格线用 `#e5e5e5`
- **目标线**：绿色实线 `#14ae5c`
- **拟合线**：蓝色虚线 `#0d99ff`
- **图例文本**：深灰 `#2c2c2c`
- **数据点**：实心圆点，大小 4px
- **字体**：UI 用 Inter，坐标轴标签用 JetBrains Mono
- **卡片阴影**：`rgba(0,0,0,0.05) 0 2px 4px` 轻投影

---

### 关键工程模式

- **多曲线叠图**：可同时显示 10+ 条曲线（不同 Vd/Vg/Temp）
- **目标 vs 拟合对比**：用颜色 + 实线/虚线双重区分
- **可拖拽游标**：测量 Δx、Δy
- **快速 FoM 计算**：选曲线 → 自动显示 Vth、Ion、Rds(on)
- **坐标轴自适应**：自动 log 坐标（电流跨度大）
- **无动画/过渡**：快速响应

---

### 总体观感

像 OriginPro 或 Sentaurus Visual 那种**纯工程师工具**风格。**不要**花哨的过渡、阴影、插图。每个像素都要传递信息。

---

## 给 Figma AI 的英文版本（备选）

```text
Design the "Curve Visualizer" screen of SpiceBuilder, a SPICE model 
extraction desktop app for Si SGT Power MOSFETs.

3-pane horizontal split layout:

Left pane (250px): Curve Tree
- Hierarchical list grouped by curve type
- Types: Id-Vg, Id-Vd, Ciss-Vds, Coss-Vds, Crss-Vds, Qg-Vgs, If-Vf
- Expandable to show individual sweeps
- Checkbox per curve for show/hide
- Color swatch per curve
- Right-click: Filter, Compare, Set as Target

Center pane (60%): Main Plot Area
- Large matplotlib-style plot (light theme, white background)
- Top toolbar: log/linear axis toggle, zoom, pan, reset, 
  add annotation, measurement cursor, export PNG/SVG
- Multi-subplot layouts: 1x1, 1x2, 2x2
- Right-click menu for axis, markers, gridlines, legend position
- Crosshair cursor showing X-Y values
- Solid line for target data, dashed line for fit data
- Bottom legend with curve names

Right pane (350px): Inspector
- 3 tabs: Metadata | Statistics | FoM
- Metadata: bias (Vd/Vg/Vs/Vb), temperature, instance parameters, 
  source file, point count, date
- Statistics: min/max/mean/std, range, log stats, derivative
- FoM (per curve type):
  * Id-Vg: Vth, Ion, Ioff, SS, Gm_max
  * Id-Vd: Rds(on), Vsat, Ron vs Vg
  * C-V: Ciss/Coss/Crss at Vds
  * Qg: total, Qgd, Qgs
  * If-Vf: Vf@If

Top toolbar: Load CSV/Folder, Save Cleaned, Compare to Model, 
  Compare Two, Target+Fit Overlay, Export PNG/SVG/CSV/PDF
Bottom status: curve name, point count, X-Y range, cursor coords

Theme: modern LIGHT (#ffffff bg, #fafafa surface, #0d99ff accent)
Reference style: OriginPro + Veusz + Sentaurus Visual (light theme)
High information density, no animations, professional engineer tool
```

---

## 设计要点（提交设计稿时检查）

- [ ] 左侧树是否清晰分组
- [ ] 中间图区是否够大（最少 60% 屏幕宽度）
- [ ] 右侧检查器是否 Tab 切换流畅
- [ ] log/linear 切换是否方便
- [ ] 目标 vs 拟合是否一眼可区分
- [ ] FoM 是否自动计算并显示
- [ ] 整体是否有"工程师工具"的冷静感（不是消费 App）
