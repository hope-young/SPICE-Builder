# Figma 提示词 3：拟合 Pipeline 运行器

> 用途：设计 SpiceBuilder 的"拟合 Pipeline 运行器"屏幕。
> 这是产品的**灵魂屏幕**，6 阶段 Pipeline 是核心差异化。
> 参考：MLflow、TensorBoard、Sentaurus Workbench、Jenkins Pipeline

---

## 提示词（中文版）

设计 SpiceBuilder 工具的"**拟合 Pipeline 运行器**"屏幕。SpiceBuilder 是用于 Si SGT Power MOSFET 的 SPICE 模型提取工具。

**6 阶段 Pipeline** 提取 BSIM3 模型参数：
- **S1**: DC Transfer（Id-Vg）→ 拟合 VTH0、U0、K1、K2、NFACTOR、DVT*
- **S2**: DC Output（Id-Vd）→ 拟合 VSAT、A0、AGS、KETA、PCLM、RD、RS
- **S3**: C-V（Ciss/Coss/Crss）→ 拟合 CGBO、CGDO、CGSO、MJSW、PBSW
- **S4**: Qg 验证 → 通过 C-V 积分验证 S3
- **S5**: 温度 → 拟合 KT1、KT2、UTE、UA1
- **S6**: 体二极管 → 拟合 IS、N、RS

---

### 整体布局：自上而下

---

#### 顶部控制栏（高度 60px）：全局控制

**元素（从左到右）**：
- 工程名（可编辑）
- 策略文件路径（可点击打开编辑器）
- **大按钮**：
  - 启动（Start，绿色 `#14ae5c`）
  - 暂停（Pause，金黄 `#ffcd29`）
  - 重置（Reset，红色 `#f24822`）
- 运行模式选择：普通 / 试运行 / 仅验证
- 当前迭代计数器：`Loop 2/3`
- 整体进度条（百分比）

**风格**：按钮要大，**一眼能点**。

---

#### 中部：6 阶段 Pipeline 视图（横向流动）

**6 个连接卡片**横向排列，每个代表一个阶段。

**每个卡片包含**：
- 阶段编号（S1、S2...S3...），大字体
- 阶段名称（"DC Transfer"、"DC Output"等）
- 拟合的参数（小字，逗号分隔，最多显示 4 个 + "..."）
- **RMS 误差**（大字体，色彩编码）：
  - 绿色 `#14ae5c`：< 2%（优秀）
  - 金黄 `#ffcd29`：< 5%（可接受）
  - 红色 `#f24822`：> 5%（不合格）
- 状态图标：
  - ⏳ 待运行
  - ▶️ 运行中（动画指示）
  - ✅ 成功
  - ❌ 失败
- 迷你 sparkline 图：显示 RMS 随迭代的变化趋势

**卡片之间**：
- 用箭头连接
- 当前运行阶段箭头高亮（蓝色 + 流动动画）
- 失败阶段的箭头变红

**交互**：
- 单击卡片：展开下方详情
- 右键菜单：查看日志、编辑参数、重跑该阶段

---

#### 下部：左右分割

**左半部分（占 60%）**：实时图

- 拟合过程中**自动更新**
- 显示当前最佳拟合 vs 目标数据
- **根据选中的阶段自动切换曲线类型**（S1 显示 Id-Vg、S2 显示 Id-Vd、S3 显示 C-V）
- 暂停按钮（独立于全局）：冻结当前图便于查看

**右半部分（占 40%）**：诊断面板

**顶部 Tab 切换**：
- **阶段日志 (Stage Log)**
- **优化器 (Optimization)**
- **物理一致性 (Consistency)**

---

**Tab 1: 阶段日志**

实时文本日志，显示：
- 当前阶段名
- 迭代计数器
- 当前 RMS vs 最佳 RMS
- 正在尝试的参数值
- 最后 100 行 SPICE 输出

**风格**：等宽字体（JetBrains Mono），可滚动、自动滚到底部、可暂停滚动。

---

**Tab 2: 优化器**

参数调节面板：
- **算法下拉**：TRF、LM、Dogbox、BFGS、L-BFGS-B、Differential Evolution、Bayesian
- **eps1 slider**（ftol）：1e-6 到 1e-1，默认 1e-3
- **eps2 slider**（xtol）：同上
- **eps3 slider**（gtol）：同上
- **最大迭代数**：100 - 10000
- **并行任务数**：1 - 32
- **Jacobian 方法**：中心差分 / 前向差分
- **信赖域初始半径**：0.1 - 10
- 每个控件有**重置默认值**按钮

---

**Tab 3: 物理一致性**

**自动检查项**（每项显示 PASS / WARN / FAIL + 解释）：

1. **Qg 计算值 vs Qg 测量值**（误差 %）
   - PASS：< 5%
   - WARN：5-15%
   - FAIL：> 15%
   - 解释：基于 C-V 积分计算的 Qg 应接近测量 Qg

2. **Eoss 计算值 vs Eoss 测量值**（误差 %）
   - 同上

3. **Rds(on) 温度系数符号**
   - PASS：正温度系数
   - FAIL：负温度系数（异常）
   - 解释：Si SGT MOSFET 应有正温度系数（自均流特性）

