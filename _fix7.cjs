const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
// 把末 4 个 </div> 变成 5 个
const before = src.replace(/\n    <\/div>\n    <\/div>\n    <\/div>\n    <\/div>\s*$/, '\n    </div>\n    </div>\n    </div>\n    </div>\n    </div>');
if (before !== src) {
  fs.writeFileSync(process.argv[2], before);
  console.log('added closing div');
} else {
  console.log('pattern not matched');
}