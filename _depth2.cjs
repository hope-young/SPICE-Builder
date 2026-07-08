const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');
const returnStart = src.indexOf('return (', src.indexOf('export function SingleCurveFit'));
const sub = src.substring(returnStart);
let depth = 0;
let lineNum = returnStart;
const re = /<div(\s|>)|<\/div>/g;
let m;
while ((m = re.exec(sub))) {
  const isOpen = m[1] !== undefined;
  if (isOpen) depth++;
  else depth--;
  if (depth > 5) {
    const nl = (sub.substring(0, m.index).match(/\n/g) || []).length;
    const snippet = sub.substring(Math.max(0, m.index - 30), m.index + 80).replace(/\n/g, '\\n');
    console.log(`line ${returnStart + nl} depth=${depth} ${isOpen ? "OPEN" : "CLOSE"}: ${snippet}`);
  }
  if (depth === 9) { console.log('depth 8 reached, breaking'); break; }
}