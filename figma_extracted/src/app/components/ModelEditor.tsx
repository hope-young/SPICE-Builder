import { useState } from "react";
import { Save, RotateCcw, Copy, Search, ChevronDown, ChevronRight } from "lucide-react";

const C = {
  bg: "#ffffff", surface: "#fafafa", border: "#e5e5e5",
  text: "#2c2c2c", muted: "#6b7280",
  primary: "#0d99ff", success: "#14ae5c", warning: "#ffcd29", error: "#f24822",
  accent: "#e6f4ff", hover: "#f5f5f5",
};
const ff = "'Inter', 'Segoe UI', system-ui, sans-serif";
const mono = "'JetBrains Mono', 'Consolas', monospace";

type Param = { name: string; value: string; unit: string; desc: string; locked?: boolean };
type Group = { label: string; params: Param[]; open?: boolean };

const groups: Group[] = [
  {
    label: "Threshold & Doping", open: true,
    params: [
      { name: "VTH0",   value: "1.840",   unit: "V",      desc: "Long-channel threshold voltage at Vbs=0" },
      { name: "K1",     value: "0.5302",  unit: "V^0.5",  desc: "First-order body effect coefficient" },
      { name: "K2",     value: "-0.0123", unit: "—",       desc: "Second-order body effect coefficient" },
      { name: "K3",     value: "80.0",    unit: "—",       desc: "Narrow width effect coefficient" },
      { name: "DVT0",   value: "2.2",     unit: "—",       desc: "Short channel effect coefficient 0" },
      { name: "DVT1",   value: "0.53",    unit: "—",       desc: "Short channel effect coefficient 1" },
      { name: "DVTP0",  value: "0.118",   unit: "V^-1",   desc: "Drain-induced Vth shift param 0" },
      { name: "NSD",    value: "1.2e17",  unit: "cm^-3",  desc: "Source/drain doping concentration", locked: true },
    ],
  },
  {
    label: "Mobility", open: true,
    params: [
      { name: "U0",   value: "412.3",  unit: "cm²/Vs", desc: "Low-field electron mobility" },
      { name: "UA",   value: "1.82e-9",unit: "m/V",    desc: "First-order mobility degradation" },
      { name: "UB",   value: "4.6e-19",unit: "m²/V²",  desc: "Second-order mobility degradation" },
      { name: "UC",   value: "3.2e-11",unit: "1/V",    desc: "Body-effect mobility coefficient" },
      { name: "EU",   value: "1.67",   unit: "—",       desc: "Exponent for mobility degradation" },
    ],
  },
  {
    label: "Saturation",
    params: [
      { name: "VSAT",  value: "8.20e4", unit: "m/s",  desc: "Saturation velocity" },
      { name: "PCLM",  value: "0.518",  unit: "—",     desc: "Channel length modulation coefficient" },
      { name: "A1",    value: "3.5e-3", unit: "—",     desc: "Non-saturation factor" },
      { name: "PSAT",  value: "2.14",   unit: "—",     desc: "Saturation power coefficient" },
      { name: "DELTA", value: "0.01",   unit: "V",     desc: "Effective Vds for Vdsat calc", locked: true },
    ],
  },
  {
    label: "Output Resistance",
    params: [
      { name: "PDIBLC1", value: "0.318", unit: "—",  desc: "DIBL coefficient 1" },
      { name: "PDIBLC2", value: "0.044", unit: "—",  desc: "DIBL coefficient 2" },
      { name: "DROUT",   value: "0.562", unit: "—",  desc: "DIBL length dependence" },
      { name: "PVAG",    value: "0.840", unit: "—",  desc: "Gate voltage dependence of Early voltage" },
    ],
  },
  {
    label: "Capacitances",
    params: [
      { name: "CGSO",  value: "1.12e-10", unit: "F/m",   desc: "Gate-source overlap capacitance" },
      { name: "CGDO",  value: "8.40e-11", unit: "F/m",   desc: "Gate-drain overlap capacitance" },
      { name: "CJ",    value: "9.42e-4",  unit: "F/m²",  desc: "Zero-bias bulk junction capacitance" },
      { name: "MJ",    value: "0.482",    unit: "—",      desc: "Junction grading coefficient" },
      { name: "CJSW",  value: "2.50e-10", unit: "F/m",   desc: "Sidewall junction capacitance" },
    ],
  },
  {
    label: "Geometry", open: false,
    params: [
      { name: "TOX",  value: "4.1e-9", unit: "m",  desc: "Gate oxide thickness", locked: true },
      { name: "XJ",   value: "1.5e-7", unit: "m",  desc: "Junction depth", locked: true },
      { name: "LINT", value: "1.7e-8", unit: "m",  desc: "Channel length offset" },
      { name: "WINT", value: "0",      unit: "m",  desc: "Channel width offset", locked: true },
      { name: "DLC",  value: "0",      unit: "m",  desc: "Delta-L for Cov calc", locked: true },
    ],
  },
];

