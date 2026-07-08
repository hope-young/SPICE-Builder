const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
// 加 1 个 </div> 在末尾让 main wrapper 有 close
const before = src.replace(/\n    <\/div>\n    <\/div>\n    <\/div>\s*$/, '\n    </div>\n    </div>\n    </div>\n    </div>');
if (before !== src) {
  fs.writeFileSync(process.argv[2], before);
  console.log('added 1 closing div');
} else {
  console.log('pattern not found; already has 4? or different ending');
  console.log('tail:', src.substring(src.length - 100));
}