const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');

// 找 spice-workbench 开 div > > > "}}>" 后第一个 `{/* ==== 侧边栏` 注释.
// 一直删到右栏注释 `{/* ===== 右栏`, 然后插入一段干净 sidepanel.

// 先确定位置:
const wbStart = src.indexOf('<div className="spice-workbench"');
const wbOpenEnd = src.indexOf('}>', wbStart) + 2;
const rightStart = src.indexOf('{/* ===== 右栏', wbStart);

console.log('wbStart', wbStart, 'wbOpenEnd', wbOpenEnd, 'rightStart', rightStart);

// 把 wbOpenEnd 后到 rightStart 之间的内容全部清掉 (即 spice-workbench 内的 sidepanel+tabs+fragment 复杂段).
const cleaned = src.substring(0, wbOpenEnd) + '\n      {/* Workbench: 极简侧栏 - 直接用 idvg 列表 + csv 按钮 */}\n\n      ' + src.substring(rightStart);
fs.writeFileSync(process.argv[2], cleaned);
console.log('cleaned up inner section, size:', cleaned.length);