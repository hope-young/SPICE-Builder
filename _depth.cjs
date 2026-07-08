const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');
// 从 1707 (return () { 之前) 开始到文件末尾 (export function 闭)
const returnStart = src.indexOf('return (', src.indexOf('export function SingleCurveFit'));
const sub = src.substring(returnStart);
// 在 <div style={{ flex ... column ... height: 100% ... overflow: hidden  bg pageBg ... }}> 这层之上
// 我做括号级别追踪, 仅在 <div 或 </div> 上, 跳过字符串里的
let depth = 0;
const re = /<div(\s|>)|<\/div>/g;
let m;
let maxDepth = 0;
let lineNum = returnStart;
const reLine = /\n/g;
while ((m = re.exec(sub))) {
  const isOpen = m[1] !== undefined;
  if (isOpen) { depth++; if (depth > maxDepth) maxDepth = depth; }
  else depth--;
  if (depth < 0) console.log('underflow at line', lineNum + (sub.substring(0, m.index).match(reLine) || []).length);
}
console.log('final depth:', depth, 'max:', maxDepth);