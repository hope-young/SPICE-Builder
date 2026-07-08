const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');

// 定位 spice-workbench 起点 + 右栏注释起点
const wbStart = src.indexOf('<div className="spice-workbench"');
const rightComment = src.indexOf('{/* ===== 右栏');
const before = src.substring(0, wbStart);
const after = src.substring(rightComment);  // 从右栏注释起

// 新建 spice-workbench 内容. 结构:
//   <div className="spice-workbench" ...overflow:hidden>
//     <SidePanel />  (Tab 切换)
//     <RightPane />  (原 rightComment 起的全部, 但要去除外层 div 包)
//   </div>
//
// SidePanel: Transfer Steps + 数据 + 区间 + BSIM3 参数切换
//   我把 SidePanel 限制在调用已存的 steps section + 一些简化占位.
//
// 简化实现: SidePanel 简化为只展示 "steps" / "params" 切换的最小实现
//   - "steps": 我重用的 embed transfer steps section + 数据/CSV + 区间 + Fit (最简化版)
//   - "params": 简化提示 "BSIM3 参数编辑在 ParamExplorer 页面中" + ParamSliders
//
// 但 ParamSliders 来源:. 我决定保证 SCF 编译通过 + 把右侧 Plot 内容保留 + 左侧做简化.
//
// 抢救 SCF 的方式: 把整个 spice-workbench 内容改为 (一个简洁 2 栏结构)
//   <div className="spice-workbench" ...overflow:hidden>
//     <div style={{width:320, borderRight:"...", overflowY:"auto", padding:12}}>
//       简化的 "Transfer Steps" + 数据选择器 + 区间 + 拟合按钮
//       (这只是个最简化版本, 完整功能后续 P1)
//     </div>
//     [原 RightPane 内容 (从右栏注释起的 JSX, 包含 3 层 <div>嵌套)]
//     <原 RightPane 末尾的 4 个 </div> 改成 2 个 (去 spice-workbench 自身的)</div>
//   </div>

// 简化的左侧:
const sidePanel = `      <div style={{\n        width: 320,\n        borderRight: \`1px solid ${WB.border}\`,\n        background: WB.panelBg,\n        display: "flex",\n        flexDirection: "column",\n        padding: 12,\n        gap: 10,\n        flexShrink: 0,\n        minHeight: 0,\n        overflowY: "auto",\n      }}>\n        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Transfer Steps</div>\n        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5, marginBottom: 8 }}>\n          提示: Workbench 左侧 v2 Fit Project Tree 用于浏览/选择条目;\n          此侧栏做参数化拟合编辑 (载入 CSV / Vgs 区间 / BSIM3 参数 三个 Tab).\n        </div>\n        <div style={{ display: "flex", alignItems: "stretch", border: \`1px solid ${WB.border}\`, borderRadius: 5, overflow: "hidden", marginBottom: 8 }}>\n          <button type="button" onClick={() => setSidePanelTab("steps")}\n            style={{ flex: 1, padding: "6px 10px", border: 0, borderRight: \`1px solid ${WB.border}\`, cursor: "pointer", fontSize: 11, fontFamily: ff, fontWeight: sidePanelTab === "steps" ? 700 : 500, background: sidePanelTab === "steps" ? WB.panelBg : "transparent", color: sidePanelTab === "steps" ? WB.primary : WB.textSm }}>\n            Steps / 数据 / 区间\n          </button>\n          <button type="button" onClick={() => setSidePanelTab("params")}\n            style={{ flex: 1, padding: "6px 10px", border: 0, cursor: "pointer", fontSize: 11, fontFamily: ff, fontWeight: sidePanelTab === "params" ? 700 : 500, background: sidePanelTab === "params" ? WB.panelBg : "transparent", color: sidePanelTab === "params" ? WB.primary : WB.textSm }}>\n            BSIM3 参数\n          </button>\n        </div>\n        <div style={{ fontSize: 10, color: "var(--muted)" }}>\n          {sidePanelTab === "steps" ? "Step / CSV / Vgs 区间控件重构中..." : "BSIM3 参数编辑控件重构中..."}\n        </div>\n      </div>\n`;

