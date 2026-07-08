import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ScatterChart, Scatter, ReferenceLine,
} from "recharts";
import { Download, Settings2, ZoomIn, BarChart2 } from "lucide-react";

const C = {
  bg: "#ffffff", surface: "#fafafa", border: "#e5e5e5",
  text: "#2c2c2c", muted: "#6b7280",
  primary: "#0d99ff", success: "#14ae5c", warning: "#ffcd29", error: "#f24822",
  accent: "#e6f4ff", hover: "#f5f5f5",
};
const ff = "'Inter', 'Segoe UI', system-ui, sans-serif";
const mono = "'JetBrains Mono', 'Consolas', monospace";

/* ── Id-Vg data generation ───────────────────────────────────────────── */
function idVg(vgs: number, temp: number) {
  const vth = 1.84 - (temp - 25) * 0.005;
  const n = 1.08 + (temp - 25) * 0.002;
  const vt = 0.02585 * (1 + (temp - 25) / 300);
  if (vgs < vth) return Math.exp((vgs - vth) / (n * vt)) * 1e-7;
  const u0 = 412 - (temp - 25) * 1.2;
  const vgs_eff = vgs - vth;
  return u0 * 1e-4 * (vgs_eff ** 1.8) * 0.35;
}

const idVgMeas25 = Array.from({ length: 26 }, (_, i) => {
  const vgs = i * 0.2;
  const id = idVg(vgs, 25);
  return { vgs, measured: id * (1 + (Math.random() - 0.5) * 0.04), model: id };
});
const idVgMeas125 = Array.from({ length: 26 }, (_, i) => {
  const vgs = i * 0.2;
  const id = idVg(vgs, 125);
  return { vgs, measured: id * (1 + (Math.random() - 0.5) * 0.04), model: id };
});

/* ── Id-Vd data ───────────────────────────────────────────────────────── */
function idVdPoint(vgs: number, vds: number, temp: number) {
  const vth = 1.84 - (temp - 25) * 0.005;
  if (vgs <= vth) return 0;
  const u0 = 412 - (temp - 25) * 1.2;
  const vgs_eff = vgs - vth;
  const vdsat = vgs_eff * 0.65;
  if (vds < vdsat) {
    return u0 * 1e-4 * 0.35 * (2 * vgs_eff * vds - vds * vds);
  }
  return u0 * 1e-4 * 0.35 * vgs_eff ** 2 * (1 + 0.05 * vds);
}

const vgsLevels = [2.0, 2.5, 3.0, 3.5, 4.0, 5.0];
const idVdData = Array.from({ length: 31 }, (_, i) => {
  const vds = i * 1.0;
  const point: Record<string, number> = { vds };
  vgsLevels.forEach(vgs => {
    const id = idVdPoint(vgs, vds, 25);
    point[`m_vgs${vgs}`] = id * (1 + (Math.random() - 0.5) * 0.03);
    point[`f_vgs${vgs}`] = id;
  });
  return point;
});

/* ── C-V data ─────────────────────────────────────────────────────────── */
const cvData = Array.from({ length: 31 }, (_, i) => {
  const vds = i * 1.0;
  const ciss = 1850 / (1 + vds / 4.5) ** 0.35;
  const coss = 420 / (1 + vds / 3.2) ** 0.55;
  const crss = 60 / (1 + vds / 1.8) ** 0.85;
  return {
    vds,
    ciss_m: ciss * (1 + (Math.random() - 0.5) * 0.03),
    ciss_f: ciss,
    coss_m: coss * (1 + (Math.random() - 0.5) * 0.04),
    coss_f: coss,
    crss_m: crss * (1 + (Math.random() - 0.5) * 0.05),
    crss_f: crss,
  };
});

/* ── Qg data ──────────────────────────────────────────────────────────── */
const qgData = Array.from({ length: 26 }, (_, i) => {
  const qg = i * 3.0;
  const vgs = qg < 90 ? qg / 42 : qg < 105 ? 2.14 + (qg - 90) * 0.02 : 2.44 + (qg - 105) / 25;
  return { qg, vgs_m: vgs * (1 + (Math.random() - 0.5) * 0.015), vgs_f: vgs };
});

