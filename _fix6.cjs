const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
// 改末 3 个 </div> 为 4 个
const before = src.replace(/\n    <\/div>\n    <\/div>\n    <\/div>\s*$/, '\n    </div>\n    </div>\n    </div>\n    </div>');
if (before !== src) {
  fs.writeFileSync(process.argv[2], before);
  console.log('added 1 closing div, new tail:', before.substring(before.length - 60));
}