export function ModelEditor() {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    Object.fromEntries(groups.map(g => [g.label, g.open ?? false]))
  );
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");

  const toggle = (label: string) => setOpenGroups(prev => ({ ...prev, [label]: !prev[label] }));

  const filteredGroups = groups.map(g => ({
    ...g,
    params: query
      ? g.params.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || p.desc.toLowerCase().includes(query.toLowerCase()))
      : g.params,
  })).filter(g => g.params.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: C.bg, fontFamily: ff }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.text }}>Model Parameters</h1>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>BSIM3v3 SPICE model card  ·  IRFS4321  ·  52 parameters</div>
        </div>
        <button style={btnOutline}><RotateCcw size={13} style={{ marginRight: 5 }} />Revert</button>
        <button style={btnOutline}><Copy size={13} style={{ marginRight: 5 }} />Copy .param</button>
        <button style={btnPrimary}><Save size={13} style={{ marginRight: 5 }} />Save Model</button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Param editor */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {/* Search */}
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, backgroundColor: C.surface, display: "flex", alignItems: "center", gap: 8 }}>
            <Search size={13} color={C.muted} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search parameters…"
              style={{
                flex: 1, border: "none", background: "transparent", outline: "none",
                fontSize: 12, fontFamily: ff, color: C.text,
              }}
            />
          </div>

          {filteredGroups.map(group => (
            <div key={group.label}>
              <button
                onClick={() => toggle(group.label)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 16px", border: "none", cursor: "pointer",
                  backgroundColor: C.surface, borderBottom: `1px solid ${C.border}`,
                  textAlign: "left", fontFamily: ff,
                }}
              >
                {openGroups[group.label] ? <ChevronDown size={13} color={C.muted} /> : <ChevronRight size={13} color={C.muted} />}
                <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{group.label}</span>
                <span style={{ fontSize: 11, color: C.muted }}>({group.params.length} params)</span>
              </button>
              {openGroups[group.label] && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: C.surface }}>
                      {["Parameter", "Value", "Unit", "Description"].map(h => (
                        <th key={h} style={{ padding: "5px 16px", textAlign: "left", fontSize: 10, color: C.muted, fontWeight: 500, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.params.map(p => {
                      const val = edited[p.name] ?? p.value;
                      const changed = edited[p.name] !== undefined && edited[p.name] !== p.value;
                      return (
                        <tr key={p.name} style={{ borderBottom: `1px solid ${C.border}` }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = C.hover}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"}
                        >
                          <td style={{ padding: "5px 16px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, color: changed ? C.warning : C.primary }}>{p.name}</span>
                              {p.locked && <span style={{ fontSize: 9, color: C.muted, backgroundColor: C.border, padding: "1px 4px", borderRadius: 2 }}>locked</span>}
                              {changed && <span style={{ fontSize: 9, color: C.warning, backgroundColor: "#fff8e1", padding: "1px 4px", borderRadius: 2 }}>modified</span>}
                            </div>
                          </td>
                          <td style={{ padding: "4px 16px" }}>
                            <input
                              value={val}
                              disabled={p.locked}
                              onChange={e => setEdited(prev => ({ ...prev, [p.name]: e.target.value }))}
                              style={{
                                fontFamily: mono, fontSize: 12, width: 120,
                                padding: "3px 6px", borderRadius: 4,
                                border: `1px solid ${changed ? C.warning : C.border}`,
                                backgroundColor: p.locked ? C.hover : C.bg,
                                color: p.locked ? C.muted : C.text,
                                outline: "none",
                              }}
                            />
                          </td>
                          <td style={{ padding: "5px 16px", fontFamily: mono, fontSize: 11, color: C.muted }}>{p.unit}</td>
                          <td style={{ padding: "5px 16px", fontSize: 11, color: C.muted }}>{p.desc}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>

        {/* .lib preview */}
        <div style={{ width: 320, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", backgroundColor: "#1e1e2e" }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: mono }}>.MODEL card preview</span>
            <span style={{ fontSize: 10, color: C.success, backgroundColor: "#1a3a2a", padding: "1px 6px", borderRadius: 3 }}>BSIM3v3</span>
          </div>
          <pre style={{
            flex: 1, overflowY: "auto", padding: "10px 12px", margin: 0,
            fontSize: 9.5, fontFamily: mono, lineHeight: 1.6, color: "#e2e8f0",
          }}>
{`.MODEL IRFS4321 NMOS
+ LEVEL=8 VERSION=3.3.0
+ TNOM=27 TOX=4.1E-9
+ VTH0=1.840 K1=0.5302
+ K2=-0.0123 DVT0=2.2
+ DVT1=0.53 DVTP0=0.118
+ U0=412.3 UA=1.82E-9
+ UB=4.6E-19 UC=3.2E-11
+ EU=1.67
+ VSAT=8.2E4 PCLM=0.518
+ A1=3.5E-3 PSAT=2.14
+ PDIBLC1=0.318
+ PDIBLC2=0.044
+ DROUT=0.562 PVAG=0.840
+ CGSO=1.12E-10
+ CGDO=8.40E-11
+ CJ=9.42E-4 MJ=0.482
+ CJSW=2.50E-10
+ LINT=1.7E-8 XJ=1.5E-7
+ NSD=1.2E17`}
          </pre>
        </div>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  display: "flex", alignItems: "center",
  padding: "6px 13px", borderRadius: 5, border: "none",
  backgroundColor: C.primary, color: "#fff",
  fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: ff,
};
const btnOutline: React.CSSProperties = {
  display: "flex", alignItems: "center",
  padding: "6px 12px", borderRadius: 5, border: `1px solid ${C.border}`,
  backgroundColor: C.bg, color: C.text,
  fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: ff,
};
