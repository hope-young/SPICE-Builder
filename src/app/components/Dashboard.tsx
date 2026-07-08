// Dashboard.tsx - 项目概览 (真实 API)
import {
  Activity, FileText, Clock, TrendingUp, Zap, Cpu, RefreshCw
} from "lucide-react";
import { Card, Badge } from "./ui";
import { useApp } from "../../lib/store";

export function Dashboard() {
  const { projectId, dataset, fitResult, model, backendRunning, refreshBackend } = useApp();

  const totalParams = model ? Object.keys(model.params || {}).length : 0;
  const fittedParams = model && model.fitted ? Object.keys(model.fitted).length : 0;
  const stages = fitResult?.stage_results?.length || 0;

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", background: "#ffffff" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: "#2c2c2c", marginBottom: 4 }}>
            Dashboard
          </h1>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            Project: {dataset?.device_info?.part_number || "—"}  ·  {dataset?.device_info?.package || ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Badge variant={backendRunning ? "success" : "error"}>
            {backendRunning ? "● Backend OK" : "● Backend Down"}
          </Badge>
          <button
            onClick={refreshBackend}
            style={{
              background: "transparent", border: "1px solid #e5e5e5",
              padding: "4px 10px", borderRadius: "var(--radius-md)", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4, fontSize: 12,
            }}
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* Key Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <MetricCard
          icon={<Activity size={14} color="#0d99ff" />}
          label="Overall RMS"
          value={fitResult ? fitResult.total_rms.toFixed(3) : "—"}
          color={fitResult?.success ? "#14ae5c" : "#6b7280"}
        />
        <MetricCard
          icon={<FileText size={14} color="#0d99ff" />}
          label="Stages Done"
          value={`${stages} / 6`}
          color="#2c2c2c"
        />
        <MetricCard
          icon={<Cpu size={14} color="#0d99ff" />}
          label="BSIM3 Params"
          value={`${fittedParams} / ${totalParams}`}
          sub={totalParams ? `${totalParams} total` : ""}
          color="#2c2c2c"
        />
        <MetricCard
          icon={<Zap size={14} color="#0d99ff" />}
          label="Project ID"
          value={projectId ? projectId.slice(0, 8) : "—"}
          sub={projectId ? "loaded" : "no project"}
          color="#2c2c2c"
        />
      </div>

      {/* Project Info Card */}
      {dataset && (
        <Card>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
            <div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>DEVICE</div>
              <Row label="Part" value={dataset.device_info.part_number} />
              <Row label="Package" value={dataset.device_info.package} />
              <Row label="BVdss" value={`${dataset.device_info.bvdss_v} V`} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>RATINGS</div>
              <Row label="RDSon max" value={`${dataset.device_info.rdson_max_mohm} mΩ`} />
              <Row label="Id rated" value={`${dataset.device_info.id_rated_a} A`} />
              <Row label="Vth typ" value={`${dataset.device_info.vth_typ_v} V`} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>KEY PARAMS</div>
              <Row label="Vth25" value={`${dataset.key_params.vth_25c_v} V`} />
              <Row label="RDSon@10V" value={`${dataset.key_params.rdson_25c_10v_ohm * 1e3} mΩ`} />
              <Row label="Qg@20V" value={`${dataset.key_params.qg_on_20v_nc} nC`} />
              <Row label="Ciss@25V" value={`${dataset.key_params.ciss_25v_pf} pF`} />
            </div>
          </div>
        </Card>
      )}

      {/* No project */}
      {!projectId && (
        <Card>
          <div style={{ textAlign: "center", padding: 32, color: "#6b7280" }}>
            <FileText size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
            <div style={{ fontSize: 13 }}>No project loaded.</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>
              Open <b>Data Browser</b> to load a SPICE dataset.
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div style={{
      background: "#fafafa", border: "1px solid #e5e5e5",
      borderRadius: "var(--radius-lg)", padding: "12px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        {icon}
        <span style={{ fontSize: 11, color: "#6b7280" }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      padding: "3px 0", fontSize: 12,
    }}>
      <span style={{ color: "#6b7280" }}>{label}</span>
      <span style={{ color: "#2c2c2c", fontFamily: "ui-monospace, monospace" }}>{value}</span>
    </div>
  );
}
