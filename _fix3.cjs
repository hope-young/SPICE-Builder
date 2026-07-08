const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');

// 末尾 5 个 </div>:
// 2643  右栏 div 自身闭
// 2644  spice-workbench 自身闭 (我加的)
// 2645 原本的"主 wrapper 1 close"
// 2646 原本的"主 wrapper 2 close"
// 2647 原本的"主 wrapper 3 close"
// 我推测原 SCF 主 return 只有 1 个 wrapper div, 但我 fix 前看到 4 个 </div>.
// 看原本 4 个 </div> 是不是这样: 右栏 close + spice-workbench close + main close + 额外 (单个外层 wrapper)

// 1 个 App.tsx 调用 SingleCurveFit, 不应该有 wrapper.
// 所以原本的 4 个 </div> 中: 右栏 + spice-workbench + main close + 1 个多余的.

// 我们 spice-workbench 上层 main wrapper 只 1 个. fix 前看到 4 个, 我们 spice-workbench 自身 close 已经丢了.
// 现在 fix2 加回了 spice-workbench close -> 5 个.
// 应是 3 个: 右栏 + spice-workbench + main.
// 删除 2645 和 2646 这 2 个 </div>.

// 匹配末尾 '    </div>\n    </div>\n    </div>' (3 个连续)
const re = /(\s+<\/div>\s*\n\s+<\/div>\s*\n\s+<\/div>\s*\n\s+<\/div>\s*\n\s+<\/div>\s*)$/;
const tail = src.match(re);
if (tail) {
  const beforeTail = src.substring(0, src.length - tail[0].length);
  // 改成 3 个 </div> 而不是 5 个
  const newTail = '\n    </div>\n    </div>\n    </div>';
  src = beforeTail + newTail;
  fs.writeFileSync(path, src);
  console.log('fix applied');
} else {
  console.error('pattern not found');
}