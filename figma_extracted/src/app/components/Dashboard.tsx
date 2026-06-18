import { Activity, AlertTriangle, CheckCircle2, Clock, FileText, TrendingDown, TrendingUp, Zap } from "lucide-react";

const C = {
  bg: "#ffffff", surface: "#fafafa", border: "#e5e5e5",
  text: "#2c2c2c", muted: "#6b7280",
  primary: "#0d99ff", success: "#14ae5c", warning: "#ffcd29", error: "#f24822",
  accent: "#e6f4ff", hover: "#f5f5f5",
};

const ff = "'Inter', 'Segoe UI', system-ui, sans-serif";
const mono = "'JetBrains Mono', 'Consolas', monospace";

const metrics = [
  { label: "Measurement Files", value: "7", sub: "3 devices · 4 temps", icon: FileText, color: C.primary, bg: "#e6f4ff" },
  { label: "Data Points Loaded", value: "18,432", sub: "after cleaning: 17,905", icon: Activity, color: C.success, bg: "#e8f8ef" },
  { label: "Params Extracted", value: "47 / 52", sub: "5 pending — Stage 6", icon: CheckCircle2, color: C.warning, bg: "#fff8e1" },
  { label: "Overall Model RMSE", value: "2.31%", sub: "↓ 0.18% vs last run", icon: TrendingDown, color: C.success, bg: "#e8f8ef" },
];

const modelHealth = [
  { region: "Subthreshold (SS, n)",     rmse: 1.2,  status: "good",    params: ["SS=68.3 mV/dec", "n=1.08"] },
  { region: "Threshold Voltage (Vth)",  rmse: 0.8,  status: "good",    params: ["Vth0=1.84 V", "DVTP0=0.12"] },
  { region: "Linear Region (μeff)",     rmse: 2.4,  status: "ok",      params: ["U0=412 cm²/Vs", "UA=1.8e-9"] },
  { region: "Saturation (VSAT, PCLM)",  rmse: 3.1,  status: "ok",      params: ["VSAT=8.2e4 m/s", "PCLM=0.52"] },
  { region: "Output Resistance",        rmse: 4.7,  status: "warn",    params: ["PDIBLC1=0.32", "DROUT=0.56"] },
  { region: "Capacitances (Ciss/Coss)", rmse: 5.3,  status: "warn",    params: ["CGSO=1.1e-10", "CJ=9.4e-4"] },
];

const activity = [
  { time: "14:22:05", action: "Stage 5 complete", detail: "Output resistance converged in 34 iterations", type: "success" },
  { time: "14:21:38", action: "Stage 4 complete", detail: "VSAT=8.2×10⁴ m/s, PCLM=0.52 — RMSE 3.1%", type: "success" },
  { time: "14:19:11", action: "Stage 3 complete", detail: "U0=412 cm²/Vs, UA=1.8×10⁻⁹ — RMSE 2.4%", type: "success" },
  { time: "14:17:54", action: "Outlier removed", detail: "3 points beyond 3σ removed from Id-Vd @ 125°C", type: "info" },
  { time: "14:15:22", action: "Stage 2 complete", detail: "SS=68.3 mV/dec, n=1.08 — RMSE 1.2%", type: "success" },
  { time: "14:12:09", action: "Data loaded", detail: "IRFS4321_Id_Vd_125C.csv — 2,048 points", type: "info" },
  { time: "14:10:33", action: "Stage 1 complete", detail: "Vth0=1.84 V extracted from log-scale Id-Vg", type: "success" },
  { time: "14:08:01", action: "Project opened", detail: "IRFS4321_25C loaded — 7 measurement files", type: "info" },
];

const devices = [
  { id: "IRFS4321", vdss: "150V", rdson: "8.2 mΩ", qg: "47 nC", lot: "A2401", status: "active" },
  { id: "IRFS3107", vdss: "75V",  rdson: "3.7 mΩ", qg: "31 nC", lot: "B2312", status: "queued" },
  { id: "STP80NF55", vdss: "55V", rdson: "6.8 mΩ", qg: "52 nC", lot: "C2415", status: "queued" },
];

function statusColor(s: string) {
  if (s === "good") return C.success;
  if (s === "ok") return C.primary;
  if (s === "warn") return C.warning;
  return C.error;
}