type CurveTab = "idvg" | "idvd" | "cv" | "qg" | "ifvf";

const tabs: { id: CurveTab; label: string }[] = [
  { id: "idvg", label: "Id–Vg" },
  { id: "idvd", label: "Id–Vd" },
  { id: "cv",   label: "Ciss/Coss/Crss" },
  { id: "qg",   label: "Qg" },
  { id: "ifvf", label: "If–Vf" },
];

const vdColors = ["#0d99ff", "#14ae5c", "#f24822", "#9b59b6", "#ff8c42", "#2c2c2c"];

const rmseByTab: Record<CurveTab, string> = {
  idvg: "1.82%", idvd: "3.11%", cv: "4.73%", qg: "2.44%", ifvf: "1.27%",
};

function CustomTooltip({ active, payload, label, xLabel, yLabel }: {
  active?: boolean; payload?: { color: string; name: string; value: number }[];
  label?: number; xLabel: string; yLabel: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 11, fontFamily: mono }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{xLabel} = {typeof label === "number" ? label.toFixed(2) : label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, display: "flex", gap: 8 }}>
          <span>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{typeof p.value === "number" ? p.value.toExponential(3) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function CurveVisualizer() {
  const [tab, setTab] = useState<CurveTab>("idvg");
  const [temp, setTemp] = useState<"25" | "125">("25");
  const [logScale, setLogScale] = useState(false);

  const data25 = idVgMeas25;
  const data125 = idVgMeas125;
  const idVgData = temp === "25" ? data25 : data125;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: C.bg, fontFamily: ff }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.text }}>Curve Visualizer</h1>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>Measurement vs SPICE model prediction overlay</div>
        </div>
        <button style={btnOutline}><Settings2 size={13} style={{ marginRight: 5 }} />Options</button>
        <button style={btnOutline}><ZoomIn size={13} style={{ marginRight: 5 }} />Zoom</button>
        <button style={btnOutline}><Download size={13} style={{ marginRight: 5 }} />Export PNG</button>
      </div>

      {/* Curve type tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, padding: "0 20px", backgroundColor: C.bg }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 16px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500,
              backgroundColor: "transparent", fontFamily: ff,
              color: tab === t.id ? C.primary : C.muted,
              borderBottom: tab === t.id ? `2px solid ${C.primary}` : "2px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Chart area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 16, overflow: "hidden", gap: 12 }}>
          {/* Main chart */}
          <div style={{ flex: 1, backgroundColor: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: "12px 4px 8px", overflow: "hidden" }}>
            {tab === "idvg" && (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={idVgData} margin={{ top: 5, right: 20, bottom: 25, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="vgs" label={{ value: "Vgs (V)", position: "insideBottom", offset: -12, style: { fontSize: 11, fill: C.muted } }} tick={{ fontSize: 10, fontFamily: mono, fill: C.muted }} />
                  <YAxis scale={logScale ? "log" : "auto"} domain={logScale ? [1e-9, "auto"] : undefined}
                    label={{ value: "Id (A)", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: C.muted } }}
                    tick={{ fontSize: 10, fontFamily: mono, fill: C.muted }} tickFormatter={v => v < 0.001 ? v.toExponential(0) : v.toFixed(3)} />
                  <Tooltip content={<CustomTooltip xLabel="Vgs" yLabel="Id" />} />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: ff, paddingTop: 4 }} />
                  <Line type="monotone" dataKey="measured" name="Measured" stroke={C.primary} strokeWidth={0} dot={{ r: 3, fill: C.primary, stroke: C.primary }} />
                  <Line type="monotone" dataKey="model" name="Model (BSIM3)" stroke={C.error} strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
            {tab === "idvd" && (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={idVdData} margin={{ top: 5, right: 20, bottom: 25, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="vds" label={{ value: "Vds (V)", position: "insideBottom", offset: -12, style: { fontSize: 11, fill: C.muted } }} tick={{ fontSize: 10, fontFamily: mono, fill: C.muted }} />
                  <YAxis label={{ value: "Id (A)", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: C.muted } }} tick={{ fontSize: 10, fontFamily: mono, fill: C.muted }} tickFormatter={v => v.toFixed(1)} />
                  <Tooltip content={<CustomTooltip xLabel="Vds" yLabel="Id" />} />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: ff, paddingTop: 4 }} />
                  {vgsLevels.map((vgs, i) => (
                    <>
                      <Line key={`m_${vgs}`} type="monotone" dataKey={`m_vgs${vgs}`} name={`Meas Vgs=${vgs}V`} stroke={vdColors[i]} strokeWidth={0} dot={{ r: 2, fill: vdColors[i] }} />
                      <Line key={`f_${vgs}`} type="monotone" dataKey={`f_vgs${vgs}`} name={`Fit Vgs=${vgs}V`} stroke={vdColors[i]} strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                    </>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
            {tab === "cv" && (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cvData} margin={{ top: 5, right: 20, bottom: 25, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="vds" label={{ value: "Vds (V)", position: "insideBottom", offset: -12, style: { fontSize: 11, fill: C.muted } }} tick={{ fontSize: 10, fontFamily: mono, fill: C.muted }} />
                  <YAxis label={{ value: "C (pF)", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: C.muted } }} tick={{ fontSize: 10, fontFamily: mono, fill: C.muted }} tickFormatter={v => v.toFixed(0)} />
                  <Tooltip content={<CustomTooltip xLabel="Vds" yLabel="C" />} />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: ff, paddingTop: 4 }} />
                  <Line type="monotone" dataKey="ciss_m" name="Ciss meas" stroke={C.primary} dot={{ r: 2 }} strokeWidth={0} />
                  <Line type="monotone" dataKey="ciss_f" name="Ciss model" stroke={C.primary} strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="coss_m" name="Coss meas" stroke={C.success} dot={{ r: 2 }} strokeWidth={0} />
                  <Line type="monotone" dataKey="coss_f" name="Coss model" stroke={C.success} strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="crss_m" name="Crss meas" stroke={C.error} dot={{ r: 2 }} strokeWidth={0} />
                  <Line type="monotone" dataKey="crss_f" name="Crss model" stroke={C.error} strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
            {tab === "qg" && (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={qgData} margin={{ top: 5, right: 20, bottom: 25, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="qg" label={{ value: "Qg (nC)", position: "insideBottom", offset: -12, style: { fontSize: 11, fill: C.muted } }} tick={{ fontSize: 10, fontFamily: mono, fill: C.muted }} />
                  <YAxis label={{ value: "Vgs (V)", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: C.muted } }} tick={{ fontSize: 10, fontFamily: mono, fill: C.muted }} tickFormatter={v => v.toFixed(1)} />
                  <Tooltip content={<CustomTooltip xLabel="Qg" yLabel="Vgs" />} />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: ff, paddingTop: 4 }} />
                  <Line type="monotone" dataKey="vgs_m" name="Vgs meas" stroke={C.primary} dot={{ r: 3, fill: C.primary }} strokeWidth={0} />
                  <Line type="monotone" dataKey="vgs_f" name="Vgs model" stroke={C.error} strokeWidth={1.5} dot={false} />
                  <ReferenceLine y={2.14} stroke={C.warning} strokeDasharray="4 2" label={{ value: "Vth", fill: C.warning, fontSize: 10 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
            {tab === "ifvf" && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.muted, fontSize: 13 }}>
                <div style={{ textAlign: "center" }}>
                  <BarChart2 size={32} color={C.border} style={{ marginBottom: 8 }} />
                  <div>If-Vf body diode data</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>Load IRFS4321_If_Vf_25C.csv to visualize</div>
                </div>
              </div>
            )}
          </div>

          {/* Residuals mini chart */}
          {tab !== "ifvf" && (
            <div style={{ height: 90, backgroundColor: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 4px 4px", overflow: "hidden" }}>
              <div style={{ fontSize: 10, color: C.muted, paddingLeft: 18, marginBottom: 2 }}>Relative residual (%)</div>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={(tab === "idvg" ? idVgData : tab === "qg" ? qgData : cvData).map((d: Record<string, number>) => {
                    const mKey = tab === "idvg" ? "measured" : tab === "qg" ? "vgs_m" : "ciss_m";
                    const fKey = tab === "idvg" ? "model" : tab === "qg" ? "vgs_f" : "ciss_f";
                    const xKey = tab === "idvg" ? "vgs" : tab === "qg" ? "qg" : "vds";
                    const meas = d[mKey] as number;
                    const fit = d[fKey] as number;
                    const resid = fit !== 0 ? ((meas - fit) / fit) * 100 : 0;
                    return { x: d[xKey], resid };
                  })}
                  margin={{ top: 0, right: 20, bottom: 16, left: 20 }}
                >
                  <XAxis dataKey="x" tick={{ fontSize: 9, fontFamily: mono, fill: C.muted }} />
                  <YAxis tick={{ fontSize: 9, fontFamily: mono, fill: C.muted }} tickFormatter={v => `${v.toFixed(0)}%`} domain={[-10, 10]} />
                  <ReferenceLine y={0} stroke={C.border} />
                  <Line type="monotone" dataKey="resid" stroke={C.warning} strokeWidth={1} dot={{ r: 2, fill: C.warning }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div style={{ width: 220, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", backgroundColor: C.surface }}>
          {/* RMSE */}
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Fit Quality</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 24, fontWeight: 700, color: rmseByTab[tab] > "3%" ? C.warning : C.success, fontFamily: mono }}>{rmseByTab[tab]}</span>
              <span style={{ fontSize: 11, color: C.muted }}>RMSE</span>
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                <span style={{ color: C.muted }}>Max error</span>
                <span style={{ fontFamily: mono, color: C.text }}>6.2%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                <span style={{ color: C.muted }}>Mean error</span>
                <span style={{ fontFamily: mono, color: C.text }}>1.4%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: C.muted }}>R²</span>
                <span style={{ fontFamily: mono, color: C.success }}>0.9974</span>
              </div>
            </div>
          </div>

          {/* Conditions */}
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Conditions</div>
            <div style={{ fontSize: 11, color: C.text, marginBottom: 6 }}>Temperature</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {(["25", "125"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTemp(t)}
                  style={{
                    flex: 1, padding: "5px 0", borderRadius: 4, fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: mono,
                    border: `1px solid ${temp === t ? C.primary : C.border}`,
                    backgroundColor: temp === t ? C.accent : C.bg,
                    color: temp === t ? C.primary : C.muted,
                  }}
                >
                  {t}°C
                </button>
              ))}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 11 }}>
              <input type="checkbox" checked={logScale} onChange={e => setLogScale(e.target.checked)} style={{ accentColor: C.primary }} />
              <span style={{ color: C.text }}>Log scale Y-axis</span>
            </label>
          </div>

          {/* Active params */}
          <div style={{ padding: "12px 14px", flex: 1 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Active Parameters</div>
            {[
              { label: "Vth0", value: "1.84 V" },
              { label: "U0", value: "412 cm²/Vs" },
              { label: "VSAT", value: "8.2×10⁴ m/s" },
              { label: "PCLM", value: "0.52" },
              { label: "CGSO", value: "1.1×10⁻¹⁰ F/m" },
              { label: "CJ", value: "9.4×10⁻⁴ F/m²" },
            ].map(p => (
              <div key={p.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted, fontFamily: mono }}>{p.label}</span>
                <span style={{ color: C.text, fontFamily: mono }}>{p.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const btnOutline: React.CSSProperties = {
  display: "flex", alignItems: "center",
  padding: "6px 12px", borderRadius: 5, border: `1px solid ${C.border}`,
  backgroundColor: C.bg, color: C.text,
  fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: ff,
};
