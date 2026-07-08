// CurveVisualizer.tsx - 5-subplot 曲线可视化器 (真实 API)
import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, RefreshCw, Power, FileText, AlertCircle,
} from "lucide-react";
import { Card, CardHeader, Button, Badge } from "./ui";
import { useApp } from "../../lib/store";
import * as api from "../../lib/api";

const C = {
  bg: "#ffffff", surface: "#fafafa", border: "#e5e5e5",
  text: "#2c2c2c", muted: "#6b7280",
  primary: "#0d99ff", success: "#14ae5c", warning: "#ffcd29", error: "#f24822",
  accent: "#e6f4ff", hover: "#f5f5f5",
};

// 5 个曲线 subplot 定义
interface SubplotDef {
  id: string;
  title: string;
  curveType: string;
  yScale: "log" | "linear";
  xLabel: string;
  yLabel: string;
  color: string;
}

const SUBPLOTS: SubplotDef[] = [
  { id: "idvg5",   title: "Id-Vg @ Vds=5V",     curveType: "idvg_vds5",  yScale: "log",    xLabel: "Vgs (V)", yLabel: "Id (A) [log]",    color: "#0d99ff" },
  { id: "idvg05",  title: "Id-Vg @ Vds=0.5V",   curveType: "idvg_vds05", yScale: "log",    xLabel: "Vgs (V)", yLabel: "Id (A) [log]",    color: "#14ae5c" },
  { id: "idvd",    title: "Id-Vd",              curveType: "idvd",       yScale: "linear", xLabel: "Vds (V)", yLabel: "Id (A) [linear]", color: "#9b59b6" },
  { id: "cv",      title: "C-V @ 1MHz",         curveType: "cv_vds",     yScale: "log",    xLabel: "Vds (V)", yLabel: "Cap (pF) [log]",  color: "#f24822" },
  { id: "diode",   title: "Body Diode",         curveType: "body_diode", yScale: "log",    xLabel: "Vsd (V)", yLabel: "Is (A) [log]",    color: "#ff9f1c" },
];

interface CurveData {
  ivar: number[];
  dvar: number[];
  metadata: Record<string, unknown>;
  loading: boolean;
  error: string | null;
}

