const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');

// 现在末尾是 3 个 </div>. 1708 报错说没对应 closing tag.
// 1708 是主 wrapper 开 <div style={{flex column height 100% ...}}>.
// 它应该在 spice-workbench close 后再 close 1 次, 总共 close 4 个 instead of 3.
// 所以再加 1 个 </div> 在末尾.

// 但其实我们 spice-workbench div 自己 + outer spice-workbench container + main wrapper + ????...

// 让我看具体末尾:
console.log('tail:', JSON.stringify(src.substring(src.length - 200)));