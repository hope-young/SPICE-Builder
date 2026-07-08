const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');

// 我们要替换 ParamSliders 完整属性 prop, 把多行的箭头函数提到变量.
// 这段在 spice-workbench 内容内, 我直接在源码中找到那行替换.

// pat: `<ParamSliders values={pvals} ... onResetCatBounds={(cat) => setCustomBounds(prev => { const n = { ...prev }; for (const p of BSIM3_PARAMS.filter(item => item.category === cat)) delete n[p.name]; return n; })} />`
// 用一行的等价版本, 或者提到变量.

// 简单方案: 把整个属性行拆开, 但需要先在 SCF 函数里加 const.
// 简化：直接将 ParamSliders 替换为最小 subset, 暂时不绑对象, 各 prop 简单:
//  - 只传 values, checked, onChange, onCheck, onReset 几个基本 prop.
// 这样 JSX 内就不会有嵌套箭头函数.

// 但 ParamSliders 已 import. 不能随便改 ParamSliders. 这是个 React 组件.

// 最简: 移除 multi-prop 段, 只保留 onChange 和 onCheck. 其它给空的 placeholder.

const oldPs =
  '<ParamSliders values={pvals} checked={checked} locked={lockedParams} onChange={onParamChange} onCheck={onCheck} onToggleLock={onToggleLock} onReset={onReset} onResetCat={onResetCat} bounds={customBounds} onBoundsChange={(name, next) => setCustomBounds(prev => ({ ...prev, [name]: next }))} onResetBounds={(name) => setCustomBounds(prev => { const n = { ...prev }; delete n[name]; return n; })} onResetCatBounds={(cat) => setCustomBounds(prev => { const n = { ...prev }; for (const p of BSIM3_PARAMS.filter(item => item.category === cat)) delete n[p.name]; return n; })} />';

const newPs =
  '<ParamSliders values={pvals} checked={checked} locked={lockedParams} onChange={onParamChange} onCheck={onCheck} onToggleLock={onToggleLock} onReset={onReset} onResetCat={onResetCat} bounds={customBounds} onBoundsChange={onBoundsChange} onResetBounds={onResetBounds} onResetCatBounds={onResetCatBounds} />';

if (src.indexOf(oldPs) === -1) {
  console.error('OLD pat not found');
  process.exit(1);
}

// 在 SingleCurveFit 函数体加 const 定义. 我把它放在 useTreeData 后,
// 但要正确放在 return (...) 之前. 实际上 useTreeData 已经存在, 让我们找 useTreeData 函数的结尾.
// SingeCurveFit 函数体内 useState 的位置 (在 525 附近) 用作加.
// 加在 stopPreset 后面:

const const_block =
"  // ParamSliders 回调包装 (避免 JSX-in-JSX prop 嵌入)\n" +
"  const onBoundsChange = useCallback((name: string, next: { min?: string; max?: string }) => {\n" +
"    setCustomBounds(prev => ({ ...prev, [name]: next }));\n" +
"  }, []);\n" +
"  const onResetBounds = useCallback((name: string) => {\n" +
"    setCustomBounds(prev => { const n = { ...prev }; delete n[name]; return n; });\n" +
"  }, []);\n" +
"  const onResetCatBounds = useCallback((cat: string) => {\n" +
"    setCustomBounds(prev => { const n = { ...prev } as Record<string, { min?: string; max?: string }>; for (const p of BSIM3_PARAMS.filter(item => item.category === cat)) delete (n as Record<string, { min?: string; max?: string }>)[p.name]; return n; });\n" +
"  }, []);\n";

// 找到 dragOverStepIndex 后面插入.
const marker = 'const [dragOverStepIndex, setDragOverStepIndex] = useState<number | null>(null);';
const injectAfter = "const [dragOverStepIndex, setDragOverStepIndex] = useState<number | null>(null);\n  const [sidePanelTab, setSidePanelTab] = useState<\"steps\" | \"params\">(\"steps\");";

const re = new RegExp('const \\[dragOverStepIndex[^;]*;');
const m = src.match(re);
if (!m) {
  console.error('dragOverStepIndex line not found');
  process.exit(1);
}

// 在 sidePanelTab 后插入.
const insertAfter = "const [sidePanelTab, setSidePanelTab] = useState<\"steps\" | \"params\">(\"steps\");";
if (!src.includes(insertAfter)) {
  console.error('sidePanelTab line not found');
  process.exit(1);
}

src = src.replace(insertAfter, insertAfter + '\n' + const_block);

// 现在替换 ParamSliders 的 prop 段.
src = src.replace(oldPs, newPs);

fs.writeFileSync(process.argv[2], src);
console.log('ParamSliders simplified, size:', src.length);