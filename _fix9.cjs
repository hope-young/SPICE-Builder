const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
// 加 1 个
const before = src.replace(/\n    <\/div>\n    <\/div>\n    <\/div>\n    <\/div>\s*$/, '\n    </div>\n    </div>\n    </div>\n    </div>\n    </div>');
fs.writeFileSync(process.argv[2], before);
console.log('added 1 closing div, tail now:', before.substring(before.length - 80));