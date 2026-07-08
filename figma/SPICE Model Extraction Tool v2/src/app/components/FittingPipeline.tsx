import { useState, useRef, useCallback, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import {
  Play, Shield, Eye, Plus, Trash2,
  CheckCircle2, Clock, Loader, AlertCircle,
  GitBranch, Lock, Unlock, BarChart2,
} from "lucide-react";

/* ─── design tokens ──────────────────────────────────────── */
const C = {
  bg: "#ffffff", surface: "#fafafa", border: "#e5e5e5",
  text: "#2c2c2c", muted: "#6b7280",
  primary: "#0d99ff", success: "#14ae5c", warning: "#ffcd29", error: "#f24822",
  accent: "#e6f4ff", hover: "#f5f5f5",
};
const ff   = "'Inter', 'Segoe UI', system-ui, sans-serif";
const mono = "'JetBrains Mono', 'Consolas', monospace";

/* ─── types ──────────────────────────────────────────────── */
type StepStatus = "empty" | "simulated" | "fitting" | "fitted" | "done" | "error";
type RunMode    = "sim" | "fit" | "fit-protected";
type Sensitivity = "high" | "med" | "low";

interface FitParam {
  name: string;
  value: string;
  unit: string;
  desc: string;
  released: boolean;
  sensitive: Sensitivity;
}

interface FitStep {
  id: number;
  label: string;
  vds: string;
  file: string;
  vgsMin: string;
  vgsMax: string;
  checkpointFrom: "initial" | number;
  status: StepStatus;
  rmse: number | null;
  r2: number | null;
  iters: number | null;
  params: FitParam[];
  protectionWeight: number;
  log: string[];
}

/* ─── default params per step ────────────────────────────── */
function defaultParams(vds: string): FitParam[] {
  const lo = parseFloat(vds) <= 1.0;
  return [
    { name: "VTH0",    value: "1.840",    unit: "V",       desc: "Long-channel threshold voltage",       released: lo,   sensitive: "high" },
    { name: "K1",      value: "0.530",    unit: "V⁰·⁵",   desc: "First-order body effect coefficient",  released: lo,   sensitive: "high" },
    { name: "NFACTOR", value: "1.082",    unit: "—",        desc: "Subthreshold swing factor",            released: lo,   sensitive: "high" },
    { name: "CDSC",    value: "1.80e-4",  unit: "F/m²",    desc: "Drain-src coupling to channel",        released: lo,   sensitive: "med"  },
    { name: "U0",      value: "412.3",    unit: "cm²/Vs",  desc: "Low-field carrier mobility",           released: true, sensitive: "high" },
    { name: "UA",      value: "1.82e-9",  unit: "m/V",     desc: "Mobility degradation (1st order)",     released: true, sensitive: "med"  },
    { name: "UB",      value: "4.60e-19", unit: "m²/V²",   desc: "Mobility degradation (2nd order)",     released: !lo,  sensitive: "med"  },
    { name: "VSAT",    value: "8.20e4",   unit: "m/s",     desc: "Carrier saturation velocity",          released: !lo,  sensitive: "high" },
    { name: "PCLM",    value: "0.518",    unit: "—",        desc: "Channel length modulation coefficient",released: !lo,  sensitive: "med"  },
    { name: "A0",      value: "1.000",    unit: "—",        desc: "Bulk charge effect coefficient",       released: !lo,  sensitive: "low"  },
    { name: "KETA",    value: "-0.047",   unit: "V⁻¹",     desc: "Body-bias dep. of bulk charge effect", released: !lo,  sensitive: "low"  },
  ];
}

/* ─── initial steps (pre-filled for demo) ────────────────── */
const INITIAL_STEPS: FitStep[] = [
  {
    id: 1, label: "Linear region — low Vds",
    vds: "0.5", file: "IRFS4321_Id_Vg_25C.csv",
    vgsMin: "0.0", vgsMax: "5.0",
    checkpointFrom: "initial",
    status: "done", rmse: 1.82, r2: 0.9991, iters: 54,
    params: defaultParams("0.5"),
    protectionWeight: 1.0,
    log: [
      "[14:10:33]  Simulating with initial params…",
      "[14:10:34]  Sim RMSE = 12.4% — fitting required",
      "[14:10:34]  Nelder-Mead started: 9 free params",
      "[14:10:47]  Converged at iter=54, RMSE=1.82%, R²=0.9991",
    ],
  },
  {
    id: 2, label: "Saturation region — mid Vds",
    vds: "5.0", file: "IRFS4321_Id_Vg_25C.csv",
    vgsMin: "0.0", vgsMax: "5.0",
    checkpointFrom: 0,
    status: "fitted", rmse: 3.11, r2: 0.9962, iters: 97,
    params: defaultParams("5.0"),
    protectionWeight: 0.3,
    log: [
      "[14:21:38]  Loading checkpoint from Step 1",
      "[14:21:38]  Simulating Vds=5V with Step-1 params…",
      "[14:21:39]  Sim RMSE = 8.7% — Fit + Protect mode",
      "[14:21:39]  Loss = 1.0×res(5V) + 0.3×res(0.5V)",
      "[14:22:05]  Converged at iter=97, RMSE=3.11%, R²=0.9962",
    ],
  },
  {
    id: 3, label: "High-field saturation",
    vds: "10.0", file: "IRFS4321_Id_Vg_25C.csv",
    vgsMin: "0.0", vgsMax: "5.0",
    checkpointFrom: 1,
    status: "empty", rmse: null, r2: null, iters: null,
    params: defaultParams("10.0"),
    protectionWeight: 0.2,
    log: [],
  },
];

/* ─── deterministic IdVg data (seed from stepIndex) ─────── */
function seededRand(seed: number, idx: number): number {
  const x = Math.sin(seed * 127.1 + idx * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function generateIdVg(vds: number, status: StepStatus, stepIndex: number) {
  const vth  = 1.84;
  const u0   = 412;
  const hasFit = status === "fitted" || status === "done" || status === "simulated";
  return Array.from({ length: 26 }, (_, i) => {
    const vgs = i * 0.2;
    const vth_eff = vth - 0.005 * vds;
    let id_true: number;
    if (vgs < vth_eff) {
      id_true = Math.exp((vgs - vth_eff) / 0.068) * 1e-7;
    } else {
      const vgs_eff = vgs - vth_eff;
      const vdsat   = Math.min(vds, vgs_eff * 0.65 + 0.001);
      const mob_eff = u0 / (1 + vgs_eff * 1.82e-9 / 4.1e-9);
      id_true = mob_eff * 1e-4 * 0.35 * (2 * vgs_eff * vdsat - vdsat ** 2) * (1 + 0.05 * vds);
    }
    const noise = (seededRand(stepIndex + 1, i * 3) - 0.5) * 0.04;
    const measured = id_true * (1 + noise);
    const modelErr = hasFit
      ? (stepIndex * 0.008 + 0.01) * Math.sin(i * 0.4) * Math.exp(-i * 0.06)
      : 0;
    const model = hasFit ? id_true * (1 + modelErr) : null;
    return { vgs, measured, model };
  });
}

/* ─── convergence history ────────────────────────────────── */
function makeConvergence(iters: number, finalRmse: number) {
  const pts = Math.min(iters, 60);
  return Array.from({ length: pts }, (_, i) => {
    const t    = i / (pts - 1);
    const rmse = (finalRmse + 28) * Math.exp(-4 * t)
               + finalRmse * (1 + 0.12 * Math.sin(i * 1.1) * Math.exp(-t * 3));
    return { iter: Math.round(t * iters), rmse };
  });
}

/* ─── status metadata ────────────────────────────────────── */
const STATUS_META: Record<StepStatus, { label: string; color: string; bg: string }> = {
  empty:     { label: "Ready",     color: C.muted,   bg: C.hover },
  simulated: { label: "Simulated", color: C.primary, bg: C.accent },
  fitting:   { label: "Fitting…",  color: "#b45309", bg: "#fff8e1" },
  fitted:    { label: "Fitted",    color: "#b45309", bg: "#fff8e1" },
  done:      { label: "Done",      color: C.success, bg: "#e8f8ef" },
  error:     { label: "Error",     color: C.error,   bg: "#fde8e4" },
};

function StatusPill({ s }: { s: StepStatus }) {
  const m = STATUS_META[s];
  return (
    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, backgroundColor: m.bg, color: m.color, fontWeight: 600 }}>
      {m.label}
    </span>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  const sz = 15;
  if (status === "done")      return <CheckCircle2 size={sz} color={C.success} />;
  if (status === "fitted")    return <CheckCircle2 size={sz} color="#b45309" />;
  if (status === "simulated") return <Eye size={sz} color={C.primary} />;
  if (status === "fitting")   return <Loader size={sz} color={C.primary} style={{ animation: "spin 1s linear infinite" }} />;
  if (status === "error")     return <AlertCircle size={sz} color={C.error} />;
  return <Clock size={sz} color={C.border} />;
}

const OVERLAY_COLORS = ["#9b59b6", "#14ae5c", "#ff8c42", "#f24822"];
const RUN_MODE_OPTIONS: { id: RunMode; label: string }[] = [
  { id: "sim",            label: "Sim" },
  { id: "fit",            label: "Fit" },
  { id: "fit-protected",  label: "Fit + Protect" },
];
const STEP_DURATIONS: Record<RunMode, number> = { sim: 900, fit: 3600, "fit-protected": 5400 };

/* ─── main component ─────────────────────────────────────── */
export function FittingPipeline() {
  const [steps, setSteps]       = useState<FitStep[]>(INITIAL_STEPS);
  const [activeIdx, setActiveIdx] = useState(1);
  const [runMode, setRunMode]   = useState<RunMode>("fit-protected");
  const [running, setRunning]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeTab, setActiveTab] = useState<"config" | "params" | "convergence">("config");
  const [showOverlay, setShowOverlay] = useState(true);
  const runRef = useRef(false);

  const step = steps[activeIdx];

  /* chart data — deterministic, memoised per step */
  const chartData = useMemo(
    () => generateIdVg(parseFloat(step.vds), step.status, activeIdx),
    [step.vds, step.status, activeIdx]
  );

  const prevStepData = useMemo(() =>
    steps
      .slice(0, activeIdx)
      .filter(s => s.status === "done" || s.status === "fitted")
      .map((s, pi) => ({
        step: s,
        color: OVERLAY_COLORS[pi % OVERLAY_COLORS.length],
        data: generateIdVg(parseFloat(s.vds), s.status, steps.indexOf(s)),
      })),
    [steps, activeIdx]
  );

  /* helpers */
  const updateStep = (upd: Partial<FitStep>) =>
    setSteps(prev => prev.map((s, i) => i === activeIdx ? { ...s, ...upd } : s));

  const addLog = (msg: string) => {
    const now = new Date();
    const ts  = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
    setSteps(prev => prev.map((s, i) => i !== activeIdx ? s : { ...s, log: [`[${ts}]  ${msg}`, ...s.log] }));
  };

  const toggleParam = (name: string) =>
    setSteps(prev => prev.map((s, i) => i !== activeIdx ? s : {
      ...s,
      params: s.params.map(p => p.name === name ? { ...p, released: !p.released } : p),
    }));

  const addStep = () => {
    const last    = steps[steps.length - 1];
    const newVds  = (parseFloat(last.vds) * 2).toFixed(1);
    const newStep: FitStep = {
      id: steps.length + 1,
      label: `High-field @ Vds=${newVds}V`,
      vds: newVds, file: last.file,
      vgsMin: "0.0", vgsMax: "5.0",
      checkpointFrom: steps.length - 1,
      status: "empty", rmse: null, r2: null, iters: null,
      params: defaultParams(newVds),
      protectionWeight: 0.2,
      log: [],
    };
    setSteps(prev => [...prev, newStep]);
    setActiveIdx(steps.length);
  };

  const removeStep = (idx: number) => {
    if (idx === 0 || steps.length <= 1) return;
    setSteps(prev =>
      prev.filter((_, i) => i !== idx).map((s, i) => ({
        ...s, id: i + 1,
        checkpointFrom:
          s.checkpointFrom === idx ? (idx > 0 ? idx - 1 : "initial" as const)
          : typeof s.checkpointFrom === "number" && s.checkpointFrom > idx
            ? s.checkpointFrom - 1
            : s.checkpointFrom,
      }))
    );
    setActiveIdx(prev => Math.min(prev, steps.length - 2));
  };

  /* run handler */
  const handleRun = useCallback(async () => {
    if (running) { runRef.current = false; setRunning(false); return; }
    runRef.current = true;
    setRunning(true);
    setProgress(0);
    setSteps(prev => prev.map((s, i) => i !== activeIdx ? s : { ...s, status: "fitting", log: [] }));

    const ckptLabel = step.checkpointFrom === "initial"
      ? "initial parameters"
      : `Step ${steps[step.checkpointFrom as number]?.id} checkpoint`;
    const modeLabel = { sim: "Sim Only", fit: "Fit Current", "fit-protected": "Fit + Protect" }[runMode];

    const nowLog = (msg: string) => {
      const now = new Date();
      const ts  = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
      setSteps(prev => prev.map((s, i) => i !== activeIdx ? s : { ...s, log: [`[${ts}]  ${msg}`, ...s.log] }));
    };

    nowLog(`Loading checkpoint: ${ckptLabel}`);
    nowLog(`Vds = ${step.vds} V  |  Vgs = ${step.vgsMin}–${step.vgsMax} V  |  Mode: ${modeLabel}`);
    if (runMode === "fit-protected") {
      nowLog(`Protection weight λ = ${step.protectionWeight.toFixed(2)} on previous step curves`);
      nowLog(`Joint loss: 1.0 × res(${step.vds}V)  +  ${step.protectionWeight} × res(prev)`);
    }

    const dur = STEP_DURATIONS[runMode];
    await new Promise<void>(resolve => {
      const start = Date.now();
      const tick = () => {
        if (!runRef.current) { resolve(); return; }
        const pct = Math.min(100, ((Date.now() - start) / dur) * 100);
        setProgress(pct);
        if (pct < 100) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });

    if (!runRef.current) {
      setSteps(prev => prev.map((s, i) => i !== activeIdx ? s : { ...s, status: "empty" }));
      setRunning(false);
      return;
    }

    if (runMode === "sim") {
      const simRmse = 8.4 + seededRand(activeIdx + 5, 0) * 4;
      nowLog(`Simulation complete — RMSE = ${simRmse.toFixed(1)}%`);
      nowLog("Fitting recommended (error > 5% threshold)");
      updateStep({ status: "simulated", rmse: parseFloat(simRmse.toFixed(1)), r2: 0.984, iters: null });
    } else {
      const releasedCount = step.params.filter(p => p.released).length;
      nowLog(`Optimizer: L-BFGS-B  |  Free params: ${releasedCount}`);
      const base    = runMode === "fit-protected" ? 2.4 : 3.1;
      const fitRmse = base + seededRand(activeIdx + 11, 1) * 1.8;
      const fitR2   = parseFloat((1 - fitRmse / 1200).toFixed(4));
      const fitIter = Math.round(60 + seededRand(activeIdx, 7) * 80);
      nowLog(`Converged at iter=${fitIter}, RMSE=${fitRmse.toFixed(2)}%, R²=${fitR2}`);
      updateStep({ status: "fitted", rmse: parseFloat(fitRmse.toFixed(2)), r2: fitR2, iters: fitIter });
    }

    setRunning(false);
    runRef.current = false;
  }, [running, runMode, step, activeIdx, steps]);

  const doneCount = steps.filter(s => s.status === "done" || s.status === "fitted").length;

  /* ── render ──────────────────────────────────────────────*/
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: C.bg, fontFamily: ff, overflow: "hidden" }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ padding: "13px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.text }}>TransferFit</h1>
            <span style={{ fontSize: 10, backgroundColor: C.accent, color: C.primary, padding: "2px 7px", borderRadius: 3, fontWeight: 600 }}>Id–Vg</span>
            <span style={{ fontSize: 10, color: C.muted, backgroundColor: C.hover, padding: "2px 7px", borderRadius: 3 }}>BSIM3v3</span>
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>
            Sequential transfer-characteristic extraction  ·  IRFS4321  ·  {steps.length} conditions
          </div>
        </div>

        {/* Mode selector */}
        <div style={{ display: "flex", gap: 1, border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden", backgroundColor: C.surface }}>
          {RUN_MODE_OPTIONS.map(m => (
            <button
              key={m.id}
              onClick={() => !running && setRunMode(m.id)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 12px", border: "none",
                cursor: running ? "default" : "pointer",
                fontSize: 12, fontWeight: 500, fontFamily: ff,
                backgroundColor: runMode === m.id ? C.primary : "transparent",
                color: runMode === m.id ? "#fff" : C.muted,
                transition: "all 0.1s",
              }}
            >
              {m.id === "sim" && <Eye size={12} />}
              {m.id === "fit" && <Play size={12} />}
              {m.id === "fit-protected" && <Shield size={12} />}
              {m.label}
            </button>
          ))}
        </div>

        <button
          onClick={handleRun}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 16px", borderRadius: 5, border: "none",
            backgroundColor: running ? C.error : C.primary,
            color: "#fff", fontSize: 12, fontWeight: 600,
            cursor: "pointer", fontFamily: ff,
          }}
        >
          {running
            ? <><div style={{ width: 10, height: 10, backgroundColor: "#fff", borderRadius: 2 }} /> Stop</>
            : <><Play size={13} /> {runMode === "sim" ? "Simulate" : "Run Fit"}</>}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── Step list ────────────────────────────────────── */}
        <div style={{ width: 252, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", backgroundColor: C.surface, flexShrink: 0 }}>
          <div style={{ padding: "8px 12px 6px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>
              Extraction Steps ({steps.length})
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {steps.map((s, i) => {
              const isActive = i === activeIdx;
              const ckpt = s.checkpointFrom;
              return (
                <div key={s.id}>
                  {/* Dependency connector */}
                  {i > 0 && (
                    <div style={{ display: "flex", alignItems: "center", paddingLeft: 28, gap: 5, height: 14 }}>
                      <div style={{ width: 1, height: 14, backgroundColor: ckpt !== "initial" ? "#c3e6cb" : C.border }} />
                      <span style={{ fontSize: 9, color: C.muted, fontFamily: mono }}>
                        {ckpt === "initial" ? "initial" : `← Step ${steps[ckpt as number]?.id}`}
                      </span>
                    </div>
                  )}

                  <div
                    onClick={() => setActiveIdx(i)}
                    style={{
                      padding: "9px 12px",
                      backgroundColor: isActive ? C.accent : "transparent",
                      borderLeft: isActive ? `2px solid ${C.primary}` : "2px solid transparent",
                      cursor: "pointer", transition: "all 0.08s",
                    }}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = C.hover; }}
                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                      <div style={{ marginTop: 1 }}><StepIcon status={s.status} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                          <span style={{ fontSize: 10, color: C.muted, fontFamily: mono }}>Step {s.id}</span>
                          <span style={{
                            fontSize: 10, fontFamily: mono,
                            backgroundColor: isActive ? C.primary : C.hover,
                            color: isActive ? "#fff" : C.muted,
                            padding: "0 4px", borderRadius: 2,
                          }}>Vds={s.vds}V</span>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: isActive ? C.primary : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.label}
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                          <StatusPill s={s.status} />
                          {s.rmse !== null && (
                            <span style={{ fontSize: 10, fontFamily: mono, color: s.rmse < 3 ? C.success : s.rmse < 6 ? "#b45309" : C.error }}>
                              {s.rmse}%
                            </span>
                          )}
                          {i > 0 && (
                            <button
                              onClick={e => { e.stopPropagation(); removeStep(i); }}
                              style={{ border: "none", background: "transparent", cursor: "pointer", padding: 2, marginLeft: "auto", display: "flex" }}
                            >
                              <Trash2 size={11} color={C.muted} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <button
              onClick={addStep}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 7,
                padding: "9px 14px", border: "none",
                borderTop: `1px solid ${C.border}`,
                cursor: "pointer", backgroundColor: "transparent",
                color: C.primary, fontSize: 12, fontWeight: 500, fontFamily: ff,
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = C.hover}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"}
            >
              <Plus size={13} color={C.primary} />
              Add IdVg condition
            </button>
          </div>

          {/* Summary */}
          <div style={{ borderTop: `1px solid ${C.border}`, padding: "9px 12px" }}>
            {[
              { label: "Fitted / Total", value: `${doneCount} / ${steps.length}` },
              { label: "Best RMSE",      value: doneCount > 0 ? `${Math.min(...steps.filter(s => s.rmse !== null).map(s => s.rmse!))}%` : "—" },
              { label: "Free params",    value: String(step.params.filter(p => p.released).length) },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0" }}>
                <span style={{ color: C.muted }}>{r.label}</span>
                <span style={{ fontFamily: mono, color: C.text, fontWeight: 500 }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Center: Curve chart ───────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "12px 14px", gap: 10, minWidth: 0 }}>
          {/* Step context bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{step.label}</span>
                <StatusPill s={step.status} />
                {running && (
                  <div style={{ width: 80, height: 4, backgroundColor: C.border, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${progress}%`, height: "100%", backgroundColor: C.primary, transition: "width 0.08s" }} />
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2, display: "flex", gap: 8 }}>
                <span style={{ fontFamily: mono }}>Vds = {step.vds} V</span>
                <span>·</span>
                <span style={{ fontFamily: mono }}>Vgs = {step.vgsMin}–{step.vgsMax} V</span>
                {step.r2 !== null && <><span>·</span><span style={{ color: C.success, fontFamily: mono }}>R² = {step.r2}</span></>}
                {step.rmse !== null && <><span>·</span><span style={{ color: step.rmse < 3 ? C.success : "#b45309", fontFamily: mono }}>RMSE {step.rmse}%</span></>}
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.muted, cursor: "pointer" }}>
              <input type="checkbox" checked={showOverlay} onChange={e => setShowOverlay(e.target.checked)} style={{ accentColor: C.primary }} />
              Overlay previous
            </label>
          </div>

          {/* Main chart */}
          <div style={{ flex: 1, backgroundColor: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 4px 8px", overflow: "hidden" }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 28, bottom: 30, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="vgs"
                  tick={{ fontSize: 10, fontFamily: mono, fill: C.muted }}
                  label={{ value: "Vgs (V)", position: "insideBottom", offset: -14, style: { fontSize: 11, fill: C.muted } }} />
                <YAxis
                  tickFormatter={v => v < 0.001 ? v.toExponential(1) : v.toFixed(2)}
                  tick={{ fontSize: 10, fontFamily: mono, fill: C.muted }}
                  label={{ value: "Id (A)", angle: -90, position: "insideLeft", offset: 8, style: { fontSize: 11, fill: C.muted } }} />
                <Tooltip
                  formatter={(v: number, name: string) => [v < 0.001 ? v.toExponential(3) : v.toFixed(4), name]}
                  contentStyle={{ fontSize: 11, fontFamily: mono, border: `1px solid ${C.border}`, borderRadius: 5 }} />
                <Legend wrapperStyle={{ fontSize: 10, fontFamily: ff, paddingTop: 4 }} />

                {/* Previous step overlays */}
                {showOverlay && prevStepData.map(({ step: ps, color, data: pd }) => (
                  <Line
                    key={`prev_${ps.id}`}
                    type="monotone"
                    data={pd}
                    dataKey="measured"
                    name={`Meas Vds=${ps.vds}V`}
                    stroke={color}
                    strokeWidth={0}
                    dot={{ r: 2.5, fill: color, stroke: color, opacity: 0.55 }}
                    isAnimationActive={false}
                  />
                ))}

                {/* Current measured */}
                <Line
                  type="monotone" dataKey="measured"
                  name={`Meas Vds=${step.vds}V (active)`}
                  stroke={C.primary} strokeWidth={0}
                  dot={{ r: 3.5, fill: C.primary, stroke: C.primary }}
                  isAnimationActive={false}
                />

                {/* Current model */}
                {chartData.some(d => d.model !== null) && (
                  <Line
                    type="monotone" dataKey="model"
                    name={`Model Vds=${step.vds}V`}
                    stroke={C.error} strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* RMSE strip */}
          {steps.some(s => s.rmse !== null) && (
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {steps.filter(s => s.rmse !== null).map((s, i) => (
                <div key={s.id} style={{
                  padding: "5px 10px", borderRadius: 5, fontSize: 11,
                  border: `1px solid ${activeIdx === steps.indexOf(s) ? C.primary : C.border}`,
                  backgroundColor: activeIdx === steps.indexOf(s) ? C.accent : C.surface,
                  display: "flex", gap: 8, alignItems: "center", cursor: "pointer",
                }}
                  onClick={() => setActiveIdx(steps.indexOf(s))}
                >
                  <span style={{ color: OVERLAY_COLORS[i] || C.primary }}>■</span>
                  <span style={{ color: C.muted, fontFamily: mono }}>Step {s.id}  Vds={s.vds}V</span>
                  <span style={{ fontFamily: mono, fontWeight: 600, color: s.rmse! < 3 ? C.success : s.rmse! < 6 ? "#b45309" : C.error }}>
                    {s.rmse}%
                  </span>
                  <StatusPill s={s.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right panel ───────────────────────────────────── */}
        <div style={{ width: 296, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", backgroundColor: C.surface, flexShrink: 0 }}>
          <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
            {(["config", "params", "convergence"] as const).map(t => (
              <button key={t} onClick={() => setActiveTab(t)} style={{
                flex: 1, padding: "7px 4px", border: "none", cursor: "pointer",
                fontSize: 11, fontWeight: 500, fontFamily: ff, backgroundColor: "transparent",
                color: activeTab === t ? C.primary : C.muted,
                borderBottom: activeTab === t ? `2px solid ${C.primary}` : "2px solid transparent",
              }}>
                {t === "config" ? "Config" : t === "params" ? "Parameters" : "Convergence"}
              </button>
            ))}
          </div>

          {/* Config tab */}
          {activeTab === "config" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
              <CField label="Step label">
                <input value={step.label} onChange={e => updateStep({ label: e.target.value })} style={inp} />
              </CField>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <CField label="Vds (V)">
                  <input defaultValue={step.vds} style={inp} />
                </CField>
                <CField label="Vgs max (V)">
                  <input defaultValue={step.vgsMax} style={inp} />
                </CField>
              </div>
              <CField label="Measurement file">
                <input defaultValue={step.file} style={{ ...inp, fontSize: 10 }} />
              </CField>

              {/* Checkpoint */}
              <div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 7 }}>Initial parameters from</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {[
                    { key: "initial" as const, label: "Default BSIM3 initial", sub: "Use model card defaults" },
                    ...steps.slice(0, activeIdx).map((ps, pi) => ({
                      key: pi as number,
                      label: `Step ${ps.id} checkpoint`,
                      sub: `Vds=${ps.vds}V · ${ps.rmse !== null ? `RMSE ${ps.rmse}%` : "not fitted"}`,
                    })),
                  ].map(opt => {
                    const isSelected = step.checkpointFrom === opt.key;
                    return (
                      <label key={String(opt.key)} style={{
                        display: "flex", gap: 8, cursor: "pointer", padding: "7px 9px", borderRadius: 5,
                        border: `1px solid ${isSelected ? C.primary : C.border}`,
                        backgroundColor: isSelected ? C.accent : C.bg,
                      }}>
                        <input type="radio" checked={isSelected}
                          onChange={() => updateStep({ checkpointFrom: opt.key })}
                          style={{ accentColor: C.primary, marginTop: 2, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 500, color: isSelected ? C.primary : C.text }}>{opt.label}</div>
                          <div style={{ fontSize: 10, color: C.muted }}>{opt.sub}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Protection weight */}
              {runMode === "fit-protected" && activeIdx > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 5 }}>Protection weight λ</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="range" min="0" max="1" step="0.05"
                      value={step.protectionWeight}
                      onChange={e => updateStep({ protectionWeight: parseFloat(e.target.value) })}
                      style={{ flex: 1, accentColor: C.primary }} />
                    <span style={{ fontFamily: mono, fontSize: 12, width: 32, color: C.text }}>{step.protectionWeight.toFixed(2)}</span>
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 4, fontFamily: mono }}>
                    loss = res({step.vds}V) + {step.protectionWeight}×res(prev)
                  </div>
                </div>
              )}

              {/* Log */}
              {step.log.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 5 }}>Run log</div>
                  <div style={{ backgroundColor: "#1a1a1a", borderRadius: 5, padding: "7px 9px", maxHeight: 130, overflowY: "auto" }}>
                    {step.log.map((l, li) => (
                      <div key={li} style={{
                        fontSize: 10, fontFamily: mono, lineHeight: 1.7,
                        color: l.includes("Converged") ? "#4ade80"
                          : l.includes("RMSE") || l.includes("loss") ? "#60a5fa"
                          : "#9ca3af",
                      }}>{l}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Params tab */}
          {activeTab === "params" && (
            <div style={{ flex: 1, overflowY: "auto" }}>
              <div style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 10, color: C.muted }}>
                Toggle free parameters for this extraction step.
                {step.params.filter(p => p.released).length} of {step.params.length} released.
              </div>
              {(["high", "med", "low"] as Sensitivity[]).map(level => {
                const lp = step.params.filter(p => p.sensitive === level);
                if (!lp.length) return null;
                const lLabel = { high: "High sensitivity", med: "Medium sensitivity", low: "Low sensitivity" }[level];
                const lColor = { high: C.error, med: "#b45309", low: C.muted }[level];
                return (
                  <div key={level}>
                    <div style={{ padding: "4px 12px", fontSize: 9, color: lColor, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", backgroundColor: C.surface, borderBottom: `1px solid ${C.border}` }}>
                      {lLabel}
                    </div>
                    {lp.map(p => (
                      <div key={p.name}
                        onClick={() => toggleParam(p.name)}
                        style={{
                          padding: "7px 12px", borderBottom: `1px solid ${C.border}`, cursor: "pointer",
                          display: "flex", alignItems: "flex-start", gap: 8,
                          backgroundColor: p.released ? "#f0f9ff" : "transparent",
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = p.released ? "#dbeafe" : C.hover}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = p.released ? "#f0f9ff" : "transparent"}
                      >
                        <div style={{
                          width: 15, height: 15, borderRadius: 3, flexShrink: 0, marginTop: 2,
                          border: `1.5px solid ${p.released ? C.primary : C.border}`,
                          backgroundColor: p.released ? C.primary : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {p.released && <div style={{ width: 7, height: 7, backgroundColor: "#fff", borderRadius: 1, clipPath: "polygon(14% 44%,0 65%,50% 100%,100% 16%,80% 0%,43% 62%)" }} />}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: p.released ? C.primary : C.text }}>{p.name}</span>
                            <span style={{ fontFamily: mono, fontSize: 10, color: C.muted }}>{p.value}</span>
                            <span style={{ fontSize: 10, color: C.muted }}>{p.unit}</span>
                          </div>
                          <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{p.desc}</div>
                        </div>
                        {p.released
                          ? <Unlock size={11} color={C.primary} style={{ flexShrink: 0, marginTop: 3 }} />
                          : <Lock size={11} color={C.border} style={{ flexShrink: 0, marginTop: 3 }} />}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Convergence tab */}
          {activeTab === "convergence" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {step.iters && step.rmse ? (
                <>
                  <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {[
                      { label: "Iterations", value: String(step.iters) },
                      { label: "Final RMSE",  value: `${step.rmse}%` },
                      { label: "R²",          value: String(step.r2) },
                      { label: "Mode",        value: { sim: "Sim", fit: "Fit", "fit-protected": "Fit+P" }[runMode] },
                    ].map(m => (
                      <div key={m.label} style={{ textAlign: "center", padding: "4px 0", borderRadius: 4, backgroundColor: C.bg }}>
                        <div style={{ fontSize: 15, fontWeight: 700, fontFamily: mono, color: C.text }}>{m.value}</div>
                        <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{m.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ flex: 1, padding: "8px 4px 4px" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={makeConvergence(step.iters, step.rmse)} margin={{ top: 4, right: 14, bottom: 22, left: 14 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="iter" tick={{ fontSize: 9, fontFamily: mono, fill: C.muted }}
                          label={{ value: "Iteration", position: "insideBottom", offset: -12, style: { fontSize: 10, fill: C.muted } }} />
                        <YAxis tick={{ fontSize: 9, fontFamily: mono, fill: C.muted }} tickFormatter={v => `${v.toFixed(0)}%`} />
                        <Tooltip formatter={(v: number) => [`${v.toFixed(2)}%`, "RMSE"]}
                          contentStyle={{ fontSize: 10, fontFamily: mono, border: `1px solid ${C.border}`, borderRadius: 4 }} />
                        <ReferenceLine y={step.rmse} stroke={C.success} strokeDasharray="4 2"
                          label={{ value: `${step.rmse}%`, fill: C.success, fontSize: 9, position: "right" }} />
                        <Line type="monotone" dataKey="rmse" stroke={C.primary} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7, color: C.muted }}>
                  <BarChart2 size={24} color={C.border} />
                  <div style={{ fontSize: 12 }}>No convergence data yet</div>
                  <div style={{ fontSize: 11 }}>Run Fit to populate</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── helpers ────────────────────────────────────────────── */
function CField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const inp: React.CSSProperties = {
  width: "100%", padding: "5px 8px", borderRadius: 4,
  border: `1px solid ${C.border}`, backgroundColor: C.bg,
  color: C.text, fontSize: 12, fontFamily: ff,
  outline: "none", boxSizing: "border-box",
};
