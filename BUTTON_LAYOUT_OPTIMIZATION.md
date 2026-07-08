# 操作按钮布局优化

**日期**: 2026-07-08  
**改动**: 将操作按钮从顶部菜单栏移至 Fit Project 面板底部

---

## 问题背景

原先的设计将 `Load CSV`、`Simulate`、`Fit`、`Stop` 四个操作按钮放在顶部菜单栏中，与 `File`、`Edit`、`View` 等导航菜单项混在一起。

**存在的问题**:
1. **语义混淆**: 菜单栏应该只放导航和文件操作，而这些是工作流操作按钮
2. **空间占用**: 占用宝贵的顶部空间
3. **操作流程不连贯**: 用户在 Fit Project 面板勾选后，需要将视线移到顶部点击操作

---

## 解决方案：方案1（采用）

### 布局位置
将四个操作按钮移至 **Fit Project 面板底部**，采用 **2×2 网格布局**

```
┌─ Fit Project ─────────┐
│ ☑ IdVg / Transfer     │
│   ☑ IdVg @ Vds=0.5V   │
│   ☑ IdVg @ Vds=5V     │
│ ☑ IdVd / Output       │
│   ☑ IdVd @ Vgs=10V    │
├───────────────────────┤
│ Selected: IdVg@Vds=5V │
│ Type:   IdVg          │
│ Bias:   Vds=5V        │
│ Range:  Vgs 0–10V     │
│ CSV:    IdVg.csv      │
│ Weight: 1.0           │
│ Status: queued        │
├───────────────────────┤
│ [Load CSV] [Simulate] │ ← 2×2 网格
│ [   Fit  ] [  Stop  ] │
└───────────────────────┘
```

---

## 实现细节

### 1. 按钮布局（2×2 Grid）

```typescript
<div style={{
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
}}>
  {/* 第一行 */}
  <button>Load CSV</button>
  <button>Simulate</button>
  
  {/* 第二行 */}
  <button>Fit</button>
  <button>Stop</button>
</div>
```

### 2. 按钮样式设计

#### Load CSV（主要操作 - 左上）
- **背景**: 主色调蓝色 `C.primary`
- **文字**: 白色
- **图标**: Upload
- **优先级**: 最高（工作流起点）

#### Simulate（次要操作 - 右上）
- **边框**: 灰色
- **背景**: 白色
- **文字**: 黑色
- **图标**: Activity
- **Hover**: 浅灰背景

#### Fit（重要操作 - 左下）
- **边框**: 主色调蓝色
- **背景**: 白色
- **文字**: 主色调蓝色
- **图标**: Play
- **Hover**: 蓝色背景 + 白字（反色）

#### Stop（危险操作 - 右下）
- **边框**: 错误红色 `C.error`
- **背景**: 白色
- **文字**: 错误红色
- **图标**: Square
- **Hover**: 红色背景 + 白字（反色）

### 3. 视觉层次

```
优先级: Load CSV > Fit > Simulate > Stop
   │         │      │        │        │
   └─ 主色填充  └─ 主色边框  └─ 灰色边框  └─ 红色边框
```

---

## 代码改动

### 1. 移除顶部菜单栏按钮

**src/app/App.tsx**:
- 删除 `TopLevelActionButton` 组件定义
- 删除 MenuBar 中 `activeNav === "workbench"` 的按钮渲染逻辑
- 移除不再需要的图标导入: `Activity`, `Play`, `Square`, `Upload`

### 2. 添加底部操作区

**src/app/components/Workbench.tsx**:

**导入新增**:
```typescript
import {
  ChevronRight, ChevronDown, Plus, Trash2,
  CheckCircle2, Circle, Minus,
  Upload, Activity, Play, Square,  // ← 新增
} from "lucide-react";
import { dispatchWorkbenchAction } from "../../lib/events";  // ← 新增
```

**颜色常量新增**:
```typescript
const C = {
  // ...
  surface: "#FFFFFF",  // ← 新增，用于按钮背景
  // ...
};
```

