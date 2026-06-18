# Figma 提示词 4：参数编辑器

> 用途：设计 SpiceBuilder 的"BSIM3 参数编辑器"屏幕。
> BSIM3 有 30+ 参数，按 category 分组管理。
> 参考：ADS、AWR Microwave Office、Cadence Virtuoso、Sentaurus Workbench

---

## 提示词（中文版）

设计 SpiceBuilder 工具的"**BSIM3 参数编辑器**"屏幕。SpiceBuilder 是用于 Si SGT Power MOSFET 的 SPICE 模型提取工具。

屏幕显示所有 **~30 个 BSIM3 模型参数**，按 category 分组。

---

### 整体布局：主从结构（Master-Detail）

---

#### 左侧栏（宽度 300px）：参数分类树

**结构**（树形）：

```
▼ 阈值电压 (Threshold Voltage)
    VTH0、K1、K2、K3、DVT0、DVT1、DVT2、NFACTOR、CDSC、CDSCD、CDSCB
▼ 迁移率 (Mobility)
    U0、UA、UA1、UB、UB1、UC、UC1、EU、ETAMOB
▼ 饱和速度 (Saturation Velocity)
    VSAT、A0、AGS、KETA
▼ 沟长调制 (Channel Length Modulation)
    PCLM、PDIBLC1、PDIBLC2、DROUT、PVAG
▼ 输出电阻 (Output Resistance)
    PDITS、PDITSD、DELTA
▼ 亚阈值 (Subthreshold)
    VOFF、VOFFCV、MINVC、NFACTOR
▼ 电容 (Capacitance)
    CGBO、CGDO、CGSO、CGD0、CGS0、CGG、CGD、CGS
▼ 结 (Junction)
    MJ、MJSW、PB、PBSW、TT
▼ 温度 (Temperature)
    KT1、KT2、KT1L、UTE、UA1、UB1、UC1、PRT、PRB
▼ 体二极管 (Body Diode)
    IS、N、ISR、NR、IKF、IKR、BV、IBV、RS
▼ 掺杂 (Doping)
    NSUB、NGATE
▼ 工艺 (Process)
    XL、XW、TOX、TNOM
```

**每项显示**：
- 类别图标
- 类别名
- 参数计数（badge）

**顶部工具**：
- 搜索框（按参数名搜索）
- 过滤器下拉：显示全部 / 仅已拟合 / 仅未拟合 / 仅锁定 / 仅越界

---

#### 右侧主区：参数表

**表格列**（从左到右）：

| 列名 | 说明 | 是否可编辑 |
|---|---|---|
| 参数名 | VTH0、U0 等 | 否 |
| 初始值 | 灰字，加载时固定 | 否（除非重置） |
| 当前值 | 白字，**可编辑** | **是** |
| 拟合值 | 绿色，**拟合成功后显示** | 否 |
| 下界 | bounds lower | **是** |
| 上界 | bounds upper | **是** |
| 单位 | V、A/V²、m/V、F/m 等 | 否 |
| 状态 | 🔒 锁定 / 🎯 已拟合 / ✏️ 手动 | 自动 |
| 阶段 | 该参数在哪个阶段被拟合（S1、S2...） | 否 |
| Delta | |当前 - 初始| | 否 |

**样式**：
- 斑马纹行（奇偶行不同背景色）
- 越界值：红色高亮
- 最近拟合值：绿色闪烁 1 秒
- 锁定参数：灰色 + 锁图标
- 列宽可调

**每行右键菜单**：
- 锁定/解锁
- 重置为初始值
- 在策略中查看
- 显示敏感度
- 单参数扫描

---

#### 顶部工具栏

- **加载初始模型卡**：从 .lib 文件加载
- **保存当前为初始**：把当前值存为初值
- **导出为 .lib**：直接导出 BSIM3 .model
- **导出为 .subckt**：导出 subckt 包装（含寄生 R/L/C）
- **运行敏感度分析**：按类别或全部
- **运行参数扫描**：扫描选中参数
- **优化（跳到拟合 Pipeline）**：用此配置跑拟合
- **重置全部**：所有参数回到初始

---

#### 底部：迷你诊断面板（高度 120px）

**物理一致性检查**（自动显示）：

```
✓ VTH0 = 2.34V 在合理范围 [0.1, 5.0]V
✓ U0 = 580 cm²/V·s 在合理范围 [100, 1500]
✓ Rds(on) 温度系数 = +0.0065/°C（正温度系数，符合 SGT 特性）
⚠ MJSW = 0.62 略高于典型值 [0.1, 0.5]
✗ NFACTOR = 0.05 异常低，正常应 > 0.5
```

**每行**：
- 状态图标：✓ / ⚠ / ✗
- 检查项描述
- 当前值
- 提示（越界时显示）

**整体状态**：
- 顶部汇总：12 项检查，10 ✓ / 1 ⚠ / 1 ✗

---

### 颜色规范

