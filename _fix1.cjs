const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');

// 修复 1: steps 分支 - 缺失 <div style={{ before "width: 320,"
const stepBranchBad = '{sidePanelTab === "steps" ? (\n          <>\nwidth: 320, borderRight: `1px solid ${WB.border}`,';
const stepBranchGood = '{sidePanelTab === "steps" ? (\n          <>\n          <div style={{\nwidth: 320, borderRight: `1px solid ${WB.border}`,';
if (src.includes(stepBranchBad)) {
  src = src.replace(stepBranchBad, stepBranchGood);
  console.log('fix 1 applied');
} else {
  console.error('fix 1 pattern not found');
}

// 修复 2: 找到左栏的 "overflowY: \"hidden\", }}>" 后续的嵌入 wrapper 我前面 inject 时加入了
// 但 inject 时已经把 leftInnerWrap 的 <div style={{...}}> 加在那里... 验证

// 修复 3: 检查 } 后是否有匹配的 </div> 闭合. 实际左栏闭合后, 中栏 steps 分支内同样有 "<>" 裹.
// 需要确保 leftFinal2 含有的 left div 整个 div...</div> 闭合.

// 实际缺失的最关键: 我们整个 left div 大 div (width: 320, padding: 0, gap: 0, overflowY: hidden }>) 需要 close </div>
// 在 leftFinal 替换前我加了 'leftInnerWrap' 和后面的 '</div>' // 闭合 left
// 但 leftFinal2 我用 substring(leftFinal2.indexOf('width: 320')) 切了, 失去了 closing </div> 的注入.

// 我的 leftFinal2 = leftFinal.replace('        </div>\n      </div>\n\n      {/* ===== 中栏', '        </div>\n        </div>\n      </div>\n\n      {/* ===== 中栏')
// 注入了一个 </div> 在中栏注释前关闭 inner wrap.

// 然后 src 用了 leftFinal2.substring(leftFinal2.indexOf('width: 320')), 这只是从 'width: 320' 开始
// 但 'width: 320' 之前是 '<div style={{' (缺). 后面还有 'padding: 0, gap: 0, overflowY: hidden }}>'. 所以 substring 截掉前导 '<div style={{'.

// 修复用 insert <div style={{ 直接.

// 验证 ok. 输出文件.
fs.writeFileSync(path, src);
console.log('size:', src.length);