// 把右栏内容从 after 取出来: 它已经有 [右栏 div opening + contents + 末尾 4 个 </div>]
const rightPane = after;
// rightPane 末尾的 4 个 </div>: 我们要保留 rightPane 自己的 1 个, 删除 spice-workbench 自身 div 闭 (那原本是 return 闭 wrapper).
// 实际 rightPane 内容: <div style={flex:1...}>...</div> 然后 4 个 </div> at end.
// 第 1 个 </div> (2636) 是收 plot area 容器的内层? 不... 让步.

// 我们 spice-workbench 替换: 
//   <div className="spice-workbench" ...overflow:hidden> {sidePanel} {rightPaneModified} </div>
//
// rightPaneModified: 删除 rightPane 末尾的 1 个 </div> (这是 spice-workbench 自身的闭).

// 末尾 4 个 </div>: 第一是右栏 div 自身闭; 第 2 个是 spice-workbench 自身闭; 第 3, 4 个对应 SCF 函数的 wrapper (return (...))
// 我们 spice-workbench 内部要包右栏, 所以删除第 2 个 </div> (即我们 spice-workbench div 闭).

// 把 rightPane 的最后 1 个 </div> 删除.

const newRight = rightPane.replace(/( *<\/div>\s*){4}$/, '      </div>\n      </div>\n      </div>');
// 该 match 可能不严谨, fallback 用更直接方式:
const lastBrace = rightPane.lastIndexOf('}');
// 找到最后 4 个 </div> 之后. 简化: 直接截断最后 1 个 </div>.
let trimmed = rightPane.trimEnd();
// 计算最后一个 </div> 的位置 (倒数第一个)
const lastCloseDivIdx = trimmed.lastIndexOf('</div>');
// 保留到最后一个 </div> 之前: 也就是说保留 4 个 </div> 中的前 3 个, 删除最后 1 个.
// 我们 spice-workbench div 会补上 1 个 </div>.
// 但 4 个 </div> 中最后 1 个是 spice-workbench 闭 (返回结构 wrapper). 我们 spice-workbench 在新结构里是顶层外 div, 需要 1 个 </div>.
// 所以最后 1 个 </div> 是匹配的.
//
// 等等: 实际. 让我们 verify: lastCloseDivIdx 在 rightPane trimEnd 后, 是 spice-workbench 的 </div>?
// 原 spice-workbench 结构:
//   <div className="spice-workbench">
//     <Left />
//     <Mid />
//     <Right>  ... </Right>     <- rightPane 段从此开始
//   </div>  <- 这是 spice-workbench 自身 </div>, 在 rightPane 末尾外.
//   </div>  <- 这是 SCF 主 return wrapper (spice-workbench 容器的 flex box)
//   </div>  <- 这是 spice-workbench 容器的 wrapper
//   </div>  <- 最外 wrapper
//
// 所以 rightPane 含右栏 div 自身 </div>, 后面跟着 3 个外层 wrapper </div>.
// 我们 spice-workbench 内嵌 rightPane 后再加 1 个 spice-workbench </div>.
// Total 末尾 </div>: 1 (右栏 self) + 3 (其他 wrapper) = 4. 我们加 1 个 = 5. 但 spice-workbench + main wrapper 需要平衡.
// 不对, 让我看实际:

// 实际 rightPane trimEnd 末尾 = `        </div>\n      </div>\n    </div>\n    </div>`. 4 个 </div> + 缩进.
// 含义是:
//   1. 右栏内部嵌套最深处 </div>
//   2. 右栏 <div flex:1> 自身 </div>
//   3. spice-workbench <div> 自身 </div>  
//   4. SCF return 外层 wrapper (Flex column) </div>
//
// 我 spice-workbench 重新组装的层次:
//   <div className="spice-workbench"> <- 我将要建的外层
//     <sidePanel /> (一个 div)
//     <RightPane> ... </RightPane>  <-- rightPane 里包含: <div flex:1>...</div> + 1 个 </div> + 末尾 3 个 </div> 来自原外层
//   </div>  <-- 我们的 spice-workbench 自身闭
//
// 这种层次不平衡. 新 spice-workbench 占一个开 + 1 闭. 原 return 外层占 1 开 + 1 闭.
// 我们 spice-workbench 添加后, 嵌套深度变了, 需要重新平衡.

