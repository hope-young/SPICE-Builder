# Workbench.tsx 完整恢复代码

## 需要添加的关键功能

### 1. FitProjectTree 组件 - 添加删除按钮

在 `children.map` 部分，每个 child 行需要添加删除按钮：

```typescript
{child.id.includes('_user_') && (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onDeleteStep(child.id);
    }}
    style={{
      border: "none",
      background: "transparent",
      cursor: "pointer",
      padding: 2,
      display: "flex",
      color: C.error,
      opacity: 0.6,
    }}
    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
  >
    <Trash2 size={12} />
  </button>
)}
```

**位置**：在每个 child 项的最后，R² 值之后

---

### 2. FitProjectTree 组件 - 底部操作按钮

在 `FitProjectTree` 组件 return 的最后，添加操作按钮区域：

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
    <button
      onClick={() => dispatchWorkbenchAction("import")}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "10px 8px",
        border: 0,
        borderRadius: "var(--radius-sm)",
        background: C.primary,
        color: "#fff",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: ff,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
    >
      <Upload size={14} />
      Load CSV
    </button>

    <button
      onClick={() => dispatchWorkbenchAction("simulate")}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "10px 8px",
        border: `1px solid ${C.border}`,
        borderRadius: "var(--radius-sm)",
        background: C.surface,
        color: C.text,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: ff,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.selectedBg)}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = C.surface)}
    >
      <Activity size={14} />
      Simulate
    </button>

    <button
      onClick={() => dispatchWorkbenchAction("fit-selected")}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "10px 8px",
        border: `1px solid ${C.primary}`,
        borderRadius: "var(--radius-sm)",
        background: C.surface,
        color: C.primary,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: ff,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = C.primary;
        e.currentTarget.style.color = "#fff";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = C.surface;
        e.currentTarget.style.color = C.primary;
      }}
    >
      <Play size={14} />
      Fit
    </button>

    <button
      onClick={() => dispatchWorkbenchAction("stop")}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "10px 8px",
        border: `1px solid ${C.error}`,
        borderRadius: "var(--radius-sm)",
        background: C.surface,
        color: C.error,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: ff,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = C.error;
        e.currentTarget.style.color = "#fff";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = C.surface;
        e.currentTarget.style.color = C.error;
      }}
    >
      <Square size={14} />
      Stop
    </button>
  </div>