4. **Vth 温度系数符号**
   - PASS：负温度系数（典型）
   - FAIL：正温度系数（异常）

5. **物理参数范围**
   - 检查 VTH0 ∈ [0.1, 5] V
   - 检查 U0 ∈ [100, 1500] cm²/V·s
   - 检查 MJSW ∈ [0.1, 0.5]
   - 越界标红

6. **Coss 非线性突变位置 vs Crss 米勒平台位置**
   - PASS：两个位置一致
   - FAIL：位置不一致

---

#### 底部状态栏

- 当前动作描述
- SPICE 引擎状态（LTspice 路径、版本）
- CPU / RAM 使用
- 每阶段耗时
- 整体预计剩余时间

---

### 颜色规范

| 元素 | 颜色 | 含义 |
|---|---|---|
| 成功 | `#14ae5c` | 通过、收敛（绿） |
| 警告 | `#ffcd29` | 边界、超出（金黄） |
| 错误 | `#f24822` | 失败、超限（红橙） |
| 激活 | `#0d99ff` | 正在运行（鲜蓝） |
| 文本 | `#2c2c2c` | 主文本（深灰） |
| 背景 | `#ffffff` | 主背景（白） |
| 表面 | `#fafafa` | 卡片背景（极浅灰） |
| 边框 | `#e5e5e5` | 分隔（浅灰） |
| 悬停 | `#f5f5f5` | 鼠标悬停 |
| 选中 | `#e6f4ff` | 选中行（浅蓝） |
| 阴影 | `rgba(0,0,0,0.05) 0 2px 4px` | 卡片轻投影 |

---

### 关键交互

1. **6 阶段 Pipeline 横向滚动**（如果屏幕窄）
2. **当前阶段高亮 + 动画**（视觉反馈）
3. **每个阶段独立可点击**（可单独重跑）
4. **实时误差曲线**（spkline 显示趋势）
5. **物理一致性自动检查**（不通过不让导出）
6. **优化器参数可调**（不重启动态生效）
7. **暂停/继续**（不丢失当前状态）

---

### 总体观感

像 **MLflow + Jenkins Pipeline + Sentaurus Workbench** 的混合体。**信息密度高、状态可见、反馈即时**。

---

## 给 Figma AI 的英文版本（备选）

```text
Design the "Fitting Pipeline Runner" screen of SpiceBuilder, a SPICE model 
extraction tool for Si SGT Power MOSFETs.

The 6-stage pipeline extracts BSIM3 model parameters:
- S1: DC Transfer (Id-Vg) → VTH0, U0, K1, K2, NFACTOR
- S2: DC Output (Id-Vd) → VSAT, A0, AGS, KETA, PCLM, RD, RS
- S3: C-V (Ciss/Coss/Crss) → CGBO, CGDO, CGSO, MJSW, PBSW
- S4: Qg Verification → validates S3
- S5: Temperature → KT1, KT2, UTE, UA1
- S6: Body Diode → IS, N, RS

Layout: top-down

Top control bar (60px):
- Project name (editable)
- Strategy file path (clickable to open editor)
- Large buttons: Start (green) / Pause (yellow) / Reset (red)
- Run mode: Normal / Dry-run / Validate-only
- Current iteration counter: "Loop 2/3"
- Overall progress percentage

Middle: 6-stage pipeline (horizontal flow)
- 6 connected cards
- Each card: stage number, name, fitted parameters, 
  RMS error (color-coded green<2% / yellow<5% / red>5%),
  status icon (pending/running/success/failed), 
  mini sparkline of RMS history
- Arrows between cards (animated when flowing)
- Click card to expand details, right-click for menu

Bottom: split horizontally
Left (60%): Live plot - auto-updates with current best fit vs target
Right (40%): Diagnostics panel with 3 tabs:
  Tab 1 "Stage Log": real-time iteration log, RMS, parameter values
  Tab 2 "Optimization": algorithm dropdown, eps1/eps2/eps3 sliders,
    max iterations, parallel jobs, jacobian method
  Tab 3 "Consistency": auto-checks:
    - Qg computed vs measured (delta %)
    - Eoss computed vs measured
    - Rds(on) temp coefficient sign
    - Vth temp coefficient sign
    - Physical parameter ranges
    - Coss nonlinearity vs Crss Miller plateau position
    Each check: PASS/WARN/FAIL with explanation

Bottom status bar: current action, SPICE engine, CPU/RAM, timing

Color: modern LIGHT theme, #ffffff bg, #0d99ff accent, 
  success #14ae5c, warning #ffcd29, error #f24822,
  surface #fafafa, border #e5e5e5, hover #f5f5f5, selected #e6f4ff

Reference style: MLflow + TensorBoard + Sentaurus Workbench
High info density, no animations except pipeline arrows
```

---

## 设计要点（提交设计稿时检查）

- [ ] 6 阶段 Pipeline 横向流动是否清晰
- [ ] 状态色彩编码是否一眼可辨（绿/黄/红）
- [ ] 实时图是否够大（最少 60% 屏幕宽度）
- [ ] 优化器参数是否全部可调
- [ ] 物理一致性检查是否显眼
- [ ] 启动/暂停/重置按钮是否够大
- [ ] 整体是否有"实验运行控制台"的感觉