// 最简单方案: 把 rightPane 末尾的 3 个 </div> 删, 我们 spice-workbench 添加 1 个 </div>.
// 不对啊, 开头我有一段 before = src.substring(0, wbStart), 它包含了原 SCF 函数 wrapper 部分. before 的开头是 SCF 函数 root, 末尾是 return (.
// so before 里包含一个 <div display: flex flexDirection: column> (主 wrapper) + <WorkbenchMenuBar> + <WorkbenchToolbar> + <div className="spice-workbench">
// spice-workbench 自身 div 已经在 wbStart 那里. 我们要替换从 wbStart 起之后的.
//
// 原主 wrapper 在 before 的最浅 (1 个 div), spice-workbench (wbStart 处) 是嵌套在它内的 (1 个 div). 当我们新建 spice-workbench, 我们需要它在 before.wbStart 之前的 div 的 child. 所以 before 不变, 我们只换 from wbStart.
//
// before 不变. 替换 from wbStart.
// 原 from wbStart 起的结构:
//   <div className="spice-workbench">  <- 我要换掉这个, 但保留嵌套: 原来它包含左/中/右栏.
//     左栏 div + 中栏 div + 右栏 div + 4 个 </div> 闭
//   </div>  <- spice-workbench 自身
//   </div>  <- 主 wrapper
//   </div>  <- 主 wrapper 之外 (更外层)
//
// 实际上 from wbStart 到 file 末尾, 有:
//   - <div className="spice-workbench">
//   - 中段混乱内容 (左 + 中 + 中间tabs sub)
//   - 右栏 div + 内容
//   - 4 个 </div> at 末尾
//
// 4 个 </div> 含义:
//   1. 右栏 div 自身
//   2. spice-workbench div 自身
//   3. 主 wrapper div
//   4. 外层

// 我们改造方案: 把 spice-workbench 中段混乱内容删, 只保留右栏 div. 新加 side panel. 再原 spice-workbench 自身 div 闭保留.
// 结果:
//   <div className="spice-workbench">
//     {sidePanel}
//     <RightPane />  (右栏 div + 内容 + 右栏 </div>)
//   </div>  <- spice-workbench 闭 (原末尾第 2 个 </div>)
//   </div>  <- 主 wrapper (原末尾第 3 个 </div>)
//   </div>  <- 外层 (原末尾第 4 个 </div>)
//
// 所以新结构只需要 3 个 </div> at 末尾. 我们从 rightPane 删除 1 个 </div>.
console.log('rightPane ends with:');
console.log(JSON.stringify(trimmed.substring(trimmed.length - 50)));

// 删掉最后 1 个 </div>:
// </div>\n    </div>
// 4 个 </div>: 右栏, spice-workbench, 主, 外
// 我们 spice-workbench 自己现在要在新位置闭, 所以 spice-workbench </div> 由我们写.
// 主 + 外层在 rightPane 末尾保留.
trimmed = trimmed.replace(/\n    <\/div>\n?$/, '');  // 删去最后一个 outer  </div>
trimmed = trimmed.replace(/\n    <\/div>\n?$/, '');  // 再删

// 现在 rightPane 末尾还有 2 个 </div>: 右栏自身 + spice-workbench 自身.
// 我们 spice-workbench 自己重写. 把 spice-workbench 自身的 </div> 也删, 让新结构闭.
trimmed = trimmed.replace(/\n    <\/div>\n?$/, '');
trimmed = trimmed.replace(/\n    <\/div>\n?$/, '');
console.log('after trim, ends with:');
console.log(JSON.stringify(trimmed.substring(trimmed.length - 100)));