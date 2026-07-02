// FittingPipeline.tsx - 6 阶段拟合 pipeline (真实 API)
import { useState, useRef, useEffect } from "react";
import {
  Play, Square, RotateCcw, ChevronRight, CheckCircle2,
  Loader, AlertCircle, Clock, Terminal, Settings2,
} from "lucide-react";
import { Button, Badge, Card, CardHeader } from "./ui";
import { useApp } from "../../lib/store";
import type { StageStatus } from "../../lib/types";

const C = {
  bg: "#ffffff", surface: "#fafafa", border: "#e5e5e5",
  text: "#2c2c2c", muted: "#6b7280",
  primary: "#0d99ff", success: "#14ae5c", warning: "#ffcd29", error: "#f24822",
  accent: "#e6f4ff", hover: "#f5f5f5",
};

// 阶段定义 (top-level)
const STAGE_DEFS: { id: string; name: string; params: string[] }[] = [
  { id: "S1", name: "Threshold", params: ["VTH0", "K1", "K2", "NFACTOR"] },
  { id: "S2", name: "Subthreshold", params: ["NFACTOR", "CDSCD", "CDSCB"] },
  { id: "S3", name: "Linear Mobility", params: ["U0", "UA", "UB", "UC"] },
  { id: "S4", name: "Saturation", params: ["VSAT", "A0", "AGS", "KETA", "RD", "RS"] },
  { id: "S5", name: "Output Resistance", params: ["PCLM", "PDIBLC1", "DROUT", "PVAG"] },
];
// S6 was a single "Capacitance & Diode" stage; the backend now splits it
// into 4 sub-stages (S6_Ciss, S6_Coss, S6_Crss, S6_BodyDiode) so the
// per-cap-type optimizer can run independently.
const SUB_STAGE_DEFS: { id: string; name: string; params: string[] }[] = [
  { id: "S6_Ciss", name: "Ciss", params: ["CGSO", "CGDO", "CGBO"] },
  { id: "S6_Coss", name: "Coss", params: ["CGSO", "CGDO", "CGBO"] },
  { id: "S6_Crss", name: "Crss", params: ["CGSO", "CGDO", "CGBO"] },
  { id: "S6_BodyDiode", name: "Body Diode", params: ["IS", "N", "MJ", "MJSW", "PB", "PBSW"] },
];

