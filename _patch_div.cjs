const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
// 找 1758 起的 div with text "Workbench 左栏..."
const startMarker = '                Workbench 左栏 v2 Fit Project Tree 用于浏览/选择; 此侧栏做参数化拟合编辑 (Steps / 数据 / Vgs 区间).';
const idx = src.indexOf(startMarker);
if (idx === -1) {
  console.error('marker not found');
  process.exit(1);
}
// 找下一个 <div ...> 在哪个位置 (下一段"Fit Scope" div)
// 然后看 startMarker 之后到下一个 div 之前有没有 </div>
const after = src.substring(idx + startMarker.length, idx + 600);
console.log('after marker preview:', JSON.stringify(after.substring(0, 200)));

// 我想 fix: 在 startMarker 后插入 </div>, 然后 补 newline 之后接 next thing.
const inj = '</div>\n              ';
const newSrc = src.substring(0, idx + startMarker.length) + '\n' + inj + src.substring(idx + startMarker.length);
fs.writeFileSync(process.argv[2], newSrc);
console.log('inserted </div>, new size:', newSrc.length);