export function Dashboard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: C.bg, fontFamily: ff, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, backgroundColor: C.bg }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.text }}>Dashboard</h1>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>IRFS4321  ·  Si SGT MOSFET 150V  ·  Lot A2401  ·  Last run 14:22</div>
        </div>
        <button style={btnOutline}>New Project</button>
        <button style={btnPrimary}>
          <Zap size={13} />  Continue Fitting
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Metric cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
          {metrics.map(m => {
            const Icon = m.icon;
            return (
              <div key={m.label} style={card}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{m.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 600, color: C.text, fontFamily: mono, letterSpacing: "-0.02em" }}>{m.value}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{m.sub}</div>
                  </div>
                  <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: m.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={16} color={m.color} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Main content row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 14, flex: 1, minHeight: 0 }}>
          {/* Left: Model Health + Device Table */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
            {/* Model Health */}
            <div style={{ ...card, flex: "none" }}>
              <div style={sectionHeader}>
                <span>Model Region Health</span>
                <span style={{ fontSize: 11, color: C.muted }}>BSIM3v3 · IRFS4321</span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {["Region / Parameters", "Key Params", "RMSE", "Status"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "5px 8px", color: C.muted, fontWeight: 500, borderBottom: `1px solid ${C.border}`, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {modelHealth.map((row, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = C.hover}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"}
                    >
                      <td style={{ padding: "7px 8px", color: C.text, fontWeight: 500 }}>{row.region}</td>
                      <td style={{ padding: "7px 8px" }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {row.params.map(p => (
                            <span key={p} style={{ fontFamily: mono, fontSize: 10, color: C.primary, backgroundColor: C.accent, padding: "1px 5px", borderRadius: 3 }}>{p}</span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: "7px 8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ width: 50, height: 4, backgroundColor: C.border, borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(row.rmse / 6 * 100, 100)}%`, height: "100%", backgroundColor: statusColor(row.status), borderRadius: 2 }} />
                          </div>
                          <span style={{ fontFamily: mono, fontSize: 11, color: statusColor(row.status) }}>{row.rmse}%</span>
                        </div>
                      </td>
                      <td style={{ padding: "7px 8px" }}>
                        <StatusBadge s={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Device queue */}
            <div style={{ ...card, flex: "none" }}>
              <div style={sectionHeader}>
                <span>Device Queue</span>
                <button style={btnXs}>+ Add Device</button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {["Device", "VDSS", "Rdson", "Qg", "Lot", "Status"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "4px 8px", color: C.muted, fontWeight: 500, borderBottom: `1px solid ${C.border}`, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {devices.map(d => (
                    <tr key={d.id}
                      style={{ borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = C.hover}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"}
                    >
                      <td style={{ padding: "6px 8px", fontFamily: mono, fontWeight: 600, color: C.text, fontSize: 12 }}>{d.id}</td>
                      <td style={{ padding: "6px 8px", fontFamily: mono, color: C.muted }}>{d.vdss}</td>
                      <td style={{ padding: "6px 8px", fontFamily: mono, color: C.muted }}>{d.rdson}</td>
                      <td style={{ padding: "6px 8px", fontFamily: mono, color: C.muted }}>{d.qg}</td>
                      <td style={{ padding: "6px 8px", color: C.muted }}>{d.lot}</td>
                      <td style={{ padding: "6px 8px" }}>
                        <span style={{
                          fontSize: 10, padding: "2px 7px", borderRadius: 3,
                          backgroundColor: d.status === "active" ? "#e8f8ef" : C.hover,
                          color: d.status === "active" ? C.success : C.muted,
                          fontWeight: 500,
                        }}>{d.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: Activity log */}
          <div style={{ ...card, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ ...sectionHeader, flexShrink: 0 }}>
              <span>Activity Log</span>
              <span style={{ fontSize: 11, color: C.muted }}>Today</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {activity.map((a, i) => (
                <div key={i} style={{
                  display: "flex", gap: 10, padding: "8px 0",
                  borderBottom: i < activity.length - 1 ? `1px solid ${C.border}` : "none",
                }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: "50%", marginTop: 4, flexShrink: 0,
                    backgroundColor: a.type === "success" ? C.success : C.primary,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>{a.action}</span>
                      <span style={{ fontSize: 10, color: C.muted, fontFamily: mono, flexShrink: 0 }}>{a.time}</span>
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{a.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ s }: { s: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    good: { label: "Good", color: C.success, bg: "#e8f8ef" },
    ok:   { label: "OK",   color: C.primary, bg: C.accent },
    warn: { label: "Warn", color: "#b45309", bg: "#fff8e1" },
    error:{ label: "Error",color: C.error,   bg: "#fde8e4" },
  };
  const m = map[s] ?? map.ok;
  return (
    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, backgroundColor: m.bg, color: m.color, fontWeight: 500 }}>{m.label}</span>
  );
}

const card: React.CSSProperties = {
  backgroundColor: C.surface, border: `1px solid ${C.border}`,
  borderRadius: 7, padding: "12px 14px",
};
const sectionHeader: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  marginBottom: 10, fontSize: 13, fontWeight: 600, color: C.text,
};
const btnPrimary: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
  padding: "6px 13px", borderRadius: 5, border: "none",
  backgroundColor: C.primary, color: "#fff",
  fontSize: 12, fontWeight: 500, cursor: "pointer",
  fontFamily: ff,
};
const btnOutline: React.CSSProperties = {
  padding: "6px 13px", borderRadius: 5,
  border: `1px solid ${C.border}`, backgroundColor: C.bg,
  color: C.text, fontSize: 12, fontWeight: 500, cursor: "pointer",
  fontFamily: ff,
};
const btnXs: React.CSSProperties = {
  padding: "3px 8px", borderRadius: 4,
  border: `1px solid ${C.border}`, backgroundColor: C.bg,
  color: C.muted, fontSize: 11, cursor: "pointer", fontFamily: ff,
};
