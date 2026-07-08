const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
// 取消 fix4 加的 1 个 </div>. 末 4 个改回 3 个
const before = src.replace(/\n    <\/div>\n    <\/div>\n    <\/div>\n    <\/div>\s*$/, '\n    </div>\n    </div>\n    </div>');
if (before !== src) {
  fs.writeFileSync(process.argv[2], before);
  console.log('removed 1 closing div');
}