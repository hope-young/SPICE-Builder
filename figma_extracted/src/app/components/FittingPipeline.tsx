import { useState, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  Play, Square, RotateCcw, ChevronRight, CheckCircle2,
  Loader, AlertCircle, Clock, Terminal, Settings2
} from "lucide-react";

const C = {
  bg: "#ffffff", surface: "#fafafa", border: "#e5e5e5",
  text: "#2c2c2c", muted: "#6b7280",
  primary: "#0d99ff", success: "#14ae5c", warning: "#ffcd29", error: "#f24822",
  accent: "#e6f4ff", hover: "#f5f5f5",
};
const ff = "'Inter', 'Segoe UI', system-ui, sans-serif";
const mono = "'JetBrains Mono', 'Consolas', monospace";

type StageStatus = "pending" | "running" | "done" | "error";

interface Stage {
  id: number;
  name: string;
  short: string;
  description: string;
  optimizer: string;
  params: { name: string; init: string; fitted: string; bounds: string }[];
  rmse: string;
  iters: number;
  duration: string;
}

const stagesDef: Stage[] = [
  {
    id: 1, name: "Threshold Voltage", short: "Vth",
    description: "Extract Vth₀, DVTP0 from subthreshold Id-Vg (Vds=50mV)",
    optimizer: "Nelder-Mead",
    params: [
      { name: "VTH0",  init: "2.0",    fitted: "1.840",  bounds: "[1.0, 3.0]" },
      { name: "DVTP0", init: "0.1",    fitted: "0.118",  bounds: "[0, 0.5]" },
      { name: "NSD",   init: "1e17",   fitted: "1.2e17", bounds: "[1e16, 1e18]" },
    ],
    rmse: "0.82%", iters: 48, duration: "1.2s",
  },
  {
    id: 2, name: "Subthreshold Slope", short: "SS",
    description: "Extract n-factor (NFACTOR), subthreshold swing from log-scale Id-Vg",
    optimizer: "Nelder-Mead",
    params: [
      { name: "NFACTOR", init: "1.0", fitted: "1.082", bounds: "[0.5, 3.0]" },
      { name: "CDSC",    init: "2e-4", fitted: "1.8e-4", bounds: "[0, 1e-3]" },
      { name: "CDSCD",   init: "0",   fitted: "2.4e-5", bounds: "[0, 1e-4]" },
    ],
    rmse: "1.23%", iters: 62, duration: "1.8s",
  },
  {
    id: 3, name: "Linear Region Mobility", short: "μeff",
    description: "Extract U0, UA, UB from low-field Id-Vg (Vds=0.1V)",
    optimizer: "L-BFGS-B",
    params: [
      { name: "U0", init: "450",  fitted: "412.3",  bounds: "[100, 800]" },
      { name: "UA", init: "2e-9", fitted: "1.82e-9", bounds: "[0, 1e-8]" },
      { name: "UB", init: "5e-19", fitted: "4.6e-19", bounds: "[0, 1e-18]" },
      { name: "UC", init: "5e-11", fitted: "3.2e-11", bounds: "[0, 1e-10]" },
    ],
    rmse: "2.44%", iters: 97, duration: "3.1s",
  },
  {
    id: 4, name: "Saturation Velocity", short: "VSAT",
    description: "Extract VSAT, PCLM, A1 from saturation region Id-Vd",
    optimizer: "Trust-Region",
    params: [
      { name: "VSAT",  init: "1e5",  fitted: "8.2e4", bounds: "[1e4, 2e5]" },
      { name: "PCLM",  init: "0.5",  fitted: "0.518", bounds: "[0.01, 5.0]" },
      { name: "A1",    init: "0",    fitted: "3.5e-3", bounds: "[0, 1]" },
      { name: "PSAT",  init: "2.0",  fitted: "2.14",  bounds: "[0.5, 4.0]" },
    ],
    rmse: "3.11%", iters: 134, duration: "4.7s",
  },
  {
    id: 5, name: "Output Resistance", short: "Rout",
    description: "Extract PDIBLC1, PDIBLC2, DROUT from output conductance gds",
    optimizer: "Trust-Region",
    params: [
      { name: "PDIBLC1", init: "0.3",  fitted: "0.318", bounds: "[0, 1.0]" },
      { name: "PDIBLC2", init: "0.05", fitted: "0.044", bounds: "[0, 0.1]" },
      { name: "DROUT",   init: "0.5",  fitted: "0.562", bounds: "[0, 1.0]" },
      { name: "PVAG",    init: "1.0",  fitted: "0.84",  bounds: "[0, 5.0]" },
    ],
    rmse: "4.73%", iters: 189, duration: "6.2s",
  },
  {
    id: 6, name: "Capacitance Model", short: "C-V",
    description: "Extract CGSO, CGDO, CJ, MJ, CJSW from C-V measurements",
    optimizer: "Differential Evolution",
    params: [
      { name: "CGSO",  init: "1e-10", fitted: "1.12e-10", bounds: "[0, 5e-10]" },
      { name: "CGDO",  init: "1e-10", fitted: "8.4e-11",  bounds: "[0, 5e-10]" },
      { name: "CJ",    init: "1e-3",  fitted: "9.42e-4",  bounds: "[1e-4, 5e-3]" },
      { name: "MJ",    init: "0.5",   fitted: "0.482",    bounds: "[0.1, 0.9]" },
    ],
    rmse: "5.31%", iters: 312, duration: "12.4s",
  },
];