export function CurveVisualizer() {
  const { projectId, dataset, fitResult, backendRunning, startBackend, setLog } = useApp();

  // 每个 subplot 的曲线数据 + 加载状态
  const [data, setData] = useState<Record<string, CurveData>>(() => {
    const init: Record<string, CurveData> = {};
    SUBPLOTS.forEach((s) => {
      init[s.id] = { ivar: [], dvar: [], metadata: {}, loading: false, error: null };
    });
    return init;
  });

  // Backend 启动
  const onStartBackend = async () => {
    setLog("info", "Starting Python backend...");
    await startBackend();
  };

  // 拉取一个 subplot 的曲线
  const refreshCurve = async (id: string, curveType: string) => {
    if (!projectId) return;
    setData((prev) => ({ ...prev, [id]: { ...prev[id], loading: true, error: null } }));
    try {
      const c = await api.getCurve(projectId, curveType);
      setData((prev) => ({
        ...prev,
        [id]: { ivar: c.ivar, dvar: c.dvar, metadata: c.metadata, loading: false, error: null },
      }));
      setLog("success", `Loaded ${curveType}: ${c.ivar.length} pts`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setData((prev) => ({ ...prev, [id]: { ...prev[id], loading: false, error: message } }));
      setLog("error", `Load ${curveType} failed: ${message}`);
    }
  };

  // 自动首次加载
  useEffect(() => {
    if (!projectId) return;
    SUBPLOTS.forEach((s) => refreshCurve(s.id, s.curveType));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", background: C.bg }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 17, fontWeight: 600, color: C.text, margin: 0 }}>
            Curve Visualizer
          </h1>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            5 subplots · {projectId ? `Project ${projectId.slice(0, 8)}` : "No project loaded"}
            {fitResult && ` · Total RMS = ${fitResult.total_rms.toFixed(3)}`}
          </div>
        </div>
        <Badge variant={backendRunning ? "success" : "error"}>
          {backendRunning ? "● Backend OK" : "● Backend Down"}
        </Badge>
        {!backendRunning && (
          <Button onClick={onStartBackend} variant="primary" style={{ marginLeft: 8 }}>
            <Power size={12} /> Start Backend
          </Button>
        )}
      </div>

      {/* Empty state */}
      {!projectId && (
        <Card>
          <div style={{ textAlign: "center", padding: 48, color: C.muted }}>
            <FileText size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
            <div style={{ fontSize: 13 }}>No project loaded.</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>Open Data Browser to load a SPICE dataset.</div>
          </div>
        </Card>
      )}

      {/* 2x3 Grid: 5 subplots + Device Info */}
      {projectId && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {SUBPLOTS.map((s) => (
            <Subplot
              key={s.id}
              def={s}
              data={data[s.id]}
              onRefresh={() => refreshCurve(s.id, s.curveType)}
            />
          ))}
          <DeviceInfoCard
            projectId={projectId}
            dataset={dataset}
            fitResult={fitResult}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
//  Subplot 子组件
// ============================================================
function Subplot({ def, data, onRefresh }: {
  def: SubplotDef; data: CurveData; onRefresh: () => void;
}) {
  // 转 recharts data
  const points = data.ivar.map((v, i) => ({ x: v, y: data.dvar[i] }));

  return (
    <Card>
      {/* 标题 + Refresh */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.text, flex: 1 }}>
          {def.title}
        </span>
        <span style={{ fontSize: 10, color: C.muted, marginRight: 6 }}>
          {data.loading ? "loading…" :
           data.error ? `error: ${data.error.slice(0, 20)}` :
           `${data.ivar.length} pts`}
        </span>
        <button
          onClick={onRefresh}
          disabled={data.loading}
          title="Refresh curve"
          style={{
            background: "transparent", border: `1px solid ${C.border}`,
            borderRadius: "var(--radius-sm)", padding: "2px 6px", cursor: data.loading ? "wait" : "pointer",
            display: "flex", alignItems: "center", gap: 3,
            fontSize: 10, color: C.muted, opacity: data.loading ? 0.5 : 1,
          }}
        >
          <RefreshCw size={10} className={data.loading ? "spin" : ""} /> Refresh
        </button>
      </div>

      {/* 图 */}
      <div style={{ height: 200 }}>
        {data.ivar.length === 0 && !data.loading ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100%", color: C.muted, fontSize: 11,
          }}>
            <AlertCircle size={14} style={{ marginRight: 4 }} />
            No data. Click Refresh.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 6, right: 12, bottom: 18, left: 18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis
                dataKey="x"
                type="number"
                tick={{ fontSize: 9, fill: C.muted }}
                stroke={C.border}
                label={{ value: def.xLabel, position: "insideBottom", offset: -6, style: { fontSize: 10, fill: C.muted } }}
              />
              <YAxis
                scale={def.yScale}
                domain={["auto", "auto"]}
                tick={{ fontSize: 9, fill: C.muted }}
                stroke={C.border}
                allowDataOverflow={def.yScale === "log"}
                label={{
                  value: def.yLabel, angle: -90,
                  position: "insideLeft", offset: 10,
                  style: { fontSize: 10, fill: C.muted },
                }}
              />
              <Tooltip
                contentStyle={{
                  background: "#fff", border: `1px solid ${C.border}`,
                  borderRadius: "var(--radius-sm)", fontSize: 10,
                }}
                formatter={(v: number) => v.toExponential(2)}
              />
              <Line
                type="monotone"
                dataKey="y"
                stroke={def.color}
                strokeWidth={1.4}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

// ============================================================
//  Device Info 子组件
// ============================================================
function DeviceInfoCard({ projectId, dataset, fitResult }: {
  projectId: string;
  dataset: any;
  fitResult: any;
}) {
  return (
    <Card>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>
        Device Info
      </div>
      <Row label="Project ID" value={projectId.slice(0, 8) + "…"} mono />
      {dataset && (
        <>
          <Row label="Part" value={dataset.device_info.part_number} />
          <Row label="Package" value={dataset.device_info.package} />
          <Row label="BVdss" value={`${dataset.device_info.bvdss_v} V`} />
          <Row label="RDSon max" value={`${dataset.device_info.rdson_max_mohm} mΩ`} />
          <Row label="Id rated" value={`${dataset.device_info.id_rated_a} A`} />
          <Row label="Vth typ" value={`${dataset.device_info.vth_typ_v} V`} />
        </>
      )}
      {dataset?.key_params && (
        <>
          <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase",
                        marginTop: 8, marginBottom: 4, letterSpacing: "0.05em" }}>
            Key SPICE Params
          </div>
          <Row label="Vth25" value={`${dataset.key_params.vth_25c_v} V`} />
          <Row label="RDSon@10V" value={`${(dataset.key_params.rdson_25c_10v_ohm * 1e3).toFixed(2)} mΩ`} />
          <Row label="Qg@20V" value={`${dataset.key_params.qg_on_20v_nc} nC`} />
          <Row label="Ciss@25V" value={`${dataset.key_params.ciss_25v_pf} pF`} />
        </>
      )}
      {fitResult && (
        <>
          <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase",
                        marginTop: 8, marginBottom: 4, letterSpacing: "0.05em" }}>
            Last Fit
          </div>
          <Row label="Total RMS" value={fitResult.total_rms.toFixed(3)} />
          <Row label="Success" value={fitResult.success ? "✓" : "✗"} />
          <Row label="Stages" value={`${fitResult.stage_results?.length || 0} / 6`} />
        </>
      )}
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      padding: "2px 0", fontSize: 11,
    }}>
      <span style={{ color: C.muted }}>{label}</span>
      <span style={{
        color: C.text,
        fontFamily: mono || true ? "'JetBrains Mono', Consolas, monospace" : "inherit",
      }}>{value}</span>
    </div>
  );
}