| 元素 | 颜色 | 用途 |
|---|---|---|
| 表头 | `#f5f5f5` | 极浅灰 |
| 行 1（奇数） | `#ffffff` | 白 |
| 行 2（偶数） | `#fafafa` | 微浅灰（斑马纹） |
| 文本 | `#2c2c2c` | 深灰 |
| 越界 | `#fff5f5` 背景 + `#f24822` 文字 | 浅红背景 + 红字 |
| 锁定 | `#9ca3af` 文字 | 中灰 |
| 拟合值 | `#14ae5c` | 绿 |
| 警告 | `#ffcd29` | 金黄 |
| 错误 | `#f24822` | 红 |
| 选中行 | `#e6f4ff` 背景 | 浅蓝 |
| 边框 | `#e5e5e5` | 浅灰 |

---

### 字体

- 参数名：JetBrains Mono（等宽）
- 数值：JetBrains Mono
- 描述：Inter / Segoe UI
- 工具栏：Inter

---

### 关键交互

1. **双击单元格**：进入编辑模式
2. **Tab/Enter 切换到下一格**（支持键盘流）
3. **Ctrl+F 搜索参数**
4. **拖拽列头**调整列宽
5. **点击列头排序**
6. **右键行**显示上下文菜单
7. **Ctrl+S 保存**当前值到工程
8. **Ctrl+Z 撤销**修改
9. **Ctrl+L 锁定/解锁**选中行
10. **F1 显示该参数帮助**（BSIM3 手册）

---

### 关键设计模式

- **分类树 + 表**的经典主从布局
- **In-place editing**（直接改表，不用弹窗）
- **即时校验**（越界立刻红）
- **状态列**一眼看到哪些拟合过、哪些锁定
- **诊断面板**持续显示物理一致性
- **一键导出**为 .lib / .subckt

---

### 总体观感

像 **Cadence Virtuoso 的 Parameter Editor** + **Excel 的密集数据表** 混合体。**信息密度极高，键盘操作友好**。

---

## 给 Figma AI 的英文版本（备选）

```text
Design the "BSIM3 Parameter Editor" screen of SpiceBuilder, a SPICE model 
extraction tool for Si SGT Power MOSFETs.

Shows all ~30 BSIM3 model parameters organized by category.

Master-detail layout:

Left pane (300px): Category Tree
Tree structure with categories:
- Threshold Voltage (VTH0, K1, K2, K3, DVT0-2, NFACTOR, CDSC, CDSCD, CDSCB)
- Mobility (U0, UA, UA1, UB, UB1, UC, UC1, EU, ETAMOB)
- Saturation Velocity (VSAT, A0, AGS, KETA)
- Channel Length Modulation (PCLM, PDIBLC1-2, DROUT, PVAG)
- Output Resistance (PDITS, PDITSD, DELTA)
- Subthreshold (VOFF, VOFFCV, MINVC, NFACTOR)
- Capacitance (CGBO, CGDO, CGSO, CGD0, CGS0, CGG, CGD, CGS)
- Junction (MJ, MJSW, PB, PBSW, TT)
- Temperature (KT1, KT2, KT1L, UTE, UA1-UC1, PRT, PRB)
- Body Diode (IS, N, ISR, NR, IKF, IKR, BV, IBV, RS)
- Doping (NSUB, NGATE)
- Process (XL, XW, TOX, TNOM)

Each category shows parameter count badge.
Top: search box + filter dropdown (all/fitted/unfitted/locked/out-of-bounds)

Right pane: Parameter Table
Columns: Parameter name, Initial value (read-only), Current value (editable),
  Fitted value (green), Lower bound, Upper bound, Unit, 
  Status (locked/fitted/manual icon), Stage (S1-S6), Delta
  
Alternating row colors. Out-of-bounds: red highlight.
Recently fitted: green flash for 1 second.
Locked: gray + lock icon.

Top toolbar: Load Initial .lib, Save Current as Initial, 
  Export as .lib, Export as .subckt, Run Sensitivity, 
  Run Param Sweep, Jump to Fitting, Reset All

Bottom mini-diagnostics (120px):
Physics consistency checks with status icons:
- VTH0 in range [0.1, 5.0]V
- U0 in range [100, 1500] cm²/V·s
- Rds(on) temp coefficient sign (positive for SGT)
- Vth temp coefficient sign
- MJSW in range [0.1, 0.5]
- NFACTOR not too low
- etc.

Theme: modern LIGHT (#ffffff bg, #fafafa surface, #0d99ff accent)
Reference: Cadence Virtuoso Parameter Editor + Excel dense table (light)
Keyboard-friendly: Tab navigation, Ctrl+F, Ctrl+L, Ctrl+S
```

---

## 设计要点（提交设计稿时检查）

- [ ] 左侧分类树是否清晰
- [ ] 表格列是否够全（至少 10 列）
- [ ] 越界值是否一眼可见（红色高亮）
- [ ] 锁定/拟合/手动状态是否图标化
- [ ] 诊断面板是否显眼（底部固定）
- [ ] 顶部工具栏是否覆盖所有必要操作
- [ ] 整体是否有"密集数据表 + 智能校验"的观感
- [ ] 是否支持键盘流（Tab 切换、快捷键）
