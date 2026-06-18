import { useState } from "react";
import {
  Upload, FileText, Trash2, Eye, EyeOff, AlertTriangle,
  ChevronDown, CheckCircle2, Filter, RefreshCw
} from "lucide-react";

const C = {
  bg: "#ffffff", surface: "#fafafa", border: "#e5e5e5",
  text: "#2c2c2c", muted: "#6b7280",
  primary: "#0d99ff", success: "#14ae5c", warning: "#ffcd29", error: "#f24822",
  accent: "#e6f4ff", hover: "#f5f5f5",
};
const ff = "'Inter', 'Segoe UI', system-ui, sans-serif";
const mono = "'JetBrains Mono', 'Consolas', monospace";

const files = [
  { name: "IRFS4321_Id_Vg_25C.csv",  type: "Id-Vg",  temp: "25°C",  points: 2048, status: "clean",   visible: true },
  { name: "IRFS4321_Id_Vg_125C.csv", type: "Id-Vg",  temp: "125°C", points: 2048, status: "clean",   visible: true },
  { name: "IRFS4321_Id_Vd_25C.csv",  type: "Id-Vd",  temp: "25°C",  points: 4096, status: "clean",   visible: true },
  { name: "IRFS4321_Id_Vd_125C.csv", type: "Id-Vd",  temp: "125°C", points: 4096, status: "warning", visible: true },
  { name: "IRFS4321_Ciss_Coss.csv",  type: "C-V",    temp: "25°C",  points: 512,  status: "clean",   visible: true },
  { name: "IRFS4321_Qg_25C.csv",     type: "Qg",     temp: "25°C",  points: 256,  status: "clean",   visible: true },
  { name: "IRFS4321_If_Vf_25C.csv",  type: "If-Vf",  temp: "25°C",  points: 512,  status: "clean",   visible: false },
];

