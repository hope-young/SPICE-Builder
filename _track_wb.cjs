const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');
// 从 wbStart 开始追踪, 关闭时刻
const wbStart = src.indexOf('<div className="spice-workbench"');
const sub = src.substring(wbStart);
const re = /<div\b[^>]*>|<\/div>/g;
let depth = 0;
let m;
let closes = [];
while ((m = re.exec(sub))) {
  const isOpen = m[0].startsWith('<div');
  if (isOpen) depth++;
  else { depth--; closes.push({ pos: wbStart + m.index, depth }); }
  if (depth < 0) { console.log('underflow at', m.index); break; }
}
console.log('final spice-workbench depth:', depth);
console.log('last 5 closes:', closes.slice(-5));
console.log('first close:', closes[0]);