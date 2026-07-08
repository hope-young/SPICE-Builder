const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
// 找 1980 行附近的 fragment <>, </>
const sub = src.substring(1707 * 50, 1980 * 50).split('\n');
let opens = 0, closes = 0;
let lineNum = 1707;
let opensByLine = {};
let closesByLine = {};
for (const ln of sub) {
  lineNum++;
  for (const m of ln.matchAll(/<>/g)) opens++, opensByLine[lineNum] = (opensByLine[lineNum] || 0) + 1;
  for (const m of ln.matchAll(/<\/>/g)) closes++, closesByLine[lineNum] = (closesByLine[lineNum] || 0) + 1;
}
console.log('fragment opens total:', opens, 'closes total:', closes);
console.log('opens by line:', JSON.stringify(openByLineFunc(opensByLine)));
function openByLineFunc(m) {
  return Object.entries(m).filter(([k, v]) => v > 0);
}