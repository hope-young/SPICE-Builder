// ValidateScreen.tsx - 验证 (真实 API)
import { useState, useCallback } from "react";
import {
  CheckCircle2, AlertTriangle, XCircle, RotateCcw, Activity, Server, Power,
} from "lucide-react";
import { Card, CardHeader, Button, Badge } from "./ui";
import { useApp } from "../../lib/store";
import * as api from "../../lib/api";

const C = {
  bg: "#ffffff", surface: "#fafafa", border: "#e5e5e5",
  text: "#2c2c2c", muted: "#6b7280",
  primary: "#0d99ff", success: "#14ae5c", warning: "#ffcd29", error: "#f24822",
  accent: "#e6f4ff",
};

interface Check {
  pass: boolean;
  warn?: boolean;
  label: string;
  detail: string;
}

export function ValidateScreen() {
  const { projectId, model, fitResult, backendRunning, startBackend, refreshBackend } = useApp();
  const [checking, setChecking] = useState(false);

  const onValidate = useCallback(async () => {
    setChecking(true);
    await refreshBackend();
    setChecking(false);
  }, [refreshBackend]);

  // Build checks from store + fitResult
  const checks: Check[] = [
    {
      pass: backendRunning,
      label: "Backend connected",
      detail: backendRunning
        ? "Python FastAPI @ http://127.0.0.1:8000"
        : "Backend not running — click Start Backend",
    },
    {
      pass: !!projectId,
      label: "Project loaded",
      detail: projectId ? `project_id = ${projectId.slice(0, 8)}…` : "No project (open Data Browser)",
    },
    {
      pass: !!model,
      label: "Model initialized",
      detail: model
        ? `${Object.keys(model.params || {}).length} BSIM3 params ready`
        : "No model (load a project first)",
    },
    {
      pass: !!(fitResult?.success),
      label: "Fit done",
      detail: fitResult
        ? `total RMS = ${fitResult.total_rms.toFixed(3)}${fitResult.success ? " (converged)" : " (failed)"}`
        : "No fit yet (run Fitting Pipeline)",
    },
    // LTspice validation entries derived from fitResult
    ...(fitResult?.stage_results || []).map((s) => ({
      pass: s.success,
      warn: s.success && s.rms > 1.0,
      label: `Stage ${s.stage_name} fit RMS`,
      detail: `RMS = ${s.rms.toFixed(3)} (${s.iterations} iters)`,
    })),
  ];

  const passed = checks.filter((c) => c.pass).length;
  const warnings = checks.filter((c) => c.warn).length;
  const failed = checks.filter((c) => !c.pass && !c.warn).length;

  // Color coding for total RMS
  const rms = fitResult?.total_rms;
  const rmsColor =
    rms === undefined ? C.muted :
    rms < 0.5 ? C.success :
    rms < 1.0 ? C.warning : C.error;
  const rmsLabel =
    rms === undefined ? "—" :
    rms < 0.5 ? "OK" :
    rms < 1.0 ? "Warning" : "Error";

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", background: C.bg }}>
      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: C.text }}>Validation</h1>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            Cross-check fitted model against backend & fit data
          </div>
        </div>
        <Badge variant={backendRunning ? "success" : "error"}>
          <Server size={11} style={{ marginRight: 4 }} />
          {backendRunning ? "Backend OK" : "Backend Down"}
        </Badge>
        {!backendRunning && (
          <Button variant="primary" onClick={() => startBackend()}>
            <Power size={13} style={{ marginRight: 5 }} />Start Backend
          </Button>
        )}
        <Button variant="outline" onClick={onValidate} disabled={checking}>
          <RotateCcw size={13} style={{ marginRight: 5 }} />
          {checking ? "Checking…" : "Validate"}
        </Button>
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CheckCircle2 size={20} color={C.success} />
            <div>
              <div style={{ fontSize: 11, color: C.muted }}>PASSED</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: C.success, fontFamily: "ui-monospace, monospace" }}>{passed}</div>
            </div>
          </div>
        </Card>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={20} color={C.warning} />
            <div>
              <div style={{ fontSize: 11, color: C.muted }}>WARNINGS</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: C.warning, fontFamily: "ui-monospace, monospace" }}>{warnings}</div>
            </div>
          </div>
        </Card>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <XCircle size={20} color={C.error} />
            <div>
              <div style={{ fontSize: 11, color: C.muted }}>FAILED</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: C.error, fontFamily: "ui-monospace, monospace" }}>{failed}</div>
            </div>
          </div>
        </Card>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Activity size={20} color={rmsColor} />
            <div>
              <div style={{ fontSize: 11, color: C.muted }}>TOTAL RMS</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: rmsColor, fontFamily: "ui-monospace, monospace" }}>
                  {rms === undefined ? "—" : rms.toFixed(3)}
                </div>
                <Badge variant={
                  rms === undefined ? "default" :
                  rms < 0.5 ? "success" :
                  rms < 1.0 ? "warning" : "error"
                }>
                  {rmsLabel}
                </Badge>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Checks List */}
      <Card>
        <CardHeader
          title="Consistency Checks"
          subtitle={`${checks.length} total · ${passed} passed · ${warnings} warnings · ${failed} failed`}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {checks.map((c, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "8px 12px",
                backgroundColor: c.pass ? "transparent" : c.warn ? "#fff9e6" : "#ffe6e6",
                borderRadius: "var(--radius-sm)",
                fontSize: 12,
              }}
            >
              {c.pass ? (
                <CheckCircle2 size={14} color={C.success} style={{ marginTop: 2 }} />
              ) : c.warn ? (
                <AlertTriangle size={14} color={C.warning} style={{ marginTop: 2 }} />
              ) : (
                <XCircle size={14} color={C.error} style={{ marginTop: 2 }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ color: C.text, fontWeight: 500 }}>{c.label}</div>
                <div style={{ color: C.muted, fontSize: 11, fontFamily: "ui-monospace, monospace", marginTop: 2 }}>
                  {c.detail}
                </div>
              </div>
              <Badge variant={c.pass ? "success" : c.warn ? "warning" : "error"}>
                {c.pass ? "PASS" : c.warn ? "WARN" : "FAIL"}
              </Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
