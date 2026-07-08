const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');

// 步骤:
// 1. 找到 wbStart = `<div className="spice-workbench"`, 然后 spice-workbench 开 div (在 'overflow:hidden' 之后 '}}>')
// 2. 找到右栏注释 `{/* ===== 右栏`, 这是右栏 div open.
// 3. 在 spice-workbench 内替换内容:
//    - 删除 spice-workbench 开 div 之后到右栏注释前的内容 (这是混乱的中段)
//    - 插入一段简洁的 side panel div
//    - spice-workbench 把 side panel + 右栏包裹起来.
//
// 注意 spice-workbench 自身 div 已经存在, 我们替换其 *内容*.
// 但内容混乱的根源是: 我们 "<div style= width:320 overflowY:hidden>" 开了没闭.
// + tabs ternary fragment 也混乱.
//
// 实施方案: 我们在 wbStart 之后, 找到下一行 "{/* ==== 侧边栏" 或 tabs header, 删到有 "{/* ===== 右栏" 为止的内容, 然后插:
//   const sidePanel = `{sidePanel 内容}`;
//   const tabsHeader = `{tab buttons}`;
//   {tabs header}{tabs ternary 包含 fit scope + 数据 + 区间 + params 简化版}
//   再保留原 {rightPane}. 

const wbStart = src.indexOf('<div className="spice-workbench"');
const rightStart = src.indexOf('{/* ===== 右栏', wbStart);
const wbOpenEnd = src.indexOf('}>', wbStart) + 2;
console.log('wbStart', wbStart, 'wbOpenEnd', wbOpenEnd, 'rightStart', rightStart);

// 1. spice-workbench 开 div 自身保留
// 2. 把 wbOpenEnd 到 rightStart 之间清空 (混乱段), 重新写.

// 新的 spice-workbench 内容:
const newSection = [
  // 外部 side panel div
  '      <div style={{ display: "flex", flexDirection: "column", width: 320, borderRight: `1px solid ${WB.border}`, background: WB.panelBg, flexShrink: 0, minHeight: 0, overflow: "hidden" }}>',
  // tabs header
  '        <div style={{ display: "flex", alignItems: "stretch", borderBottom: `1px solid ${WB.border}`, background: WB.menuBg, flexShrink: 0 }}>',
  '          <button type="button" onClick={() => setSidePanelTab("steps")} style={{ flex: 1, padding: "8px 10px", border: 0, borderRight: `1px solid ${WB.border}`, cursor: "pointer", fontSize: 12, fontWeight: sidePanelTab === "steps" ? 700 : 500, color: sidePanelTab === "steps" ? WB.primary : WB.textSm, background: sidePanelTab === "steps" ? WB.panelBg : "transparent", fontFamily: ff }}>Steps / 区间</button>',
  '          <button type="button" onClick={() => setSidePanelTab("params")} style={{ flex: 1, padding: "8px 10px", border: 0, cursor: "pointer", fontSize: 12, fontWeight: sidePanelTab === "params" ? 700 : 500, color: sidePanelTab === "params" ? WB.primary : WB.textSm, background: sidePanelTab === "params" ? WB.panelBg : "transparent", fontFamily: ff }}>BSIM3 参数</button>',
  '        </div>',
  // content area (scrollable)
  '        <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 0", display: "flex", flexDirection: "column", gap: 10 }}>',
  // steps tab content
  '          {sidePanelTab === "steps" ? (',
  '            <div>',
  '              <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.35, marginBottom: 10 }}>',
  '                Workbench 左栏 v2 Fit Project Tree 用于浏览/选择; 此侧栏做参数化拟合编辑 (Steps / 数据 / Vgs 区间).',
  '              </div>',
  // fit scope / 数据 / 区间  -- 还没接入具体功能
  '              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Fit Scope</div>',
  '              <div style={{ fontSize: 11, color: "var(--muted)" }}>fitScopeSummary.count = {fitScopeSummary.count} (active targets)</div>',
  // 数据
  '              <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700 }}>数据</div>',
  '              <div style={{ fontSize: 11, color: "var(--muted)" }}>当前 Step (Vds = {vds} V). 在 Workbench 内导入 CSV 后此处可显示.</div>',
  '              <Button variant="primary" size="sm" onClick={onLoad} disabled={loading} style={{ marginTop: 6 }}>',
  '                <Upload size={13} style={{ marginRight: 6 }} />',
  '                {loading ? "加载中..." : "Load CSV"}',
  '              </Button>',
  // Vgs 区间
  '              <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700 }}>Vgs 区间</div>',
  '              <div style={{ display: "flex", gap: 8 }}>',
  '                <label style={{ fontSize: 11, flex: 1 }}>',
  '                  <div style={{ marginBottom: 2 }}>min (V)</div>',
  '                  <input type="number" value={vmin} step={0.01} onChange={e => setVmin(parseFloat(e.target.value) || 0)} style={{ width: "100%", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, padding: "3px 6px", boxSizing: "border-box" }} />',
  '                </label>',
  '                <label style={{ fontSize: 11, flex: 1 }}>',
  '                  <div style={{ marginBottom: 2 }}>max (V)</div>',
  '                  <input type="number" value={vmax} step={0.01} onChange={e => setVmax(parseFloat(e.target.value) || 0)} style={{ width: "100%", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, padding: "3px 6px", boxSizing: "border-box" }} />',
  '                </label>',
  '              </div>',
  '              <div style={{ fontSize: 11, color: "var(--muted)" }}>区间内 {inRange} pts</div>',
  '              <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700 }}>停止条件 / Fit</div>',
  '              <div style={{ fontSize: 11, color: "var(--muted)" }}>(完整 fit 控制后续 P1 接入; 目前 Plot 仍渲染.)</div>',
  '            </div>',
  '          ) : (',
  // params tab content - simplified
  '            <div>',
  '              <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.35, marginBottom: 10 }}>',
  '                BSIM3 参数分类编辑. 完整 ParamSliders 在 ParamExplorer 页面, 此处将在 Workbench 中恢复.',
  '              </div>',
  '              <ParamSliders values={pvals} checked={checked} locked={lockedParams} onChange={onParamChange} onCheck={onCheck} onToggleLock={onToggleLock} onReset={onReset} onResetCat={onResetCat} bounds={customBounds} onBoundsChange={(name, next) => setCustomBounds(prev => ({ ...prev, [name]: next }))} onResetBounds={(name) => setCustomBounds(prev => { const n = { ...prev }; delete n[name]; return n; })} onResetCatBounds={(cat) => setCustomBounds(prev => { const n = { ...prev }; for (const p of BSIM3_PARAMS.filter(item => item.category === cat)) delete n[p.name]; return n; })} />',
  '            </div>',
  '          )}',
  '        </div>',  // close side panel content area
  '      </div>',  // close 外部 side panel div
  '',
].join('\n');

const before = src.substring(0, wbOpenEnd);
const after = src.substring(rightStart);
const newSrc = before + '\n' + newSection + '\n\n      ' + after;
fs.writeFileSync(process.argv[2], newSrc);
console.log('written. new size:', newSrc.length);