const STAGE_DURATIONS = [1400, 1800, 3200, 4800, 6300, 12500];

function makeConvergence(iters: number, finalRmse: number) {
  return Array.from({ length: iters > 50 ? 50 : iters }, (_, i) => {
    const t = i / 49;
    const rmse = (finalRmse + 30) * Math.exp(-3.5 * t) + finalRmse * (1 + 0.08 * Math.sin(i * 0.8) * Math.exp(-t * 2));
    return { iter: Math.round(i * (iters / 49)), rmse };
  });
}

export function FittingPipeline() {
  const [statuses, setStatuses] = useState<StageStatus[]>(["done", "done", "done", "done", "done", "pending"]);
  const [activeStage, setActiveStage] = useState(5);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(100);
  const [logs, setLogs] = useState<string[]>([
    "[14:22:05]  Stage 5 — Output Resistance converged (iter=189, RMSE=4.73%)",
    "[14:21:38]  Stage 4 — Saturation Velocity converged (iter=134, RMSE=3.11%)",
    "[14:19:11]  Stage 3 — Linear Mobility converged (iter=97, RMSE=2.44%)",
    "[14:17:54]  Data cleaning complete — 527 outliers removed",
    "[14:15:22]  Stage 2 — Subthreshold Slope converged (iter=62, RMSE=1.23%)",
    "[14:12:09]  Data loaded: IRFS4321_Id_Vd_125C.csv (4096 pts)",
    "[14:10:33]  Stage 1 — Threshold Voltage converged (iter=48, RMSE=0.82%)",
    "[14:08:01]  SpiceBuilder v2.4.1 started",
  ]);
  const runRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
    setLogs(prev => [`[${ts}]  ${msg}`, ...prev]);
  };

  const runStage = async (idx: number) => {
    setStatuses(prev => { const n = [...prev]; n[idx] = "running"; return n; });
    setActiveStage(idx);
    setProgress(0);
    const dur = STAGE_DURATIONS[idx];
    const start = Date.now();
    await new Promise<void>(resolve => {
      const tick = () => {
        if (!runRef.current) { resolve(); return; }
        const elapsed = Date.now() - start;
        const pct = Math.min(100, (elapsed / dur) * 100);
        setProgress(pct);
        if (pct < 100) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    if (!runRef.current) return false;
    setStatuses(prev => { const n = [...prev]; n[idx] = "done"; return n; });
    const s = stagesDef[idx];
    addLog(`Stage ${s.id} — ${s.name} converged (iter=${s.iters}, RMSE=${s.rmse})`);
    return true;
  };

  const handleRunAll = async () => {
    if (running) {
      runRef.current = false;
      setRunning(false);
      return;
    }
    runRef.current = true;
    setRunning(true);
    addLog("Starting full 6-stage extraction pipeline…");
    const startFrom = statuses.findIndex(s => s !== "done");
    const from = startFrom === -1 ? 0 : startFrom;
    setStatuses(prev => { const n = [...prev]; for (let i = from; i < 6; i++) n[i] = "pending"; return n; });
    for (let i = from; i < 6; i++) {
      if (!runRef.current) break;
      addLog(`Stage ${i + 1} — ${stagesDef[i].name} starting…`);
      const ok = await runStage(i);
      if (!ok) break;
    }
    setRunning(false);
    runRef.current = false;
    setProgress(100);
    if (runRef.current !== false) addLog("All stages complete.");
  };

  const handleReset = () => {
    runRef.current = false;
    setRunning(false);
    setStatuses(["pending", "pending", "pending", "pending", "pending", "pending"]);
    setActiveStage(0);
    setProgress(0);
    addLog("Pipeline reset — all stages cleared");
  };

  const activeS = stagesDef[activeStage];
  const convergenceData = makeConvergence(activeS.iters, parseFloat(activeS.rmse));
  const doneCount = statuses.filter(s => s === "done").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: C.bg, fontFamily: ff }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.text }}>Fitting Pipeline</h1>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>6-stage BSIM3v3 parameter extraction  ·  IRFS4321</div>
        </div>
        <button onClick={handleReset} style={btnOutline}><RotateCcw size={13} style={{ marginRight: 5 }} />Reset</button>
        <button style={btnOutline}><Settings2 size={13} style={{ marginRight: 5 }} />Optimizer</button>
        <button onClick={handleRunAll} style={{
          ...btnPrimary, gap: 7, display: "flex", alignItems: "center",
          backgroundColor: running ? C.error : C.primary,
        }}>
          {running ? <><Square size={13} />Stop</> : <><Play size={13} />{doneCount > 0 && doneCount < 6 ? "Resume" : "Run All"}</>}
        </button>
      </div>

      {/* Pipeline progress bar */}
      <div style={{ padding: "8px 20px", borderBottom: `1px solid ${C.border}`, backgroundColor: C.surface, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, height: 5, backgroundColor: C.border, borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 3,
            width: `${(doneCount / 6) * 100 + (running ? (progress / 6) : 0)}%`,
            backgroundColor: C.success,
            transition: "width 0.3s ease",
          }} />
        </div>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: mono, whiteSpace: "nowrap" }}>{doneCount}/6 stages</span>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Stage list */}
        <div style={{ width: 260, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", backgroundColor: C.surface, overflowY: "auto" }}>
          {stagesDef.map((stage, i) => {
            const status = statuses[i];
            const isActive = activeStage === i;
            return (
              <div
                key={stage.id}
                onClick={() => setActiveStage(i)}
                style={{
                  padding: "10px 14px",
                  borderBottom: `1px solid ${C.border}`,
                  backgroundColor: isActive ? C.accent : "transparent",
                  cursor: "pointer",
                  transition: "background-color 0.08s",
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = C.hover; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StageIcon status={status} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontSize: 10, color: C.muted, fontFamily: mono }}>Stage {stage.id}</span>
                      <span style={{ fontSize: 10, backgroundColor: isActive ? C.primary : C.border, color: isActive ? "#fff" : C.muted, padding: "0 4px", borderRadius: 2 }}>{stage.short}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: isActive ? C.primary : C.text, marginTop: 1 }}>{stage.name}</div>
                  </div>
                  {status === "running" && (
                    <div style={{ width: 30, height: 4, backgroundColor: C.border, borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${progress}%`, height: "100%", backgroundColor: C.primary, transition: "width 0.1s" }} />
                    </div>
                  )}
                  {status === "done" && <span style={{ fontSize: 10, color: C.success, fontFamily: mono }}>{stage.rmse}</span>}
                  {isActive && status !== "running" && <ChevronRight size={12} color={C.primary} />}
                </div>
                {status === "done" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 4, paddingLeft: 24, fontSize: 10, color: C.muted }}>
                    <span>{stage.iters} iter</span>
                    <span>·</span>
                    <span>{stage.duration}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* Stage detail */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "14px 16px", gap: 12 }}>
              {/* Stage header */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>Stage {activeS.id}</span>
                    <span style={{ fontSize: 10, backgroundColor: C.accent, color: C.primary, padding: "1px 6px", borderRadius: 3 }}>{activeS.short}</span>
                    <span style={{ fontSize: 10, backgroundColor: C.hover, color: C.muted, padding: "1px 6px", borderRadius: 3 }}>{activeS.optimizer}</span>
                  </div>
                  <h2 style={{ margin: "4px 0 2px", fontSize: 15, fontWeight: 600, color: C.text }}>{activeS.name}</h2>
                  <div style={{ fontSize: 12, color: C.muted }}>{activeS.description}</div>
                </div>
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: statuses[activeStage] === "done" ? C.success : C.muted, fontFamily: mono }}>{activeS.rmse}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>RMSE</div>
                </div>
              </div>

              {/* Convergence chart */}
              <div style={{ flex: 1, backgroundColor: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 4px 8px", overflow: "hidden" }}>
                <div style={{ fontSize: 11, color: C.muted, paddingLeft: 18, marginBottom: 4 }}>Convergence — RMSE vs iteration</div>
                <ResponsiveContainer width="100%" height="85%">
                  <LineChart data={convergenceData} margin={{ top: 4, right: 20, bottom: 16, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="iter" tick={{ fontSize: 9, fontFamily: mono, fill: C.muted }}
                      label={{ value: "Iteration", position: "insideBottom", offset: -10, style: { fontSize: 10, fill: C.muted } }} />
                    <YAxis tick={{ fontSize: 9, fontFamily: mono, fill: C.muted }} tickFormatter={v => `${v.toFixed(1)}%`}
                      label={{ value: "RMSE (%)", angle: -90, position: "insideLeft", offset: 8, style: { fontSize: 10, fill: C.muted } }} />
                    <Tooltip formatter={(v: number) => [`${v.toFixed(2)}%`, "RMSE"]}
                      contentStyle={{ fontSize: 11, fontFamily: mono, border: `1px solid ${C.border}`, borderRadius: 5 }} />
                    <ReferenceLine y={parseFloat(activeS.rmse)} stroke={C.success} strokeDasharray="4 2"
                      label={{ value: `Target ${activeS.rmse}`, fill: C.success, fontSize: 9, position: "right" }} />
                    <Line type="monotone" dataKey="rmse" stroke={C.primary} strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Parameter table */}
              <div style={{ backgroundColor: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, overflow: "hidden" }}>
                <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 600, color: C.text }}>
                  Extracted Parameters
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr>
                      {["Parameter", "Initial", "Fitted", "Bounds"].map(h => (
                        <th key={h} style={{ padding: "5px 12px", textAlign: "left", color: C.muted, fontWeight: 500, borderBottom: `1px solid ${C.border}`, fontSize: 10 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeS.params.map(p => (
                      <tr key={p.name} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "5px 12px", fontFamily: mono, fontWeight: 600, color: C.primary }}>{p.name}</td>
                        <td style={{ padding: "5px 12px", fontFamily: mono, color: C.muted }}>{p.init}</td>
                        <td style={{ padding: "5px 12px", fontFamily: mono, fontWeight: 600, color: statuses[activeStage] === "done" ? C.text : C.muted }}>
                          {statuses[activeStage] === "done" ? p.fitted : "—"}
                        </td>
                        <td style={{ padding: "5px 12px", fontFamily: mono, color: C.muted, fontSize: 10 }}>{p.bounds}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Log panel */}
            <div style={{ width: 300, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", backgroundColor: "#1a1a1a" }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #333", display: "flex", alignItems: "center", gap: 6 }}>
                <Terminal size={12} color="#6b7280" />
                <span style={{ fontSize: 11, color: "#6b7280", fontFamily: mono }}>Extraction Log</span>
              </div>
              <div ref={logRef} style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                {logs.map((log, i) => (
                  <div key={i} style={{
                    padding: "2px 12px", fontSize: 10, fontFamily: mono,
                    color: log.includes("converged") ? "#4ade80" :
                           log.includes("Error") ? "#f87171" :
                           log.includes("starting") ? "#60a5fa" : "#9ca3af",
                  }}>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StageIcon({ status }: { status: StageStatus }) {
  const size = 16;
  if (status === "done") return <CheckCircle2 size={size} color={C.success} />;
  if (status === "error") return <AlertCircle size={size} color={C.error} />;
  if (status === "running") return (
    <div style={{ animation: "spin 1s linear infinite", display: "flex" }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <Loader size={size} color={C.primary} />
    </div>
  );
  return <Clock size={size} color={C.border} />;
}

const btnPrimary: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 5, border: "none",
  backgroundColor: C.primary, color: "#fff",
  fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: ff,
};
const btnOutline: React.CSSProperties = {
  display: "flex", alignItems: "center",
  padding: "6px 12px", borderRadius: 5, border: `1px solid ${C.border}`,
  backgroundColor: C.bg, color: C.text,
  fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: ff,
};
