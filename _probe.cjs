const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');

// spice-workbench 起点: 找到 `<div className="spice-workbench"`, 然后我们注入结构.
// spice-workbench 内部预期结构:
//   <div className="spice-workbench">
//     [外部侧边栏 div (width:320)]
//       tab header div
//       {sidePanelTab === "steps" ? (<>steps 内容</>) : (<>BSIM3 内容</>)}
//     </div> 关闭外侧边栏
//     [右栏 div flex:1]
//     </div> 关闭右栏
//   </div> 关闭 spice-workbench

// 从文件末尾向前看, 删除多余的 </div>. 如果我的拼接少了 6 个 </div>, 那 spice-workbench 整体就少 6.
// 假设 spice-workbench 容器结束应该是:
const endPattern = "    </div>\n  );\n}";  // 模拟文件结构的标准结尾
// 实际我的文件最后是: '    </div>\n\n' (没有 );\n}) 因为 SCF 不是 export default function 但 export function
// 找到 export function SingleCurveFit (line 450) 闭括号
const sfStart = src.indexOf('export function SingleCurveFit');
const fnStart = sfStart;
const fnEnd = src.indexOf('}', src.indexOf('return (', fnStart)); // 兜底不严谨
// 找到 return (
const returnStart = src.lastIndexOf('return (', src.indexOf('</div>\n    </div>\n\n', sfStart));
if (returnStart === -1) {
  console.log('returnStart not found via lastIndexOf');
}
// 用从结束处的 '    </div>\n\n' 向上看
const beforeTail = src.indexOf('    </div>\n\n');
console.log('beforeTail:', beforeTail);

// 拿末尾 200 char:
console.log('last 200 chars:', JSON.stringify(src.substring(src.length - 200)));

// 现在从 spice-workbench 起点到末尾, 简单 inspect 一下
const wbStart = src.indexOf('<div className="spice-workbench"');
const wbEnd = src.indexOf('\n    </div>\n  );\n  }\n}\n', wbStart);
console.log('wbStart', wbStart, 'wbEnd', wbEnd);