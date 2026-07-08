const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
// 在 sidePanel 段, 找 fragment <>, </>
// sidepanel section 起始: 1759. 结束大概在 spice-workbench 内 layer close.
// spice-workbench 自身 close is at file end. 我们的 spice-workbench close 现在在 file 末尾 (1978).
// 但 spice-workbench 还有 content. spice-workbench 自己 close 应在 rightPane close 之后 (1980).

// spice-workbench 自己 close 后, 应当 main wrapper close (1981). 但 TS 抱怨 1991:11.

// 1991 line 实际是 `          )}`. 这是 ternary close.
// 检查 fragment. 算一下 JSX nest.
let braces = 0;
let parens = 0;
let depth = 0;
let line = 1;
const lines = src.split('\n');
for (const ln of lines) {
  // 跳过字符串内的字符. 简化: 跳过 ` ... ` 内的.
  let i = 0;
  while (i < ln.length) {
    const ch = ln[i];
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '(') parens++;
    if (ch === ')') parens--;
    // JSX 标签 start: <div
    if (ch === '<') {
      // 跳过 tag 名称
      let j = i + 1;
      while (j < ln.length && ln[j] !== '>' && ln[j] !== ' ' && ln[j] !== '/') j++;
      if (ln[j] === '/' && ln[j+1] !== 'd') {} // skip, e.g. </div
    }
    i++;
  }
  line++;
}
console.log('braces:', braces, 'parens:', parens);