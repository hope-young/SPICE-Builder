import { useState } from "react";
import { FolderOpen, RefreshCw, Save } from "lucide-react";

const C = {
  bg: "#ffffff", surface: "#fafafa", border: "#e5e5e5",
  text: "#2c2c2c", muted: "#6b7280",
  primary: "#0d99ff", success: "#14ae5c", warning: "#ffcd29", error: "#f24822",
  accent: "#e6f4ff", hover: "#f5f5f5",
};
const ff = "'Inter', 'Segoe UI', system-ui, sans-serif";
const mono = "'JetBrains Mono', 'Consolas', monospace";

const sections = [
  { id: "optimizer", label: "Optimizer" },
  { id: "simulator", label: "Simulator" },
  { id: "extraction", label: "Extraction" },
  { id: "ui", label: "Interface" },
];

export function SettingsScreen() {
  const [activeSection, setActiveSection] = useState("optimizer");
  const [ltspicePath, setLtspicePath] = useState("C:\\Program Files\\LTC\\LTspiceXVII\\XVIISim.exe");
  const [maxIter, setMaxIter] = useState("500");
  const [tol, setTol] = useState("1e-6");
  const [optimizer, setOptimizer] = useState("nelder-mead");
  const [parallel, setParallel] = useState(true);
  const [threads, setThreads] = useState("8");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: C.bg, fontFamily: ff }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.text }}>Settings</h1>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>Optimizer, simulator paths, and extraction configuration</div>
        </div>
        <button style={btnOutline}><RefreshCw size={13} style={{ marginRight: 5 }} />Reset Defaults</button>
        <button style={btnPrimary}><Save size={13} style={{ marginRight: 5 }} />Save Settings</button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Section nav */}
        <div style={{ width: 200, borderRight: `1px solid ${C.border}`, padding: "12px 8px", backgroundColor: C.surface }}>
          {sections.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)} style={{
              width: "100%", display: "flex", alignItems: "center", padding: "7px 10px", borderRadius: 5,
              border: "none", cursor: "pointer", marginBottom: 2, fontFamily: ff,
              backgroundColor: activeSection === s.id ? C.accent : "transparent",
              color: activeSection === s.id ? C.primary : C.text,
              fontSize: 13, fontWeight: activeSection === s.id ? 500 : 400,
              textAlign: "left",
            }}>
              {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {activeSection === "optimizer" && (
            <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 20 }}>
              <SettingsGroup title="Default Optimizer Algorithm">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { id: "nelder-mead",    label: "Nelder-Mead simplex",    desc: "Robust, no gradient, good for noisy objectives" },
                    { id: "lbfgsb",         label: "L-BFGS-B",               desc: "Fast gradient-based, for smooth objectives" },
                    { id: "trust-region",   label: "Trust-Region",           desc: "Constrained, very accurate near minimum" },
                    { id: "diff-evolution", label: "Differential Evolution", desc: "Global, slow but avoids local minima" },
                  ].map(o => (
                    <label key={o.id} style={{ display: "flex", gap: 10, cursor: "pointer", padding: "8px 10px", borderRadius: 5, border: `1px solid ${optimizer === o.id ? C.primary : C.border}`, backgroundColor: optimizer === o.id ? C.accent : C.bg }}>
                      <input type="radio" value={o.id} checked={optimizer === o.id} onChange={() => setOptimizer(o.id)} style={{ accentColor: C.primary, marginTop: 2 }} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: optimizer === o.id ? C.primary : C.text }}>{o.label}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{o.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </SettingsGroup>

              <SettingsGroup title="Convergence Criteria">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <SettingsField label="Max iterations" value={maxIter} onChange={setMaxIter} />
                  <SettingsField label="Tolerance" value={tol} onChange={setTol} mono />
                  <SettingsField label="RMSE target (%)" value="2.0" onChange={() => {}} />
                  <SettingsField label="Patience (no improve)" value="30" onChange={() => {}} />
                </div>
              </SettingsGroup>

              <SettingsGroup title="Parallelization">
                <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <input type="checkbox" checked={parallel} onChange={e => setParallel(e.target.checked)} style={{ accentColor: C.primary, width: 14, height: 14 }} />
                  <div>
                    <div style={{ fontSize: 12, color: C.text }}>Enable parallel parameter sweeps</div>
                    <div style={{ fontSize: 11, color: C.muted }}>Uses multiprocessing for Jacobian estimation</div>
                  </div>
                </label>
                {parallel && <SettingsField label="Worker threads" value={threads} onChange={setThreads} />}
              </SettingsGroup>
            </div>
          )}

          {activeSection === "simulator" && (
            <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 20 }}>
              <SettingsGroup title="LTspice XVII Path">
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={ltspicePath}
                    onChange={e => setLtspicePath(e.target.value)}
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: 5, fontFamily: mono, fontSize: 11,
                      border: `1px solid ${C.border}`, backgroundColor: C.bg, color: C.text, outline: "none",
                    }}
                  />
                  <button style={btnOutline}><FolderOpen size={13} /></button>
                </div>
                <div style={{ fontSize: 11, color: C.success, marginTop: 6, display: "flex", alignItems: "center", gap: 5 }}>
                  ✓ LTspice XVII found — version 17.1.22 (2024)
                </div>
              </SettingsGroup>

              <SettingsGroup title="Simulation Options">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { label: "Run .op verification after each stage", checked: true },
                    { label: "Auto-generate testbench netlists",      checked: true },
                    { label: "Keep intermediate simulation files",    checked: false },
                    { label: "Verbose LTspice stdout logging",        checked: false },
                  ].map((opt, i) => (
                    <label key={i} style={{ display: "flex", gap: 8, cursor: "pointer", fontSize: 12, alignItems: "center" }}>
                      <input type="checkbox" defaultChecked={opt.checked} style={{ accentColor: C.primary }} />
                      <span style={{ color: C.text }}>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </SettingsGroup>
            </div>
          )}

          {(activeSection === "extraction" || activeSection === "ui") && (
            <div style={{ maxWidth: 560, padding: "20px 0", color: C.muted, fontSize: 13 }}>
              Section "{sections.find(s => s.id === activeSection)?.label}" settings — defaults applied.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>{title}</div>
      {children}
    </div>
  );
}

function SettingsField({ label, value, onChange, mono: isMono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{label}</div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: "100%", padding: "5px 8px", borderRadius: 4,
          border: `1px solid ${C.border}`, backgroundColor: C.bg, color: C.text, outline: "none",
          fontSize: 12, fontFamily: isMono ? mono : ff, boxSizing: "border-box",
        }}
      />
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