export function FittingPipeline() {
  const { projectId, fitResult, fitProgress, fitProgressStatus,
          currentStage, currentLoop,
          runFit, cancelFit, logs, backendRunning, setLog } = useApp();
  const [running, setRunning] = useState(false);
  const [useLtspice, setUseLtspice] = useState(false);
  const [maxLoops, setMaxLoops] = useState(3);
  const logRef = useRef<HTMLDivElement>(null);

  // 自动滚到 log 末尾
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const onRun = async () => {
    if (!projectId) {
      setLog("error", "Load a project first (Data Browser)");
      return;
    }
    if (!backendRunning) {
      setLog("error", "Python backend not running");
      return;
    }
    setRunning(true);
    try {
      // runFit now polls task.progress on its own; it resolves when done.
      await runFit(useLtspice, maxLoops);
    } catch (e: any) {
      setLog("error", e.message);
    } finally {
      setRunning(false);
    }
  };

  const onStop = async () => {
    setRunning(false);
    try {
      await cancelFit();
    } catch (e: any) {
      setLog("error", `Stop failed: ${e.message}`);
    }
  };
  // The backend task now reports the active stage name directly
  // via currentStage (e.g. "S3_LinearMobility").  The old
  // STAGE_BANDS hardcoded map went out of sync whenever the
  // backend skipped a stage (S2 is disabled in sgt_6stage.py),
  // so we use the explicit string instead.
  const activeStageId = currentStage ? currentStage.split("_")[0] : null;
  const activeStageIdx = activeStageId
    ? STAGE_DEFS.findIndex((d) => d.id === activeStageId)
    : -1;
  // 计算 stage status from fitResult + running state
  const getStageStatus = (stageId: string): StageStatus => {
    if (!fitResult && !running) return "pending";
    if (running && activeStageId === stageId) return "running";
    if (running && activeStageIdx >= 0 && STAGE_DEFS[activeStageIdx].id === stageId) return "running";
    const sr = fitResult?.stage_results?.find((s) => s.stage_name.startsWith(stageId));
    if (!sr) return "pending";
    return sr.success ? "done" : "error";
  };

  const getStageRms = (stageId: string): number | undefined => {
    if (!fitResult) return undefined;
    const sr = fitResult.stage_results?.find((s) => s.stage_name.startsWith(stageId));
    return sr?.rms;
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", background: C.bg }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: C.text, marginBottom: 4 }}>
            Fitting Pipeline
          </h1>
          <div style={{ fontSize: 12, color: C.muted }}>
            6-stage Si SGT extraction · {projectId ? `Project ${projectId.slice(0, 8)}` : "No project loaded"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.text }}>
            <input
              type="checkbox"
              checked={useLtspice}
              onChange={(e) => setUseLtspice(e.target.checked)}
              disabled={running}
            />
            LTspice (slow but accurate)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.text }}>
            <span>Loops:</span>
            <select value={maxLoops} disabled={running} onChange={(e) => setMaxLoops(parseInt(e.target.value, 10))} style={{ padding: "2px 4px", borderRadius: 4, border: "1px solid " + C.border }}>
              <option value={1}>1</option>
              <option value={3}>3 (default)</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
            </select>
          </label>
          {!running ? (
            <Button onClick={onRun} variant="primary">
              <Play size={14} /> Run Fit
            </Button>
          ) : (
            <Button onClick={onStop} variant="danger">
              <Square size={14} /> Stop
            </Button>
          )}
        </div>
      </div>

      {/* Stage Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 16 }}>
        {STAGE_DEFS.map((s) => {
          const status = getStageStatus(s.id);
          const rms = getStageRms(s.id);
          return (
            <StageCard
              key={s.id}
              id={s.id}
              name={s.name}
              params={s.params}
              status={status}
              rms={rms}
            />
          );
        })}
        {SUB_STAGE_DEFS.map((s) => {
          const status = getStageStatus(s.id);
          // Sub-stages share RMS display with the parent S6 if it
          // exists in stage_results (legacy format), else show nothing.
          const rms = getStageRms("S6");
          return (
            <StageCard
              key={s.id}
              id={s.id}
              name={s.name}
              params={s.params}
              status={status}
              rms={status === "running" ? undefined : rms}
            />
          );
        })}
      </div>

      {/* Live progress bar driven by store.fitProgress (polled from backend). */}
      {running && fitProgress !== null && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 12, color: C.muted, minWidth: 110 }}>
              {fitProgressStatus.toUpperCase() || "RUNNING"}
              {activeStageId ? ` · ${activeStageId}` : ""}
            </div>
            <div style={{ flex: 1, height: 8, background: "#eee", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                width: `${Math.round(fitProgress * 100)}%`,
                height: "100%",
                background: "linear-gradient(90deg, #0d99ff, #14ae5c)",
                transition: "width 0.4s ease",
              }} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text, minWidth: 40, textAlign: "right" }}>
              {Math.round(fitProgress * 100)}%
            </div>
          </div>
        </Card>
      )}

      {/* Total RMS / R² Banner */}
      {fitResult && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>TOTAL RMS</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: C.primary }}>
                {fitResult.total_rms.toFixed(3)}
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
                log-NRMSE (lower is better)
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>TOTAL R²</div>
              <div style={{
                fontSize: 28, fontWeight: 700,
                color: (fitResult.r_squared ?? 0) >= 0.9 ? C.success
                       : (fitResult.r_squared ?? 0) >= 0.7 ? C.warning : C.error,
              }}>
                {(fitResult.r_squared ?? 0).toFixed(4)}
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
                goodness of fit (1 is perfect)
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <Badge variant={fitResult.success ? "success" : "error"}>
                {fitResult.success ? "✓ Converged" : "✗ Failed"}
              </Badge>
            </div>
          </div>
        </Card>
      )}

      {/* Log Panel */}
      <Card style={{ marginTop: 16 }}>
        <CardHeader title="Pipeline Log" />
        <div
          ref={logRef}
          style={{
            background: "#1a1a1a", color: "#e0e0e0",
            padding: "12px 16px", borderRadius: 6,
            fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11,
            height: 240, overflowY: "auto",
            lineHeight: 1.5,
          }}
        >
          {logs.length === 0 ? (
            <div style={{ color: "#888" }}>No logs yet. Run a fit to see progress.</div>
          ) : (
            logs.map((l, i) => (
              <div key={i} style={{
                color: l.level === "error" ? "#ff6b6b" :
                       l.level === "warn" ? "#ffd93d" :
                       l.level === "success" ? "#6bcf7f" : "#a8d8ff",
              }}>
                <span style={{ color: "#888", marginRight: 8 }}>[{l.ts}]</span>
                <span style={{ marginRight: 8, fontWeight: 600 }}>{l.level.toUpperCase()}</span>
                {l.msg}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

// Stage Card 子组件
function StageCard({ id, name, params, status, rms }: {
  id: string; name: string; params: string[];
  status: StageStatus; rms?: number;
}) {
  const colorMap = {
    pending: C.muted,
    running: C.primary,
    done: C.success,
    error: C.error,
  };
  const iconMap = {
    pending: <Clock size={14} color={colorMap[status]} />,
    running: <Loader size={14} color={colorMap[status]} className="spin" />,
    done: <CheckCircle2 size={14} color={colorMap[status]} />,
    error: <AlertCircle size={14} color={colorMap[status]} />,
  };
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: "12px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        {iconMap[status]}
        <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 600, color: C.text }}>
          {id}: {name}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: colorMap[status] }}>
          {rms !== undefined ? `RMS = ${rms.toFixed(3)}` : status}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {params.map((p) => (
          <span key={p} style={{
            background: C.accent, color: C.primary,
            padding: "1px 6px", borderRadius: 3,
            fontSize: 10, fontFamily: "ui-monospace, monospace",
          }}>
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}
