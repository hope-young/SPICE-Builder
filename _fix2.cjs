const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');

// 在右栏 div 自身闭 </div> 后, 主 wrapper 1 闭之前, 插入 spice-workbench 自身的 </div>.
// 末 4 行结构:
//   ... } />       （plot 覆盖层 div）
//   </>
//   )}
//   </div>      ← 右栏自身闭 (2643)
//   </div>      ← 主 wrapper 1
//   </div>      ← 主 wrapper 2
//   </div>      ← 主 wrapper 3
//
// 我们修改为:
//   </div>      ← 右栏自身闭
//   </div>      ← spice-workbench 自身闭 (新插)
//   </div>      ← 主 wrapper 1
//   </div>      ← 主 wrapper 2
//   </div>      ← 主 wrapper 3
//
// 但 spice-workbench div 在 1735 行开, 它的内容是 [外部侧边栏, 右栏], 不包括 2644 那些 wrapper.
// 也就是说 2644-2646 这 3 个是 SCF 函数 return 外层 wrapper; 它们 spice-workbench div 不能跨过.
// 那么 spice-workbench </div> 必须放在 2643 后, 2644 前.

const re = /(              \/>\n            <\/>\n          \)\}\n        <\/div>\n      <\/div>\n    <\/div>\n    <\/div>)\s*$/m;
const fixed = `              />\n            </>\n          )}\n        </div>\n      </div>\n    </div>\n    </div>\n    </div>`;

if (src.match(re)) {
  src = src.replace(re, fixed);
  console.log('fix applied');
} else {
  console.error('pattern not found, last 30 lines:');
  console.log(src.split('\n').slice(-30).join('\n'));
}
fs.writeFileSync(path, src);
console.log('size:', src.length);