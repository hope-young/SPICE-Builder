const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');

// 用 spice-workbench 开 + 在 'export default ' (没有, 是 export function) -- 找 return ( 单后的 spice-workbench.
// 在 export function SingleCurveFit(...) 闭, return (...) 闭的代码段.
// 找到 spice-workbench 起点:
const wbStart = src.indexOf('<div className="spice-workbench"');
console.log('wbStart byte:', wbStart);

// return 的闭括号: 找 export function SingleCurveFit 函数体的最末 '}' (与 export function 对应)
// 但 export function 后面就直接有 return (...); ...; 我们找 export function 后的"第一个顶层 '}; \n'"
const efStart = src.indexOf('export function SingleCurveFit');
// 我们往后找 '}export default' 或者 '/* ==== ' 注释之类的结束 return 的标志.
// 实际上 export function SingleCurveFit 里最后是 `}` 闭函数本身. 这个 '}' 在 spice-workbench 后面跟着 4 个 </div>.
// 我们 spice-workbench 起点 + 300 行
console.log(JSON.stringify(src.substring(wbStart, wbStart + 200)));
