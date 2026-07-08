# UI 优化任务清单

## ✅ 已完成

### 1. 代码审查和修复
- ✅ 类型安全：将 17 处 `e: any` 改为 `e: unknown`
- ✅ 事件监听器风险：优化拖动逻辑，使用 ref 保存依赖
- ✅ 事件类型不匹配：创建 `src/lib/events.ts` 统一事件接口

### 2. Fit Project 面板功能
- ✅ 添加步骤 (Add Vds/Vgs step)
- ✅ 删除用户添加的步骤（垃圾桶图标）
- ✅ 勾选/取消勾选功能
- ✅ 树状导航和选中状态

### 3. 操作按钮布局优化
- ✅ 将 Load CSV / Simulate / Fit / Stop 按钮从顶部菜单栏移至 Fit Project 面板底部
- ✅ 采用 2×2 网格布局
- ✅ 视觉层次优化（主操作用蓝色填充，危险操作用红色边框）

---

## ⏳ 进行中

### 4. SELECTED 功能区改造
**目标**：将 Selected Item Panel 改为鼠标悬停 3 秒后显示的 Tooltip

**状态**：代码已编写，遇到文件冲突，需要重新应用

**实现要点**：
```typescript
// 1. 添加 tooltip 状态和计时器
const [tooltip, setTooltip] = useState<{ child: TreeChild; rect: DOMRect } | null>(null);
const hoverTimerRef = useRef<number | null>(null);

// 2. 鼠标进入时启动 3 秒计时器
const handleChildMouseEnter = (child: TreeChild, e: React.MouseEvent<HTMLDivElement>) => {
  const rect = e.currentTarget.getBoundingClientRect();
  hoverTimerRef.current = window.setTimeout(() => {
    setTooltip({ child, rect });
  }, 3000);
};

// 3. 鼠标离开时清除计时器和tooltip
const handleChildMouseLeave = () => {
  if (hoverTimerRef.current !== null) {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }
  setTooltip(null);
};

// 4. 渲染 Tooltip（深灰背景、白字、固定定位）
{tooltip && <ChildDetailTooltip child={tooltip.child} targetRect={tooltip.rect} />}

// 5. 删除 SelectedItemPanel 组件
```

---

## 📋 待办

### 5. TopBar 移除
**目标**：完全移除应用内的 TopBar，只保留系统标题栏

**文件**：`src/app/App.tsx`

**改动**：
```typescript
// 删除 TopBar 函数组件
// 删除 AppInner 中的 <TopBar /> 调用
// 调整布局，移除 TopBar 占用的高度
```

---

### 6. 应用图标设计和替换
**目标**：设计 MOSFET 符号图标替换当前蓝色方块

**图标方向**：MOSFET 符号（三个端子的晶体管）

**需要的尺寸**：
- Windows: 16×16, 32×32, 128×128, 256×256 (.ico)
- macOS: 512×512, 1024×1024 (.icns)  
- Linux: 256×256 (.png)

**文件位置**：
- Tauri 图标：`src-tauri/icons/`
- 需要替换所有尺寸的图标文件

**设计要点**：
1. **主体**：简化的 N沟道 MOSFET 符号
   - G (Gate) - 左侧
   - D (Drain) - 上方
   - S (Source) - 下方
2. **颜色**：主色调蓝色 (#0D7F8F) + 白色背景
3. **风格**：线条清晰、专业、易识别
4. **圆角**：适度圆角（8-12px @ 256px）

---

## 📝 建议

由于文件编辑遇到冲突，建议采用以下方式完成剩余任务：

1. **手动应用 Tooltip 改动**（推荐）
   - 打开 `src/app/components/Workbench.tsx`
   - 按照上述代码手动修改

2. **或者使用 Git patch**
   - 创建包含所有改动的 patch 文件
   - 一次性应用

3. **TopBar 移除**
   - 相对独立，可以单独完成

4. **图标设计**
   - 可以使用 Figma / Inkscape 设计
   - 或者我可以生成 SVG 代码，您转换为各种尺寸

---

##当前状态

**编译状态**：✅ 成功 (`npm run build` 3.92s)  
**Git 状态**：工作区有修改，但文件已恢复到稳定状态  
**功能完成度**：约 75%

建议下一步先完成 TopBar 移除（简单）和图标设计（可离线完成），然后再处理 Tooltip 改造。
