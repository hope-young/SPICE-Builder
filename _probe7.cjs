const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
// Spice-workbench 实际应当 div 数 1 + 1 闭; main wrapper 1 + 1 闭; right pane 1 + 1 闭 = 3 个 </div>.
// 当前末 3 个. 但 spice-workbench close 可能没在 right pane close 之后.
// 看具体 行:
console.log('tail:');
const lines = src.split('\n');
console.log(lines.slice(-6).map((l, i) => (lines.length - 6 + i) + ': ' + JSON.stringify(l)).join('\n'));