const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');

// spice-workbench 容器起点
const workbenchOpen = src.indexOf('<div className="spice-workbench"');
if (workbenchOpen === -1) { console.error('workbench open not found'); process.exit(1); }
// 左栏起点: '{/* ===== 左栏: Transfer steps'
const leftStart = src.indexOf('{/* ===== 左栏: Transfer steps', workbenchOpen);
if (leftStart === -1) { console.error('leftStart not found'); process.exit(1); }

// 找到 spice-workbench 闭合: 用右栏后两个 </div> (右栏 div 闭合, 然后 spice-workbench div 闭合)
const rightClose = src.indexOf('</div>\n    </div>\n    </div>', leftStart);
if (rightClose === -1) { console.error('rightClose not found'); process.exit(1); }
const workbenchCloseEnd = rightClose + '</div>\n    </div>\n    </div>'.length;
const sliceEnd = workbenchCloseEnd;

// 提取三块
const sectionMarker = (s) => src.indexOf(s, workbenchOpen);
const leftMark = sectionMarker('{/* ===== 左栏: Transfer steps');
const midMark = sectionMarker('{/* ===== 中栏: 参数滑块');
const rightMark = sectionMarker('{/* ===== 右栏: 曲线图');
const endMark = workbenchCloseEnd;

// 确认顺序
if (!(leftMark < midMark && midMark < rightMark && rightMark < endMark)) {
  console.error('order wrong', { leftMark, midMark, rightMark, endMark }); process.exit(1);
}

const leftBody = src.substring(leftMark, midMark);  // 含左栏 div
const midBody  = src.substring(midMark, rightMark); // 含中栏 div
const rightBody = src.substring(rightMark, endMark); // 右栏 div + 闭合

// 左栏宽 280 + 中栏宽 300 = 合并后 320
// 把左栏 width:280 -> 320
const leftRewrapped = leftBody.replace(
  'width: 280, borderRight: `1px solid ${WB.border}`,\n        background: WB.panelBg,\n        display: "flex", flexDirection: "column",\n        padding: 12, gap: 10, flexShrink: 0,\n        minHeight: 0, overflowY: "auto",',
  'width: 320, borderRight: `1px solid ${WB.border}`,\n        background: WB.panelBg,\n        display: "flex", flexDirection: "column",\n        padding: 0, gap: 0, flexShrink: 0,\n        minHeight: 0, overflowY: "hidden",'
);
// 中栏 width: 300 改 320, padding 取消 (内部 tab 已经管 padding)
// 中栏本身没有 padding/marginTop 设定，只有一行:
// 'width: 300, borderRight: "1px solid var(--border)",\n        display: "flex", flexDirection: "column", flexShrink: 0,'
const midRewrapped = midBody.replace(
  'width: 300, borderRight: "1px solid var(--border)",\n        display: "flex", flexDirection: "column", flexShrink: 0,',
  'width: 320, borderRight: "1px solid var(--border)",\n        display: "flex", flexDirection: "column", flexShrink: 0,\n        minHeight: 0, overflow: "hidden",'
);

// 中栏里面的顶部标题块: BSIM3 参数 + 'Sim...' badge 改为标准 tab 内容
// 原有的是:
// <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 8, }}>
//   BSIM3 参数
//   {simulating && <span style={{ fontSize: 10, color: "var(--warning)" }}>Sim...</span>}
// </div>
// 直接 wrap 起来让中栏内部从 BSIM3 标题及其内容组成. 这里我们保持 BSIM3 内容原样.

// 构造新的 Side Panel: 顶部 Tab nav + 主体内容切换
const sidePanelHeader =
  '<div style={{ display: "flex", alignItems: "stretch", borderBottom: `1px solid ${WB.border}`, background: WB.menuBg, flexShrink: 0 }}>' +
  '<button type="button" onClick={() => setSidePanelTab("steps")} style={{ flex: 1, padding: "8px 10px", border: 0, borderRight: `1px solid ${WB.border}`, cursor: "pointer", fontSize: 12, fontWeight: sidePanelTab === "steps" ? 700 : 500, color: sidePanelTab === "steps" ? WB.primary : WB.textSm, background: sidePanelTab === "steps" ? WB.panelBg : "transparent", fontFamily: ff }}>Transfer Steps</button>' +
  '<button type="button" onClick={() => setSidePanelTab("params")} style={{ flex: 1, padding: "8px 10px", border: 0, cursor: "pointer", fontSize: 12, fontWeight: sidePanelTab === "params" ? 700 : 500, color: sidePanelTab === "params" ? WB.primary : WB.textSm, background: sidePanelTab === "params" ? WB.panelBg : "transparent", fontFamily: ff }}>BSIM3 参数{simulating && <span style={{ fontSize: 10, color: WB.warning, marginLeft: 4 }}>Sim...</span>}</button>' +
  '</div>';

