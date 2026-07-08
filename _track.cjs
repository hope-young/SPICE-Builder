const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');
const start = src.indexOf('<div className="spice-workbench"');
// 从 start 开始追踪 div 嵌套层数
const rest = src.substring(start);
let depth = 0;
let lineNum = 1735;
const re = /<div|<\/div>/g;
let m;
while ((m = re.exec(rest))) {
  const isOpen = m[0] === '<div';
  // 跳过字符串里的 <div (在 JSX 内部 attributes)
  // 简单实现: 把 m.index 之前的字符串里数 newline
  const nls = (rest.substring(0, m.index).match(/\n/g) || []).length;
  const ln = 1735 + nls;
  if (isOpen) depth++;
  else depth--;
  // 输出最深的嵌套
  if (depth < 0) { console.log('underflow at', ln, 'pos', m.index); break; }
}
console.log('final depth:', depth);