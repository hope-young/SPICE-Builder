import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ScatterChart, Scatter,
} from "recharts";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

const C = {
  bg: "#ffffff", surface: "#fafafa", border: "#e5e5e5",
  text: "#2c2c2c", muted: "#6b7280",
  primary: "#0d99ff", success: "#14ae5c", warning: "#ffcd29", error: "#f24822",
  accent: "#e6f4ff", hover: "#f5f5f5",
};
const ff = "'Inter', 'Segoe UI', system-ui, sans-serif";
const mono = "'JetBrains Mono', 'Consolas', monospace";

const validSets = [
  { name: "IRFS4321_Id_Vg_-40C.csv", temp: "-40°C", status: "pass", rmse: "2.8%", points: 2048 },
  { name: "IRFS4321_Id_Vd_-40C.csv", temp: "-40°C", status: "pass", rmse: "3.9%", points: 4096 },
  { name: "IRFS4321_Id_Vg_175C.csv", temp: "175°C", status: "warn", rmse: "7.2%", points: 2048 },
  { name: "IRFS4321_Rdson_Vgs.csv",  temp: "25°C",  status: "pass", rmse: "1.6%", points: 512  },
];

const scatterData = Array.from({ length: 80 }, (_, i) => {
  const true_val = Math.random() * 10 + 0.1;
  const model_val = true_val * (1 + (Math.random() - 0.5) * 0.12);
  return { true_val, model_val };
});

const tempRmse = [
  { temp: -40, rmse: 3.2 }, { temp: 25, rmse: 2.3 }, { temp: 75, rmse: 2.6 },
  { temp: 100, rmse: 3.0 }, { temp: 125, rmse: 3.5 }, { temp: 150, rmse: 5.1 }, { temp: 175, rmse: 7.2 },
];

export function ValidateScreen() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: C.bg, fontFamily: ff }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.text }}>Cross-Validation</h1>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>Model accuracy on held-out measurement data</div>
        </div>
        <button style={btnPrimary}>Run Validation</button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden", padding: 16, gap: 14 }}>
        {/* Left */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 280 }}>
          <div style={{ ...card }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 10 }}>Validation Sets</div>
            {validSets.map((v, i) => (
              <div key={i} style={{ padding: "7px 0", borderBottom: i < validSets.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {v.status === "pass" ? <CheckCircle2 size={12} color={C.success} /> : <AlertTriangle size={12} color={C.warning} />}
                  <span style={{ fontSize: 11, color: C.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
                  <span style={{ fontSize: 10, fontFamily: mono, color: v.status === "pass" ? C.success : C.warning }}>{v.rmse}</span>
                </div>
                <div style={{ fontSize: 10, color: C.muted, paddingLeft: 18, marginTop: 2 }}>{v.temp}  ·  {v.points.toLocaleString()} pts</div>
              </div>
            ))}
          </div>

          <div style={{ ...card }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 10 }}>Summary</div>
            {[
              { label: "Overall RMSE", value: "3.4%", ok: true },
              { label: "Max error", value: "7.2%", ok: false },
              { label: "Within 5%", value: "85.2%", ok: true },
              { label: "Within 10%", value: "97.6%", ok: true },
              { label: "R² (all)", value: "0.9941", ok: true },
            ].map(s => (
              <div key={s.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted }}>{s.label}</span>
                <span style={{ fontFamily: mono, fontWeight: 600, color: s.ok ? C.text : C.warning }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ ...card, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>Predicted vs Measured (all validation sets)</div>
            <ResponsiveContainer width="100%" height="90%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="true_val" name="Measured" tick={{ fontSize: 9, fontFamily: mono, fill: C.muted }}
                  label={{ value: "Measured Id (A)", position: "insideBottom", offset: -12, style: { fontSize: 10, fill: C.muted } }} />
                <YAxis dataKey="model_val" name="Model" tick={{ fontSize: 9, fontFamily: mono, fill: C.muted }}
                  label={{ value: "Model Id (A)", angle: -90, position: "insideLeft", offset: 8, style: { fontSize: 10, fill: C.muted } }} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ fontSize: 10, fontFamily: mono, border: `1px solid ${C.border}`, borderRadius: 5 }} />
                <Scatter data={scatterData} fill={C.primary} opacity={0.6} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          <div style={{ ...card, height: 180 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>RMSE vs Temperature</div>
            <ResponsiveContainer width="100%" height="80%">
              <LineChart data={tempRmse} margin={{ top: 5, right: 20, bottom: 16, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="temp" tick={{ fontSize: 9, fontFamily: mono, fill: C.muted }}
                  label={{ value: "T (°C)", position: "insideBottom", offset: -10, style: { fontSize: 10, fill: C.muted } }} />
                <YAxis tick={{ fontSize: 9, fontFamily: mono, fill: C.muted }} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={{ fontSize: 10, fontFamily: mono, border: `1px solid ${C.border}`, borderRadius: 5 }} />
                <Line type="monotone" dataKey="rmse" stroke={C.primary} strokeWidth={1.5} dot={{ r: 3, fill: C.primary }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 5, border: "none",
  backgroundColor: C.primary, color: "#fff",
  fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: ff,
};
const card: React.CSSProperties = {
  backgroundColor: C.surface, border: `1px solid ${C.border}`,
  borderRadius: 7, padding: "12px 14px",
};