// 左栏 (Transfer Steps 页) 改造: padding 12 → 第一行 padding 改为 12 12 0;
// 在左栏 div 直接子内容之前插入一个 wrapper:
//   <div style={{ padding: 12, gap: 10, display: "flex", flexDirection: "column", flex: 1, overflowY: "auto", minHeight: 0 }}>
//     (左栏原有 children 维持不变, 但需要去掉顶层 div 的 padding/gap 让 inner 接管)
//
// 上面的 leftRewrapped 已经把 width/padding/gap 改. 但我让左栏整体包一层 inner:
// 找到左栏的 opening <div 后的第一个 children, 包一层.

// 简化方案: 不用 wrap, 直接让 left 内部不增 padding, 用 div style={{ padding: '12px 12px 0', overflowY: 'auto', flex: 1 }} 把内容包起来. 但 content 包含外层 <div> 不容易插入.

// 重新方案: 左栏已经 padding=0、gap=0, 所以内部要补 padding/gap. 我在 leftRewrapped 里,
// 在 opening div 后面立刻插入:
const leftInnerWrap =
  '<div style={{ padding: 12, gap: 10, display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflowY: "auto" }}>';

// 找到左栏 div opening 结束的 '>' 后插入 leftInnerWrap
// leftRewrapped 结构: '{/* ===== 左栏... */}\n      <div style={{ ... width: 320 ... overflowY: "hidden", }}>\n  ...'
// 我们在 'overflowY: "hidden", }}>' 之后的第一行插入 inner
const insertAt = leftRewrapped.indexOf('overflowY: "hidden", }}>') + 'overflowY: "hidden", }}>'.length;
const leftFinal = leftRewrapped.substring(0, insertAt) + '\n        ' + leftInnerWrap + '\n        ' + leftRewrapped.substring(insertAt);
// 在最后闭合左栏 div 之前, 加 </div>:
// 左栏原以 '</div>' 闭合 (在 fit scope block 后). 这里我们添加 wrapper 闭合.
const leftFinal2 = leftFinal.replace(
  '        </div>\n      </div>\n\n      {/* ===== 中栏',
  '        </div>\n        </div>\n      </div>\n\n      {/* ===== 中栏'
);

// 中栏 (BSIM3) 同样需要去掉内联 BSIM 标题 (改用 tab header 替代)
const midFinal = midRewrapped.replace(
  '<div style={{\n          padding: "12px 16px 8px",\n          borderBottom: "1px solid var(--border)",\n          fontWeight: 600, fontSize: 13,\n          display: "flex", alignItems: "center", gap: 8,\n        }}>\n          BSIM3 参数\n          {simulating && <span style={{ fontSize: 10, color: "var(--warning)" }}>Sim...</span>}\n        </div>',
  ''
);

const sidePanelContent = '      {/* ==== 侧边栏: Transfer Steps / BSIM3 切换 ==== */}\n      <div style={{ display: "flex", flexDirection: "column", width: 320, borderRight: `1px solid ${WB.border}`, background: WB.panelBg, flexShrink: 0, minHeight: 0, overflow: "hidden" }}>\n' + sidePanelHeader + '\n' +
  '{sidePanelTab === "steps" ? (\n          <>\n' + leftFinal2.substring(leftFinal2.indexOf('width: 320')) + '\n          </>\n        ) : (\n          <>\n            ' + midFinal + '\n          </>\n        )}\n      </div>';

// 现在替换原 3 段
// 找到 leftMark 到 rightMark 的整段, 替换成 sidePanelContent; 但 rightBody 不变.
const before = src.substring(0, leftMark);
const after = src.substring(rightMark);
// rightBody 已经在 `rightMark..endMark`, 把它放回 sidePanelContent 后:
// 用 raw 拼: src = before + sidePanelContent + (rightBody 之前的注释或直接 rightBody)
// 需要 rightBody 完整: from rightMark to endMark
const rightBodyFull = src.substring(rightMark, endMark);

// 把 leftMark 起的整段 (left+mid) 替换
src = before + sidePanelContent + '\n\n      ' + rightBodyFull;

fs.writeFileSync(path, src);
console.log('OK, size now', src.length);