const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');

// 我们 spice-workbench 内的 `</div>` 在文件末尾.
// spice-workbench 自己 div 的 close 需要 right pane close 之后.
// 但 right pane 自己 close 是 1976 行. 因为 right pane 自己 div 嵌 inner (chartPaneRef div), + 内层 plot div、plot drag overlay、line chart、convergence plot、fit params columns...
// right pane 自己 close 应当在所有 plot 内容 close 之后, 即 file 末尾紧邻 close.

// 当前结构 (rewrite 后):
//   <div className="spice-workbench">  ← 1735
//     [side panel 段]                  ← 自己有 close div
//     [右栏 div + 内容]                ← 自己有 close div
//   </div>                             ← spice-workbench 自身 close, 必须有
//  </div>                              ← main wrapper close, 必须有
// );
// 然后 }                                ← 函数闭
//
// 现在的 4 个 close div 应该 OK:
// 1976: chartPane 内层 div 自身 close (BUT wait!), 1977: right pane 自身 close, 1978: spice-workbench self close, 1979: main wrapper close.
// 
// 让我打印 1976 行之前 3 行 + 之后 5 行, 看上下文:

const lines = src.split('\n');
console.log('lines 1970-1985:');
for (let i = 1970; i < 1985; i++) {
  console.log(`${i+1}: ${lines[i]}`);
}