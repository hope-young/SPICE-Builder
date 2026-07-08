// ExportScreen.tsx - 导出 .lib / .subckt (真实 API)
import { useState } from "react";
import {
  Download, FileText, CheckCircle2, Package, AlertCircle, Server, Play,
} from "lucide-react";
import { Card, CardHeader, Button, Badge, Input } from "./ui";
import { useApp } from "../../lib/store";
import { invoke } from "@tauri-apps/api/core";

const C = {
  bg: "#ffffff", surface: "#fafafa", border: "#e5e5e5",
  text: "#2c2c2c", muted: "#6b7280",
  primary: "#0d99ff", success: "#14ae5c", warning: "#ffcd29", error: "#f24822",
  accent: "#e6f4ff", hover: "#f5f5f5",
};

export function ExportScreen() {
  const { projectId, dataset, fitResult, model, exportLib, backendRunning, startBackend, setLog } = useApp();
  const [format, setFormat] = useState<"subckt" | "bsim3">("subckt");
  const [subcktName, setSubcktName] = useState("SDH10N2P1");
  const [outputPath, setOutputPath] = useState("");
  const [exporting, setExporting] = useState(false);
  const [lastResult, setLastResult] = useState<{
    path: string; file_size: number;
  } | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const onPickPath = async () => {
    try {
      const defaultName = `${dataset?.device_info?.part_number || "model"}.lib`;
      const path = await invoke<string>("save_file_dialog", { defaultName });
      if (path) {
        setOutputPath(path);
        setLog("info", `Selected output path: ${path}`);
      }
    } catch (e: unknown) {
      setLog("error", `Dialog failed: ${e instanceof Error ? e.message : String(e) || e}`);
    }
  };

  const onExport = async () => {
    if (!projectId) {
      setLastError("No project loaded. Open DataBrowser first.");
      return;
    }
    if (!outputPath) {
      setLastError("Pick an output path first.");
      return;
    }
    setExporting(true);
    setLastError(null);
    try {
      const path = await exportLib(outputPath, format);
      // 读取文件 size
      let size = 0;
      try {
        const content = await invoke<string>("read_text_file", { path });
        size = content.length;
      } catch (_) { /* ignore */ }
      setLastResult({ path, file_size: size });
      setLog("success", `Exported .lib (${format}): ${path} (${size} bytes)`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setLastError(message);
      setLog("error", `Export failed: ${message}`);
    } finally {
      setExporting(false);
    }
  };

  // 预览 (静态: 显示当前 fit 后的拟合参数摘要)
  const partNumber = dataset?.device_info?.part_number || "(unknown)";
  const totalRms = fitResult?.total_rms;
  const fittedCount = model?.fitted ? Object.keys(model.fitted).length : 0;

  const fittedPreview = model?.fitted
    ? Object.keys(model.fitted).slice(0, 12).map((k) => {
        const val = (model.params as any)?.[k];
        const formatted = typeof val === "number"
          ? (Math.abs(val) < 1e-3 || Math.abs(val) > 1e6 ? val.toExponential(2) : val.toFixed(4))
          : "—";
        return `+${k}=${formatted}`;
      }).join("\n")
    : "  (run fit first)";

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", background: C.bg }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Export SPICE Model</h1>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            Export fitted BSIM3 model as .lib {partNumber !== "(unknown)" && `· ${partNumber}`}
          </div>
        </div>
        <Badge variant={backendRunning ? "success" : "error"}>
          <Server size={11} style={{ marginRight: 4, verticalAlign: "middle" }} />
          {backendRunning ? "Backend OK" : "Backend Down"}
        </Badge>
        {!backendRunning && (
          <Button variant="outline" size="sm" onClick={startBackend}>
            <Play size={12} style={{ marginRight: 4 }} />Start Backend
          </Button>
        )}
      </div>

      {/* No project warning */}
      {!projectId && (
        <div style={{
          padding: 20, textAlign: "center", color: C.muted,
          background: C.accent, border: `1px solid ${C.border}`,
          borderRadius: "var(--radius-lg)", marginBottom: 16,
        }}>
          <AlertCircle size={20} style={{ marginBottom: 6, opacity: 0.5 }} />
          <div style={{ fontSize: 13 }}>No project loaded.</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>
            Open <b>Data Browser</b> first to load a SPICE dataset.
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
        {/* Left: config */}
        <Card>
          <CardHeader title="Export Configuration" />

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 4 }}>Format</label>
              <div style={{ display: "flex", gap: 6 }}>
                <Button
                  variant={format === "subckt" ? "primary" : "outline"}
                  size="sm"
                  onClick={() => setFormat("subckt")}
                  style={{ flex: 1 }}
                >
                  <Package size={12} style={{ marginRight: 4 }} />Subckt
                </Button>
                <Button
                  variant={format === "bsim3" ? "primary" : "outline"}
                  size="sm"
                  onClick={() => setFormat("bsim3")}
                  style={{ flex: 1 }}
                >
                  <FileText size={12} style={{ marginRight: 4 }} />BSIM3
                </Button>
              </div>
            </div>

            {format === "subckt" && (
              <div>
                <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 4 }}>Subckt Name</label>
                <Input size="sm" value={subcktName} onChange={(e) => setSubcktName(e.target.value)} />
              </div>
            )}

            <div style={{ height: 1, background: C.border, margin: "8px 0" }} />

            <div>
              <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 4 }}>Output Path</label>
              <div style={{ display: "flex", gap: 6 }}>
                <Input
                  size="sm"
                  value={outputPath}
                  onChange={(e) => setOutputPath(e.target.value)}
                  placeholder="C:/models/SDH10N2P1WC-AA.lib"
                  style={{ flex: 1 }}
                />
                <Button variant="outline" size="sm" onClick={onPickPath}>
                  Browse...
                </Button>
              </div>
            </div>

            <Button
              variant="primary"
              style={{ width: "100%" }}
              onClick={onExport}
              disabled={!projectId || !outputPath || exporting || !backendRunning}
            >
              <Download size={13} style={{ marginRight: 6 }} />
              {exporting ? "Exporting..." : "Export .lib"}
            </Button>

            {/* Result / Error */}
            {lastResult && (
              <div style={{
                padding: 10, borderRadius: "var(--radius-md)",
                background: "#e6f7ed", border: "1px solid #14ae5c",
                color: C.text, fontSize: 11,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <CheckCircle2 size={14} color={C.success} />
                  <span style={{ fontWeight: 600 }}>Exported successfully</span>
                </div>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: C.muted, wordBreak: "break-all" }}>
                  {lastResult.path}
                </div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                  {lastResult.file_size.toLocaleString()} bytes
                </div>
              </div>
            )}
            {lastError && (
              <div style={{
                padding: 10, borderRadius: "var(--radius-md)",
                background: "#fff5f5", border: "1px solid #f24822",
                color: C.text, fontSize: 11,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <AlertCircle size={14} color={C.error} />
                  <span style={{ fontWeight: 600 }}>Error</span>
                </div>
                <div style={{ fontSize: 10, marginTop: 4, color: C.muted }}>{lastError}</div>
              </div>
            )}
          </div>
        </Card>

        {/* Right: preview */}
        <Card>
          <CardHeader
            title="Preview"
            subtitle={format === "subckt" ? `Subckt wrapper (${subcktName})` : "Pure BSIM3 .model"}
            action={
              <div style={{ display: "flex", gap: 6 }}>
                <Badge variant="primary">BSIM3v3</Badge>
                <Badge variant="success">{fittedCount} fitted</Badge>
                {totalRms !== undefined && (
                  <Badge variant={totalRms < 1.0 ? "success" : "warning"}>
                    RMS = {totalRms.toFixed(3)}
                  </Badge>
                )}
              </div>
            }
          />
          <pre
            style={{
              fontFamily: "'JetBrains Mono', Consolas, monospace",
              fontSize: 11, lineHeight: 1.6,
              padding: 12, background: C.surface,
              border: `1px solid ${C.border}`, borderRadius: "var(--radius-md)",
              overflow: "auto", maxHeight: 480, margin: 0, color: C.text,
            }}
          >
{`* SpiceBuilder Export
* Device: ${partNumber}
* Format: ${format === "subckt" ? "B (subckt wrapper)" : "A (pure BSIM3 .model)"}
${totalRms !== undefined ? `* Total RMS: ${totalRms.toFixed(4)}\n` : ""}${format === "subckt" ? `* Subckt name: ${subcktName}\n` : ""}* Fitted params: ${fittedCount}

.SUBCKT ${subcktName} D G S
M1 D_int G_int S S BSIM3_core L=1u W=4e6u
Rg G G_int ${dataset?.key_params?.rg_internal_ohm ?? 1.6}
Rd D D_int RD_val
Rs S_int S RS_val
.ENDS

.MODEL BSIM3_core NMOS LEVEL=49
${fittedPreview}
+... (${fittedCount} params total)
.END`}
          </pre>

          {/* Summary footer */}
          <div style={{
            marginTop: 12, padding: 10,
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: "var(--radius-md)", fontSize: 11, color: C.muted,
          }}>
            <strong style={{ color: C.text }}>Summary:</strong>{" "}
            {partNumber} · {fittedCount} fitted params ·{" "}
            {totalRms !== undefined
              ? `Total RMS ${totalRms.toFixed(3)}`
              : "no fit run yet"}
          </div>
        </Card>
      </div>
    </div>
  );
}
