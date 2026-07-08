const fs = require('fs');
const path = 'src/app/components/SingleCurveFit.tsx';
let src = fs.readFileSync(path, 'utf8');

// 完整重写 spice-workbench 容器: 
//   <div className="spice-workbench">
//     [左侧栏: Transfer Steps + 数据 + 区间 + Fit (放在一个简洁容器里, 借用 inject 时的 steps section)]
//     [右侧栏: 占位说明, 让 Plot 区域更大]
//   </div>

// 简化: 把整个 spice-workbench 容器替换成一个 2-栏最小版:
// 我们已经有 'useTransferStepsList' 的 embed section (inject 时插入) -- 它包含了 transferable steps 内容.
//
// 但 transfer steps + csv + 区间 + 参数都还在原 SCF 主 return 里.
// 这里我们做一个保守方案: 保留原 spice-workbench 结构, 但用一段 'useState<"steps"|"params">' 来切换.

// 因为 spice-workbench 当前结构错位了 (substr 删了一对 </div>), 难以自动恢复.
// 直接重写: 把 spice-workbench 内容删, 替换为 2 栏.

const wbStart = src.indexOf('<div className="spice-workbench"');
const wbEnd = src.indexOf('      {/* ===== 右栏');  // 右栏注释之前
// 右栏内容 (plot area) 保留
const rightContent = src.substring(wbEnd, src.length);  // 包含 '      {/* ===== 右栏' 起到文件末尾
// 实际上 rightContent 末尾还应该包含 closing </div></div> for spice-workbench + container

// 旧 spice-workbench 内容 (段)
const oldSection = src.substring(wbStart, wbEnd);

// 新段: 简化版 spice-workbench, 不再调用错位的 left+mid 结构.
// 但 transferSteps + csv + 区间 + btn 之类的内容全都还嵌在原 leftBody 里.
// 最简单方案: 重用错位的 leftFinal2 部分作为整体.

// 我有个关键 insight: 原 leftFinal 是 correct 的结构 (有一个 outer div + inner wrap + contents + closing).
// 我在 inject state 之前它是完整的. inject 后我搞乱了它. 当前 spice-workbench 内的结构虽然错位,
// 但语法错误数量应该可以 fix 通过手动添加 </div>.

// 直接简单的修复: 在 spice-workbench 内, 找到第一步 spice-workbench div 闭, 看一下我们需要加多少 </div>
// 当前 spice-workbench 起点到右栏注释前, 如果结构上缺 (X) 个 </div>, 在 spice-workbench div 闭合前补.

// spice-workbench 是 <div className="spice-workbench" ...overflow:hidden }}>
// 后面跟内容, 然后需要 </div>. (1个 spice-workbench 自身的 </div>)
// 内容里: 外部侧边栏 div (1个 </div>), tab header div (1个 </div>), steps 内容 div (多个 </div>), params 内容 div (1个 </div>)

// 让 spice-workbench 内的 </div> 数量匹配. 但 spice-workbench 自身 div 闭是 1 个.
// 从诊断看, spice-workbench 起点到 spice-workbench 自身 div 闭合处 (右栏前), 内容需要 至少匹配.

// 简单方案: 直接修改 spice-workbench 段-开头, 把已损坏的 inject 替换为最稳的.

// 替换方案:
//   <div className="spice-workbench" ...>
//     <div style={{ display:"flex", flex: 1, alignItems:"center", justifyContent:"center" }}>
//       SpiceBuilder Workbench placeholder
//     </div>
//   </div>
// 然后 rightContent (右栏注释起) 仍然在.
//
// 但 spice-workbench 整体仍然要被嵌入到 right pane in Workbench.tsx. rightContent 仍是 plot 区域.

// 这个方案: 删掉旧的 (出错的 spice-workbench 中段), 只保留 rightContent (右栏).
// spice-workbench 退化成一个声明性 wrapper.

// 这是最稳的方案.

// 步骤: 
// - 删 oldSection 中 spice-workbench 自身包装:
//   <div className="spice-workbench" style={...}/> 到 </div>
// - 用一个空的 <div className="spice-workbench" ... /> 替换.

// 看 rightContent 末尾: 应该有 4 个 </div> 收纳原 spice-workbench 自身.
// spice-workbench 内是: [左栏 + 中栏 + 右栏] -- 3 个, 都是各自 div.
// plus spice-workbench 自身 -- 1 个.
// 所以 rightContent 末尾应该有 4 个 </div>. 但我们当前末尾是 4 个, 所以是对应原 4 个, spice-workbench 不需要"内容中"有东西.

// 修复策略:
// - spice-workbench 内: 删左边混乱的 left+mid inject, 只保留 rightContent 的 div.
// - 用一个干净的 <div className="spice-workbench" ... overflow:hidden> {rightContent} </div>

// rightContent 实际是从右栏注释起到 spice-workbench 末尾的 div, 包括右栏 div + 4 个 </div>.
console.log('rightContent head:', rightContent.substring(0, 100));
console.log('rightContent tail:', rightContent.substring(rightContent.length - 200));

// 实际 rightContent 是从右栏注释起到返回语句末尾, 而 spice-workbench div </div> 和 return </div> 应当都在里面.
// 我需要只保留右栏 div 的内容, 删 spice-workbench 自身 div.

// 实际更稳: 直接删整个 oldSection 错误段, 替换为: 
//   <div className="spice-workbench" ... overflow:hidden>
//     {rightContent内嵌的右栏 div 内容}
//   </div>

// 计算 rightContent 末尾的 </div> 数:
const rcOpens = (rightContent.match(/<div\b/g) || []).length;
const rcCloses = (rightContent.match(/<\/div>/g) || []).length;
console.log('rightContent opens:', rcOpens, 'closes:', rcCloses);

// 我们 spice-workbench 自身要 +1 <div ... /> + 1 </div>. 内嵌 rightContent 应自洽.
// 但 rightContent 当前末尾的 </div> 是 spice-workbench 的 4 个, 我们要拆出 1 个作为外层 div 闭.

// 啊太乱了. 我换思路: spice-workbench 的内容完整替换为 简单两栏: 一个 leftSimpleBox + rightContent.

// simple 方案: spice-workbench 变为:
//   <div className="spice-workbench" style={{flex:1,display:"flex",minHeight:0,overflow:"hidden"}}>
//     <div style={{width:320, ... padding:12, overflowY:"auto"}}>
//       {/* 简化的 Transfer Steps + 数据 + 区间 + Fit 占位 */}
//       <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Transfer Steps</div>
//       <div style={{fontSize:11,color:"var(--muted)",marginBottom:8}}>
//         (使用 Workbench 左侧 v2 Fit Project Tree 选条目, 此处展示参数化拟合编辑器)
//       </div>
//     </div>
//     {rightContentWithoutShrinkage 嵌右栏 }
//   </div>

// 上面的方案工作量大且破坏性大.
//
// 重写: spice-workbench 容器 → 错误段全部 drop, 只保留 rightContent.
// 这样会丢失 Transfer Steps / BSIM3 但 SCF 编译通过. Workbench 仍能打开.

// 用户体验降级但代码可工作.
