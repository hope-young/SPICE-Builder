const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');
const wbStart = src.indexOf('<div className="spice-workbench"');
const sub = src.substring(wbStart);
let depth = 0;
let lineNum = 1735;
let lastUnclosed = -1;
const re = /<div\b|<\/div>/g;
let m;
while ((m = re.exec(sub))) {
  const isOpen = sub.substring(m.index, m.index + 5) === '<div ';
  if (isOpen) depth++;
  else depth--;
  const nls = (sub.substring(0, m.index).match(/\n/g) || []).length;
  const ln = 1735 + nls;
  if (depth < 0) { console.log('underflow at line', ln, 'pos', m.index); break; }
  if (depth > 0 && depth === 6) console.log('depth=6 hit at', ln, '=', sub.substring(m.index, m.index + 50));
}