const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
const returnStart = src.indexOf('return (', src.indexOf('export function SingleCurveFit'));
const wbStart = src.indexOf('<div className="spice-workbench"');
// 现在 depth 跟踪, 起点 depth=0
const re = /<div\b[^>]*>|<\/div>/g;
let depth = 0;
let m;
let milestones = {};
const wbRe = /<div className="spice-workbench"/;
while ((m = re.exec(src))) {
  const isOpen = m[0].startsWith('<div');
  const prev = depth;
  if (isOpen) depth++;
  else depth--;
  // 记录 wb 开和关键深度
  if (m[0].includes("spice-workbench")) {
    milestones['spice-workbench open'] = { depth: prev + 1, line: (src.substring(0, m.index).match(/\n/g) || []).length };
  }
  if (prev === 1 && depth === 0) {
    // 看到第一个 depth 1 -> 0 的 close
    milestones['first depth 0'] = { line: (src.substring(0, m.index).match(/\n/g) || []).length };
    break;
  }
}
console.log('milestones:', milestones);