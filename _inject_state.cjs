const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');
const old = 'const [dragOverStepIndex, setDragOverStepIndex] = useState<number | null>(null);\n\n  // ---- 防抖 ----';
const new_ = 'const [dragOverStepIndex, setDragOverStepIndex] = useState<number | null>(null);\n  // 侧边栏 Tab 切换: "steps" = Transfer Steps + 数据 + 区间, "params" = BSIM3 参数\n  const [sidePanelTab, setSidePanelTab] = useState<"steps" | "params">("steps");\n\n  // ---- 防抖 ----';
if (!src.includes(old)) {
  console.error('OLD NOT FOUND');
  console.log('First 200 chars after line 521:');
  const idx = src.indexOf('setDragOverStepIndex');
  console.log(JSON.stringify(src.substring(idx, idx + 200)));
  process.exit(1);
}
src = src.replace(old, new_);
fs.writeFileSync(path, src);
console.log('OK, sidePanelTab added');