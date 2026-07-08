const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
const before = src.replace(/\n    <\/div>\n    <\/div>\n    <\/div>\n    <\/div>\n    <\/div>\s*$/, '\n    </div>\n    </div>\n    </div>\n    </div>');
fs.writeFileSync(process.argv[2], before);
console.log('now 4 closes');