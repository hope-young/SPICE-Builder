const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');

// 1. 找 spice-workbench 开 div 的 '}>' 处, spice-workbench 内容起点.
// 2. spice-workbench 内容到原"右栏"注释为止. spice-workbench wrapper 自己 close.
// 3. spice-workbench 后跟着 main wrapper close 应该在 return 的 ');' 后面.

// 我直接在 'wbOpenEnd' 后插入我的"干净 side panel + 原 right pane 内容" 然后 spice-workbench 自身 close 在 right pane 之后.

// 让我打印 spice-workbench 部分和它后续直到文件结尾的所有 </div>. 找出 rightPane 自身 </div> 在哪儿.
const wbStart = src.indexOf('<div className="spice-workbench"');
const wbOpenEnd = src.indexOf('}>', wbStart) + 2;
const tail = src.substring(wbStart);
console.log('end of file (last 50):', JSON.stringify(src.substring(src.length - 50)));

// 用 div 全局计数, 从 wbStart 开始. 假设 spice-workbench 自己 contribute 1 开.
// 当 depth 回到 1, 那是 close 到只剩 spice-workbench 自己.
// spice-workbench 自己 close 时, depth 应当到 0.
let depth = 0;
const re = /<div\b[^>]*>|<\/div>/g;
let m;
let pos = wbStart;
while ((m = re.exec(src)) && m.index < src.length) {
  const isOpen = m[0].startsWith('<div');
  if (isOpen) depth++;
  else depth--;
  if (depth === 0) {
    pos = m.index;
    console.log('depth=0 hit at pos', m.index, 'line', (src.substring(0, m.index).match(/\n/g) || []).length);
    console.log('before:', JSON.stringify(src.substring(m.index - 80, m.index)));
    console.log('after:', JSON.stringify(src.substring(m.index, m.index + 200)));
    break;
  }
}