const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');

// 直接替换我 inject 的 sidePanel 内容:
// 内容大致在 line 1750-1820.
// 
// 把 <div sidepanel> 内 的 content <div content scrollable> 改成 <></>
// 简化:
//   <div sidepanel> 
//     <div tabs header>
//       <button>Steps</button>
//       <button>BSIM3</button>
//     </div>
//     <div content scrollable>
//       {sidePanelTab === "steps" ? (...) : (...)}
//     </div>
//   </div>
//
// 改成:
//   <div sidepanel> 
//     <div tabs header>
//       <button>Steps</button>
//       <button>BSIM3</button>
//     </div>
//     {sidePanelTab === "steps" ? <div>...</div> : <div>...</div>}
//   </div>
//
// 这就是删除 inner wrap <div content scrollable>. 因为这个 inner wrap 也贡献 1 开 1 闭,
// 我们把它去掉 ternary 直接 sibling.

// 找到 '<div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 0", display: "flex", flexDirection: "column", gap: 10 }}>',
// 和 '</div>\n      </div>\n\n      {/* ===== 右栏' 这段 (其中 </div> 是 close sidepanel)

// 我们做替换: sidepanel 头部 → sidepanel 头部_with {  conditional ternary (replacing inner wrap)
// then ternary 末尾 </div> 改成 </div> (移除一个 close, 把内 wrap close 移掉)

// 这个手改 JSX 比较复杂. 我用一个更简单粗暴的: 让 sidepanel 的 inner wrap 内容不嵌套, 直接放进去.

// 但其实可能问题就是 {sidePanelTab === "steps" ? ... : ...} 三元 的 props 中 include 复杂对象字面量. 
// 我之前 fix_param.cjs 已经抽调 onResetBounds/onResetCatBounds 等.
// 但 TS 还在抱怨.

// 让我看更小范围: 我把 sidepanel 段的 inner wrap div 删除. 这样 ternary 直接是 sidepanel 内的 child.

// 找内 wrap: 我 sidepanel 内容是从 '\n        <div style={{ flex: 1, overflowY: "auto",' 开, 到后面 '\n        </div>' (close inner wrap) 然后 '\n      </div>' (close sidepanel).

// 直接暴力删除内 wrap div.

const innerOpen = '        <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 0", display: "flex", flexDirection: "column", gap: 10 }}>';
const idx = src.indexOf(innerOpen);
if (idx === -1) {
  console.error('inner wrap open not found');
  process.exit(1);
}
// 找 close inner wrap
const innerClose = '        </div>';
const idxClose = src.indexOf(innerClose, idx);
if (idxClose === -1) {
  console.error('inner wrap close not found');
  process.exit(1);
}

const before = src.substring(0, idx);
const middle = src.substring(idx + innerOpen.length, idxClose);
// 现在 middle 是 ternary 内部, 不带 wrap div.
// 我们 rebuild: before + '\n          ' + middle + after.
// 但 middle 内容现在是 "{sidePanelTab === "steps" ? (\n            <div>...</div>\n          ) : (\n            <div>...</div>\n          )}" 这块.
// inner wrap div 应当被删. 我们把 ternary 改成直接当 sidepanel 的 sibling.
// 也就是: 从 innerOpen 处把 wrap div 删除, ternary 内容成为 sidepanel 的直接 child.

// 替换: src = before + ternary 内容 + after
const after = src.substring(idxClose + innerClose.length);
// 但 after 还包含 </div> close sidepanel. 所以 middle (ternary content) 直接嵌入.

const newSrc = before + '\n          ' + middle.trimEnd() + '\n        ' + after;
fs.writeFileSync(process.argv[2], newSrc);
console.log('inner wrap div removed, new size:', newSrc.length);