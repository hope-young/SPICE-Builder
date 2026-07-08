const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
const balanced = [];
let depth = 0;
const re = /[(){}\[\]]/g;
let inStr = null;
let inTpl = false;
let inJsx = false;
for (let i = 0; i < src.length; i++) {
  const ch = src[i];
  // 简化跳过 string/template
  const prev = src[i-1];
  if (ch === '"' || ch === "'" || ch === '`') {
    if (inStr === ch && prev !== '\\') { inStr = null; continue; }
    if (!inStr) { inStr = ch; continue; }
  }
  if (inStr) continue;
  if (ch === '(') depth++;
  if (ch === ')') depth--;
  if (depth > 1) console.log(`at pos ${i}: depth=${depth}, ctx: ${JSON.stringify(src.substring(Math.max(0, i-30), i + 30))}`);
}
console.log('final depth:', depth);