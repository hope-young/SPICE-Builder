import { useState } from "react";
import { Download, FileText, Copy, CheckCircle2, Package } from "lucide-react";

const C = {
  bg: "#ffffff", surface: "#fafafa", border: "#e5e5e5",
  text: "#2c2c2c", muted: "#6b7280",
  primary: "#0d99ff", success: "#14ae5c", warning: "#ffcd29", error: "#f24822",
  accent: "#e6f4ff", hover: "#f5f5f5",
};
const ff = "'Inter', 'Segoe UI', system-ui, sans-serif";
const mono = "'JetBrains Mono', 'Consolas', monospace";

const libContent = `.SUBCKT IRFS4321 drain gate source
* SpiceBuilder v2.4.1 — IRFS4321 Si SGT MOSFET 150V
* Extracted: 2024-01-15  RMSE: 2.31%
*
M1 drain gate source source IRFS4321_MOS W=1 L=1
Rg gate _g 1.2
Rd _d drain 0.5m
Rs source _s 0.3m
Cgs gate source 1.5n
Cgd gate drain 45p
Cds drain source 200p
Dbody _s _d IRFS4321_BODY
*
.MODEL IRFS4321_MOS NMOS LEVEL=8 VERSION=3.3.0
+ TNOM=27 TOX=4.1E-9 VTH0=1.840 K1=0.5302
+ K2=-0.0123 DVT0=2.2 DVT1=0.53 DVTP0=0.118
+ U0=412.3 UA=1.82E-9 UB=4.6E-19 UC=3.2E-11
+ VSAT=8.2E4 PCLM=0.518 PDIBLC1=0.318
+ PDIBLC2=0.044 DROUT=0.562 PVAG=0.840
+ CGSO=1.12E-10 CGDO=8.40E-11
+ CJ=9.42E-4 MJ=0.482 CJSW=2.50E-10
*
.MODEL IRFS4321_BODY D(IS=1.2E-14 N=1.05 RS=0.8m)
.ENDS IRFS4321`;

const formats = [
  { id: "ltspice", label: "LTspice XVII", ext: ".lib", desc: "Direct import into LTspice XVII library", icon: "🔵" },
  { id: "hspice",  label: "HSPICE",       ext: ".sp",  desc: "Synopsys HSPICE compatible netlist", icon: "🟢" },
  { id: "pspice",  label: "PSpice",       ext: ".lib", desc: "Cadence PSpice / OrCAD format", icon: "🟡" },
  { id: "spectre", label: "Spectre",      ext: ".scs", desc: "Cadence Spectre circuit simulator", icon: "🟣" },
];

export function ExportScreen() {
  const [selectedFmt, setSelectedFmt] = useState("ltspice");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: C.bg, fontFamily: ff }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.text }}>Export</h1>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>Generate .lib and .subckt model files for SPICE simulators</div>
        </div>
        <button onClick={handleCopy} style={btnOutline}>
          {copied ? <CheckCircle2 size={13} color={C.success} style={{ marginRight: 5 }} /> : <Copy size={13} style={{ marginRight: 5 }} />}
          {copied ? "Copied!" : "Copy to clipboard"}
        </button>
        <button style={btnPrimary}><Download size={13} style={{ marginRight: 5 }} />Download .lib</button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Options */}
        <div style={{ width: 280, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", backgroundColor: C.surface, padding: "14px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 10 }}>Output Format</div>
          {formats.map(f => (
            <div
              key={f.id}
              onClick={() => setSelectedFmt(f.id)}
              style={{
                padding: "10px 10px", borderRadius: 6, cursor: "pointer", marginBottom: 6,
                border: `1px solid ${selectedFmt === f.id ? C.primary : C.border}`,
                backgroundColor: selectedFmt === f.id ? C.accent : C.bg,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 14 }}>{f.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: selectedFmt === f.id ? C.primary : C.text }}>{f.label}</span>
                <span style={{ fontSize: 10, fontFamily: mono, color: C.muted, marginLeft: "auto" }}>{f.ext}</span>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3, paddingLeft: 21 }}>{f.desc}</div>
            </div>
          ))}

          <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginTop: 16, marginBottom: 10 }}>Include</div>
          {[
            { label: ".MODEL card",        checked: true },
            { label: ".SUBCKT with Rg/Rs/Rd", checked: true },
            { label: "Body diode model",   checked: true },
            { label: "Thermal network",    checked: false },
            { label: "Package parasitics", checked: false },
            { label: "Temperature sweep",  checked: false },
          ].map((opt, i) => (
            <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 0" }}>
              <input type="checkbox" defaultChecked={opt.checked} style={{ accentColor: C.primary }} />
              <span style={{ fontSize: 12, color: C.text }}>{opt.label}</span>
            </label>
          ))}

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>Output file</div>
            <input
              defaultValue="IRFS4321.lib"
              style={{
                width: "100%", padding: "5px 8px", borderRadius: 4, fontFamily: mono, fontSize: 12,
                border: `1px solid ${C.border}`, backgroundColor: C.bg, color: C.text, outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        {/* Preview */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#1e1e2e" }}>
          <div style={{ padding: "8px 14px", borderBottom: "1px solid #333", display: "flex", alignItems: "center", gap: 8 }}>
            <FileText size={12} color="#9ca3af" />
            <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: mono }}>IRFS4321.lib  —  LTspice XVII format</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: C.success, backgroundColor: "#1a3a2a", padding: "1px 6px", borderRadius: 3 }}>Preview</span>
          </div>
          <pre style={{
            flex: 1, overflowY: "auto", padding: "12px 16px", margin: 0,
            fontSize: 11, fontFamily: mono, lineHeight: 1.7, color: "#e2e8f0",
            whiteSpace: "pre-wrap",
          }}>
            {libContent.split("\n").map((line, i) => {
              const isComment = line.trim().startsWith("*");
              const isDirective = line.trim().startsWith(".") && !isComment;
              const isPlus = line.trim().startsWith("+");
              return (
                <div key={i} style={{ color: isComment ? "#6b7280" : isDirective ? "#60a5fa" : isPlus ? "#a5f3fc" : "#e2e8f0" }}>
                  {line || " "}
                </div>
              );
            })}
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
