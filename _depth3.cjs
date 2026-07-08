const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');
// 用更宽容的正则: <div 任意非 '>' 内容
const re = /<div\b[^>]*>|<\/div>/g;
let depth = 0;
let m;
let lineOffset = src.substring(0, src.indexOf('return (', src.indexOf('export function SingleCurveFit'))).split("\n").length;
while ((m = re.exec(src))) {
  const isOpen = m[0].startsWith('<div');
  if (isOpen) depth++;
  else depth--;
  const nlBefore = (src.substring(0, m.index).match(/\n/g) || []).length;
  if (depth > 7 || depth < -1) {
    console.log(`line ${nlBefore + 1} depth=${depth} ${isOpen ? "OPEN" : "CLOSE"}: ${m[0].substring(0, 60)}`);
  }
}
console.log('final depth:', depth);