const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');
const start = src.indexOf('<div className="spice-workbench"');
const end = src.indexOf('    </div>\n  );\n  }\n}');  // 找到 return 末尾近似位置
// 实际不严谨, 让我找 spice-workbench 闭合范围 (从 1735 到 2646):
const open = (src.substring(start, start + 200).match(/<div/g) || []).length;

// 实际: scan within range L1735 - L2646
const sub = src.substring(start, start + 130000);
const openCount = (sub.match(/<div/g) || []).length;
const closeCount = (sub.match(/<\/div>/g) || []).length;
console.log('open:', openCount, 'close:', closeCount, 'diff:', openCount - closeCount);

// 找出 5 个差, 看看是不是匹配 spice-workbench 闭