</div>
```

**位置**：在 `</div>` 结束标签之前，作为 FitProjectTree 的最后一个 div

---

### 3. Workbench 组件 - 添加拖动调整宽度

#### 3.1 添加 state 和 ref

```typescript
const [fitProjectWidth, setFitProjectWidth] = useState(() =>
  readStoredWidth(FIT_PROJECT_WIDTH_KEY, FIT_PROJECT_DEFAULT_WIDTH, FIT_PROJECT_MIN_WIDTH, FIT_PROJECT_MAX_WIDTH)
);
const [userSteps, setUserSteps] = useState<Record<string, TreeChild>>({});
```

#### 3.2 添加保存宽度的 effect

```typescript
useEffect(() => {
  window.localStorage.setItem(FIT_PROJECT_WIDTH_KEY, String(Math.round(fitProjectWidth)));
}, [fitProjectWidth]);
```

#### 3.3 添加拖动处理函数

```typescript
const beginFitProjectResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = fitProjectWidth;
  const previousCursor = document.body.style.cursor;
  const previousUserSelect = document.body.style.userSelect;

  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";

  const handleMove = (moveEvent: PointerEvent) => {
    const deltaX = moveEvent.clientX - startX;
    const newWidth = clamp(startWidth + deltaX, FIT_PROJECT_MIN_WIDTH, FIT_PROJECT_MAX_WIDTH);
    setFitProjectWidth(newWidth);
  };

  const handleUp = () => {
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousUserSelect;
    document.removeEventListener("pointermove", handleMove);
    document.removeEventListener("pointerup", handleUp);
  };

  document.addEventListener("pointermove", handleMove);
  document.addEventListener("pointerup", handleUp);
}, [fitProjectWidth]);
```

#### 3.4 添加删除步骤函数

```typescript
const handleDeleteStep = useCallback((stepId: string) => {
  setUserSteps(prev => {
    const next = { ...prev };
    delete next[stepId];
    return next;
  });
  if (selectedId === stepId) {
    setSelectedId(null);
  }
}, [selectedId]);
```

#### 3.5 合并用户步骤到 treeData

```typescript
const mergedTreeData = useMemo(() => {
  return treeData.map(feat => ({
    ...feat,
    children: [
      ...feat.children,
      ...Object.values(userSteps).filter(s => s.id.startsWith(`${feat.id}_user_`))
    ]
  }));
}, [treeData, userSteps]);
```

#### 3.6 修改布局结构

```typescript
return (
  <div style={{ display: "flex", flexDirection: "row", height: "100%", ... }}>
    {/* Fit Project Tree 列 - 可拖动宽度 */}
    <div
      style={{
        width: fitProjectWidth,
        minWidth: FIT_PROJECT_MIN_WIDTH,
        maxWidth: FIT_PROJECT_MAX_WIDTH,
        display: "flex",
        flexDirection: "column",
        borderRight: `1px solid ${C.border}`,
        backgroundColor: C.panelBg,
        overflow: "hidden",
        pointerEvents: "auto",
      }}
    >
      <FitProjectTree
        treeData={mergedTreeData}
        checkedFeatures={checkedFeatures}
        checkedChildren={checkedChildren}
        expandedFeatures={expandedFeatures}
        selectedId={selectedId}
        onToggleFeature={toggleFeature}
        onToggleChild={toggleChild}
        onToggleExpand={toggleExpand}
        onSelect={setSelectedId}
        onAddStep={handleAddStep}
        onDeleteStep={handleDeleteStep}
      />
    </div>

    {/* 拖动分隔条 */}
    <div
      onPointerDown={beginFitProjectResize}
      title="拖动调整 Fit Project 宽度"
      style={{
        width: 7,
        flexShrink: 0,
        cursor: "col-resize",
        borderLeft: `1px solid ${C.border}`,
        borderRight: `1px solid ${C.border}`,
        background: C.pageBg,
      }}
    />

    {/* 主区：SingleCurveFit */}
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", ... }}>
      <SingleCurveFit hideChrome hideFitTargetsPanel />
    </div>
  </div>
);
```

---

### 4. 移除 SelectedItemPanel

完全删除 `SelectedItemPanel` 函数组件定义和调用。

---

## 完整修改清单

1. ✅ 添加 imports: `useCallback`, `useEffect`, `useRef`, `Trash2`, `Upload`, `Activity`, `Play`, `Square`, `dispatchWorkbenchAction`
2. ✅ 添加常量: `FIT_PROJECT_MIN_WIDTH`, `FIT_PROJECT_MAX_WIDTH`, `FIT_PROJECT_DEFAULT_WIDTH`, `FIT_PROJECT_WIDTH_KEY`
3. ✅ 添加工具函数: `clamp`, `readStoredWidth`
4. ✅ FitProjectTree 签名添加 `onDeleteStep`
5. ✅ FitProjectTree 子项添加删除按钮
6. ✅ FitProjectTree 底部添加操作按钮（2×2网格）
7. ✅ Workbench 添加 `fitProjectWidth` 和 `userSteps` state
8. ✅ Workbench 添加 `beginFitProjectResize` 拖动函数
9. ✅ Workbench 添加 `handleDeleteStep` 函数
10. ✅ Workbench 添加 `mergedTreeData` memo
11. ✅ Workbench 布局改为可拖动宽度 + 拖动分隔条
12. ✅ 删除 SelectedItemPanel

---

## 建议操作步骤

由于修改点较多，建议：

1. **备份当前文件**：`cp src/app/components/Workbench.tsx src/app/components/Workbench.backup.tsx`
2. **逐步添加**：按照上述顺序，一个功能一个功能地添加
3. **每步验证编译**：`npm run build` 确保没有语法错误
4. **最后测试**：`npm run tauri dev` 查看功能是否正常

如果手动修改太麻烦，我可以尝试生成完整的 600+ 行文件供您直接替换。