const generateRows = () => {
  const rows = [];
  const vgsVals = [0.0, 0.5, 1.0, 1.5, 1.8, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
  const vdsVals = [0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 30.0];
  for (let i = 0; i < 60; i++) {
    const vgs = vgsVals[i % vgsVals.length];
    const vds = vdsVals[Math.floor(i / vgsVals.length) % vdsVals.length];
    const vth = 1.84;
    const id = vgs > vth
      ? Math.max(0, ((vgs - vth) ** 1.8 * 0.42 * Math.min(1, vds / ((vgs - vth) * 0.7))) * (1 + Math.random() * 0.02 - 0.01))
      : Math.exp((vgs - vth) / 0.064) * 1e-7 * (1 + Math.random() * 0.05 - 0.025);
    const temp = i % 3 === 0 ? 125 : 25;
    const outlier = i === 14 || i === 37;
    rows.push({
      idx: i + 1,
      vgs: vgs.toFixed(2),
      vds: vds.toFixed(2),
      id: outlier ? (id * 2.3).toExponential(3) : id < 0.001 ? id.toExponential(3) : id.toFixed(4),
      temp,
      flag: outlier ? "outlier" : "",
      meas: `M${String(i + 1).padStart(3, "0")}`,
    });
  }
  return rows;
};

const tableData = generateRows();

const stats = [
  { label: "Total Points", value: "18,432", sub: "across 7 files" },
  { label: "After Cleaning", value: "17,905", sub: "527 removed (2.9%)" },
  { label: "Vgs Range", value: "0 – 5 V", sub: "step 0.5 V" },
  { label: "Id Range", value: "50 nA – 38 A", sub: "6 decades" },
  { label: "Vds Range", value: "0.1 – 30 V", sub: "8 bias points" },
  { label: "Temperatures", value: "25, 125°C", sub: "2 corner temps" },
];

export function DataBrowser() {
  const [activeFile, setActiveFile] = useState(0);
  const [activeTab, setActiveTab] = useState<"raw" | "cleaned" | "stats">("raw");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set([14, 37]));
  const [showOutliers, setShowOutliers] = useState(true);

  const displayRows = showOutliers ? tableData : tableData.filter(r => !r.flag);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: C.bg, fontFamily: ff }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.text }}>Data Browser</h1>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>Load, inspect, and clean raw measurement data</div>
        </div>
        <button style={btnOutline}><Filter size={13} style={{ marginRight: 4 }} />Filter</button>
        <button style={btnOutline}><RefreshCw size={13} style={{ marginRight: 4 }} />Reload</button>
        <button style={{ ...btnPrimary, gap: 6, display: "flex", alignItems: "center" }}>
          <Upload size={13} />Load Files
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* File panel */}
        <div style={{ width: 240, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", backgroundColor: C.surface }}>
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Loaded Files ({files.length})
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {files.map((f, i) => (
              <div
                key={i}
                onClick={() => setActiveFile(i)}
                style={{
                  padding: "8px 12px",
                  borderBottom: `1px solid ${C.border}`,
                  backgroundColor: activeFile === i ? C.accent : "transparent",
                  cursor: "pointer",
                  transition: "background-color 0.08s",
                }}
                onMouseEnter={e => { if (activeFile !== i) (e.currentTarget as HTMLElement).style.backgroundColor = C.hover; }}
                onMouseLeave={e => { if (activeFile !== i) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <FileText size={12} color={activeFile === i ? C.primary : C.muted} />
                  <span style={{ fontSize: 11, fontWeight: 500, color: activeFile === i ? C.primary : C.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.name}
                  </span>
                  {f.status === "warning" && <AlertTriangle size={11} color={C.warning} />}
                  {f.status === "clean" && <CheckCircle2 size={11} color={C.success} />}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 4, paddingLeft: 18 }}>
                  <span style={{ fontSize: 10, color: C.muted, backgroundColor: C.hover, padding: "1px 5px", borderRadius: 3 }}>{f.type}</span>
                  <span style={{ fontSize: 10, color: C.muted }}>{f.temp}</span>
                  <span style={{ fontSize: 10, color: C.muted }}>{f.points.toLocaleString()} pts</span>
                </div>
              </div>
            ))}
          </div>

          {/* Cleaning ops */}
          <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Cleaning</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {[
                { label: "Remove 3σ outliers", active: true },
                { label: "Interpolate missing", active: false },
                { label: "Smooth noise (SG)", active: false },
                { label: "Temp compensate", active: true },
              ].map((op, i) => (
                <label key={i} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }}>
                  <input type="checkbox" defaultChecked={op.active} style={{ accentColor: C.primary, width: 12, height: 12 }} />
                  <span style={{ fontSize: 11, color: C.text }}>{op.label}</span>
                </label>
              ))}
            </div>
            <button style={{ ...btnPrimary, width: "100%", marginTop: 10, justifyContent: "center", fontSize: 11 }}>Apply Cleaning</button>
          </div>
        </div>

        {/* Main data area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* File header */}
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10, backgroundColor: C.surface }}>
            <FileText size={14} color={C.primary} />
            <span style={{ fontSize: 13, fontWeight: 500, color: C.text, fontFamily: mono }}>{files[activeFile].name}</span>
            <span style={{ fontSize: 11, color: C.muted }}>·</span>
            <span style={{ fontSize: 11, color: C.muted }}>{files[activeFile].points.toLocaleString()} measurement points</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setShowOutliers(v => !v)}
              style={{ ...btnXs, display: "flex", alignItems: "center", gap: 4, color: showOutliers ? C.warning : C.muted }}
            >
              {showOutliers ? <Eye size={11} /> : <EyeOff size={11} />}
              {showOutliers ? "Outliers visible" : "Outliers hidden"}
            </button>
            <button style={btnXs}><Trash2 size={11} style={{ marginRight: 3 }} />Remove file</button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, padding: "0 16px", backgroundColor: C.bg }}>
            {(["raw", "cleaned", "stats"] as const).map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                style={{
                  padding: "8px 14px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500,
                  backgroundColor: "transparent", fontFamily: ff,
                  color: activeTab === t ? C.primary : C.muted,
                  borderBottom: activeTab === t ? `2px solid ${C.primary}` : "2px solid transparent",
                  textTransform: "capitalize",
                }}
              >
                {t === "raw" ? "Raw Data" : t === "cleaned" ? "Cleaned" : "Statistics"}
              </button>
            ))}
          </div>

          {activeTab === "stats" ? (
            <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
              {stats.map(s => (
                <div key={s.label} style={{ ...miniCard }}>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: C.text, fontFamily: mono }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{s.sub}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ flex: 1, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead style={{ position: "sticky", top: 0, backgroundColor: C.surface, zIndex: 1 }}>
                  <tr>
                    <th style={th}><input type="checkbox" style={{ accentColor: C.primary }} /></th>
                    {["#", "Meas ID", "Vgs (V)", "Vds (V)", "Id", "Temp (°C)", "Flag"].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row, i) => (
                    <tr
                      key={row.idx}
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        backgroundColor: row.flag ? "#fff8e8" : selectedRows.has(i) ? C.accent : "transparent",
                      }}
                      onMouseEnter={e => { if (!row.flag && !selectedRows.has(i)) (e.currentTarget as HTMLElement).style.backgroundColor = C.hover; }}
                      onMouseLeave={e => { if (!row.flag && !selectedRows.has(i)) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                    >
                      <td style={td}><input type="checkbox" checked={selectedRows.has(i)} onChange={() => {}} style={{ accentColor: C.primary }} /></td>
                      <td style={{ ...td, color: C.muted }}>{row.idx}</td>
                      <td style={{ ...td, fontFamily: mono, color: C.muted }}>{row.meas}</td>
                      <td style={{ ...td, fontFamily: mono }}>{row.vgs}</td>
                      <td style={{ ...td, fontFamily: mono }}>{row.vds}</td>
                      <td style={{ ...td, fontFamily: mono, color: row.flag ? C.warning : C.text }}>{row.id}</td>
                      <td style={{ ...td, fontFamily: mono }}>{row.temp}</td>
                      <td style={td}>
                        {row.flag === "outlier" && (
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, backgroundColor: "#fff3cd", color: "#b45309", fontWeight: 500 }}>
                            <AlertTriangle size={10} style={{ display: "inline", marginRight: 3 }} />outlier
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Bottom status */}
          <div style={{ padding: "6px 16px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 16, alignItems: "center", backgroundColor: C.surface }}>
            <span style={{ fontSize: 11, color: C.muted }}>{displayRows.length} rows displayed</span>
            <span style={{ fontSize: 11, color: C.warning }}>2 outliers flagged</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: C.muted }}>UTF-8  ·  CSV  ·  Semicolon separated</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 5, border: "none",
  backgroundColor: C.primary, color: "#fff",
  fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: ff,
};
const btnOutline: React.CSSProperties = {
  display: "flex", alignItems: "center",
  padding: "6px 12px", borderRadius: 5, border: `1px solid ${C.border}`,
  backgroundColor: C.bg, color: C.text,
  fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: ff,
};
const btnXs: React.CSSProperties = {
  padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.border}`,
  backgroundColor: C.bg, color: C.muted, fontSize: 11, cursor: "pointer", fontFamily: ff,
};
const miniCard: React.CSSProperties = {
  backgroundColor: C.surface, border: `1px solid ${C.border}`,
  borderRadius: 6, padding: "12px 14px",
};
const th: React.CSSProperties = {
  padding: "6px 10px", textAlign: "left", fontSize: 11,
  color: C.muted, fontWeight: 500, borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "5px 10px", fontSize: 12, color: C.text,
};
