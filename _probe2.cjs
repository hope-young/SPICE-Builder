const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');
// 右栏 div 开始到文件末尾
const rightPaneStart = src.indexOf('{/* ===== 右栏');
const tail = src.substring(rightPaneStart);
const opens = (tail.match(/<div(?!er)/g) || []).length;
const closes = (tail.match(/<\/div>/g) || []).length;
console.log('rightPane opens:', opens, 'closes:', closes, 'diff:', opens - closes);

// 现在 spice-workbench 起点
const wbStart = src.indexOf('<div className="spice-workbench"');
const wbEnd = src.length;
const wb = src.substring(wbStart, wbEnd);
const ws = (wb.match(/<div(?!er)/g) || []).length;
const wc = (wb.match(/<\/div>/g) || []).length;
console.log('spice-workbench opens:', ws, 'closes:', wc, 'diff:', ws - wc);