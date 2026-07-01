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

// 6 阶段定义
const STAGE_DEFS = [
  { id: "S1", name: "Threshold", params: ["VTH0", "K1", "K2", "NFACTOR"] },
  { id: "S2", name: "Subthreshold", params: ["NFACTOR", "CDSCD", "CDSCB"] },
  { id: "S3", name: "Linear Mobility", params: ["U0", "UA", "UB", "UC"] },
  { id: "S4", name: "Saturation", params: ["VSAT", "A0", "AGS", "KETA", "RD", "RS"] },
  { id: "S5", name: "Output Resistance", params: ["PCLM", "PDIBLC1", "DROUT", "PVAG"] },
  { id: "S6", name: "Capacitance & Diode", params: ["CGSO", "CGDO", "CGBO", "IS", "N", "MJ"] },
];

export function FittingPipeline() {
  const { projectId, fitResult, fitProgress, fitProgressStatus,
          runFit, logs, backendRunning, setLog } = useApp();
  const [running, setRunning] = useState(false);
  const [useLtspice, setUseLtspice] = useState(false);
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
      await runFit(useLtspice);
    } catch (e: any) {
      setLog("error", e.message);
    } finally {
      setRunning(false);
    }
  };

  const onStop = () => {
    setRunning(false);
    setLog("warn", "Fit stopped by user (the backend task may still run to completion)");
  };

  // Map fitProgress (0..1) to the active stage index.  Stages span:
  //   S1 [0.05-0.20)   S2 [0.20-0.35)   S3 [0.35-0.50)
  //   S4 [0.50-0.65)   S5 [0.65-0.80)   S6 [0.80-1.00)
  const STAGE_BANDS: [number, number][] = [
    [0.05, 0.20], [0.20, 0.35], [0.35, 0.50],
    [0.50, 0.65], [0.65, 0.80], [0.80, 1.00],
  ];
  const activeStageIdx = (() => {
    if (!running || fitProgress === null) return -1;
    for (let i = 0; i < STAGE_BANDS.length; i++) {
      const [lo, hi] = STAGE_BANDS[i];
      if (fitProgress >= lo && fitProgress < hi) return i;
    }
    return STAGE_BANDS.length - 1;
  })();
  const activeStageId = activeStageIdx >= 0 ? STAGE_DEFS[activeStageIdx].id : null;

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

      {/* Total RMS Banner */}
      {fitResult && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>TOTAL RMS</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: C.primary }}>
                {fitResult.total_rms.toFixed(3)}
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