**FitProjectTree 组件底部新增**:
```typescript
{/* 操作按钮区域 - 2x2 网格 */}
<div style={{
  padding: "8px 10px 10px",
  borderTop: `1px solid ${C.border}`,
  backgroundColor: C.panelBg,
  flexShrink: 0,
}}>
  <div style={{
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 6,
  }}>
    {/* 4个按钮 */}
  </div>
</div>
```

---

## 优势对比

| 方面 | 原设计（顶部菜单栏） | 新设计（面板底部） |
|------|---------------------|-------------------|
| **语义清晰度** | ⚠️ 与导航菜单混淆 | ✅ 紧邻操作对象 |
| **操作流程** | ⚠️ 上下视线跳转 | ✅ 自上而下顺畅 |
| **空间利用** | ⚠️ 占用顶部空间 | ✅ 利用面板空间 |
| **视觉层次** | ⚠️ 单行排列拥挤 | ✅ 2×2 布局清晰 |
| **按钮尺寸** | ⚠️ 高度受限 (22px) | ✅ 舒适尺寸 (36px+) |
| **Hover 效果** | 🟡 简单变色 | ✅ 反色 + 语义强化 |

---

## 用户操作流程

### 之前
```
1. 在 Fit Project 面板勾选步骤 ↓
2. 视线移到顶部菜单栏 ↑
3. 在一排小按钮中找到目标 →
4. 点击操作
```

### 之后
```
1. 在 Fit Project 面板勾选步骤 ↓
2. 视线自然下移到底部 ↓
3. 2×2 网格快速定位 □
4. 点击操作
```

**操作距离**: 从跨越全屏 → 同一面板内  
**视觉跳转**: 上下跳跃 → 自上而下  
**认知负担**: 在多个选项中搜索 → 固定位置记忆

---

## 响应式考虑

### 面板宽度范围: 260px - 520px

#### 最窄 (260px)
```
┌─────────────┐
│ [Load] [Sim]│ 每个按钮 ~120px
│ [Fit] [Stop]│ 图标 + 文字清晰可见
└─────────────┘
```

#### 默认 (300px)
```
┌───────────────┐
│ [Load] [Simul]│ 每个按钮 ~142px
│ [Fit]  [Stop] │ 舒适的点击区域
└───────────────┘
```

#### 最宽 (520px)
```
┌─────────────────────────┐
│ [Load CSV]  [Simulate]  │ 每个按钮 ~252px
│ [   Fit  ]  [  Stop  ]  │ 宽松的布局
└─────────────────────────┘
```

**结论**: 2×2 网格在所有宽度下都保持良好的可用性

---

## 可访问性增强（后续）

可考虑添加：
1. **键盘快捷键**: 
   - `Ctrl+L`: Load CSV
   - `Ctrl+R`: Simulate (Run)
   - `Ctrl+F`: Fit
   - `Escape`: Stop

2. **ARIA 属性**:
   - `aria-label`: 完整的操作说明
   - `aria-disabled`: 禁用状态标注
   - `role="group"`: 标记为操作组

3. **状态反馈**:
   - Loading 状态显示 spinner
   - Fitting 时 Fit 按钮变为进度条
   - Stop 按钮仅在有任务时可用

---

## 编译验证

```bash
npm run build
✓ built in 3.15s
```

**产物大小**: 651.87 kB (gzip: 188.25 kB)

---

## 总结

✅ **语义更清晰**: 操作按钮与操作对象（Fit Project）在同一区域  
✅ **流程更顺畅**: 勾选 → 查看 → 操作，自上而下完成  
✅ **视觉更舒适**: 2×2 网格布局，按钮尺寸更大  
✅ **优先级明确**: 颜色和位置体现操作重要性  
✅ **菜单栏清爽**: 顶部只保留导航功能

**建议**: 后续可考虑添加快捷键和状态反馈以进一步提升用户体验。
