// DataBrowser.tsx - 数据浏览器 (真实 API)
import { useState, useEffect } from "react";
import {
  Upload, FileText, Eye, FolderOpen, RefreshCw, Server, ServerOff
} from "lucide-react";
import { Card, CardHeader, Button, Badge } from "./ui";
import { useApp } from "../../lib/store";
import * as api from "../../lib/api";
import { invoke } from "@tauri-apps/api/core";

interface ProjectItem {
  project_id?: string;
  name?: string;
  n_points?: number;
  n_curves?: number;
}

const CURVE_CATALOG = [
  { type: "idvg_5v",  label: "Id-Vg @Vds=5V",   ivarLabel: "Vgs (V)", dvarLabel: "Id (A)" },
  { type: "idvg_05v", label: "Id-Vg @Vds=0.5V", ivarLabel: "Vgs (V)", dvarLabel: "Id (A)" },
  { type: "idvd",     label: "Id-Vd @Vgs=10V",  ivarLabel: "Vds (V)", dvarLabel: "Id (A)" },
  { type: "cv_vds_ciss", label: "Ciss vs Vds",  ivarLabel: "Vds (V)", dvarLabel: "Ciss (pF)" },
  { type: "cv_vds_coss", label: "Coss vs Vds",  ivarLabel: "Vds (V)", dvarLabel: "Coss (pF)" },
  { type: "cv_vds_crss", label: "Crss vs Vds",  ivarLabel: "Vds (V)", dvarLabel: "Crss (pF)" },
  { type: "body_diode",  label: "Body Diode",   ivarLabel: "Vsd (V)", dvarLabel: "Is (A)" },
];

export function DataBrowser() {
  const {
    projectId, dataset, backendRunning,
    loadProject, selectProject, startBackend, refreshBackend, setLog,
  } = useApp();

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedCurve, setSelectedCurve] = useState("idvg_5v");
  const [curvePreview, setCurvePreview] = useState<{ivar: number[]; dvar: number[]; meta: Record<string, unknown>} | null>(null);
  const [loadingCurve, setLoadingCurve] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);

  const refreshProjects = async () => {
    try {
      const ps = await api.listProjects();
      setProjects(ps as ProjectItem[]);
      setLog("info", `Found ${ps.length} project(s)`);
    } catch (e: unknown) {
      setLog("error", `listProjects failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  useEffect(() => {
    if (backendRunning) void refreshProjects();
  }, [backendRunning]);

  useEffect(() => {
    if (!projectId) { setCurvePreview(null); return; }
    void loadCurvePreview(selectedCurve);
  }, [projectId, selectedCurve]);

  const loadCurvePreview = async (curveType: string) => {
    if (!projectId) return;
    setLoadingCurve(true);
    try {
      const r = await api.getCurve(projectId, curveType);
      setCurvePreview({ ivar: r.ivar, dvar: r.dvar, meta: r.metadata });
    } catch (e: unknown) {
      setCurvePreview(null);
      setLog("error", `getCurve(${curveType}) failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingCurve(false);
    }
  };

  const onLoadExcel = async () => {
    setLoadingFile(true);
    try {
      const path = await invoke<string>("open_excel_file");
      if (path) {
        await loadProject(path);
        await refreshProjects();
      }
    } catch (e: unknown) {
      setLog("error", `Load Excel failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingFile(false);
    }
  };

  const onSelectProject = (pid: string) => {
    if (!pid || pid === projectId) return;
    void selectProject(pid);
  };

  const getPid = (p: ProjectItem) => p.project_id ?? (p as any).id ?? "";
  const getNpts = (p: ProjectItem) => p.n_points ?? (p as any).n_curves ?? (p as any).n_points ?? 0;

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: "#ffffff" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e5e5", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#2c2c2c" }}>Data Browser</h1>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 1 }}>
            {dataset ? `${(dataset as any).device_info?.part_number || "—"}  ·  ${projects.length} project(s) on server` : `${projects.length} project(s) on server`}
          </div>
        </div>
        <Badge variant={backendRunning ? "success" : "error"}>
          {backendRunning ? <><Server size={11} />&nbsp;Backend OK</> : <><ServerOff size={11} />&nbsp;Backend Down</>}
        </Badge>
        {!backendRunning && <Button variant="outline" size="sm" onClick={startBackend}>Start Backend</Button>}
        <Button variant="outline" size="sm" onClick={refreshBackend}><RefreshCw size={13} style={{ marginRight: 5 }} />Ping</Button>
        <Button variant="primary" size="sm" onClick={onLoadExcel} disabled={loadingFile || !backendRunning}>
          <Upload size={13} style={{ marginRight: 5 }} />{loadingFile ? "Loading..." : "Load Excel"}
        </Button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: project + curve list */}
        <div style={{ width: 280, borderRight: "1px solid #e5e5e5", background: "#fafafa", overflowY: "auto" }}>
          <div style={{ padding: "10px 12px 4px", fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Projects ({projects.length})</span>
            <button onClick={() => void refreshProjects()} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
              <RefreshCw size={11} color="#6b7280" />
            </button>
          </div>
          {projects.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 11, color: "#6b7280", fontStyle: "italic" }}>
              {backendRunning ? "No projects. Load an Excel file." : "Backend not running."}
            </div>
          ) : projects.map((p) => {
            const pid = getPid(p);
            const npts = getNpts(p);
            const isActive = pid === projectId;
            return (
              <div key={pid} onClick={() => pid && onSelectProject(pid)}
                style={{
                  padding: "8px 12px", cursor: pid ? "pointer" : "not-allowed",
                  backgroundColor: isActive ? "#e6f4ff" : "transparent",
                  borderLeft: isActive ? "3px solid #0d99ff" : "3px solid transparent",
                  display: "flex", alignItems: "center", gap: 8, fontSize: 12,
                }}>
                <FileText size={13} color={isActive ? "#0d99ff" : "#6b7280"} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#2c2c2c", fontWeight: isActive ? 500 : 400 }}>{p.name || "—"}</div>
                  <div style={{ fontSize: 10, color: "#6b7280" }}>{pid.slice(0, 8)}  ·  {npts} pts</div>
                </div>
              </div>
            );
          })}

          <div style={{ padding: "10px 12px 4px", fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Curves</div>
          {CURVE_CATALOG.map((c) => (
            <div key={c.type} onClick={() => setSelectedCurve(c.type)}
              style={{
                padding: "7px 12px", cursor: projectId ? "pointer" : "not-allowed",
                opacity: projectId ? 1 : 0.4,
                backgroundColor: selectedCurve === c.type ? "#e6f4ff" : "transparent",
                borderLeft: selectedCurve === c.type ? "3px solid #0d99ff" : "3px solid transparent",
                display: "flex", alignItems: "center", gap: 8, fontSize: 12,
              }}>
              <Eye size={12} color={selectedCurve === c.type ? "#0d99ff" : "#6b7280"} />
              <span style={{ color: "#2c2c2c" }}>{c.label}</span>
            </div>
          ))}
        </div>

        {/* Right: detail */}
        <div style={{ flex: 1, overflow: "auto", padding: 20, background: "#ffffff" }}>
          {!dataset ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#6b7280" }}>
              <FolderOpen size={48} style={{ marginBottom: 12, opacity: 0.4 }} />
              <div style={{ fontSize: 14 }}>No dataset loaded.</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Click <b>Load Excel</b> above to start.</div>
            </div>
          ) : (
            <DatasetDetail dataset={dataset} curve={curvePreview} loading={loadingCurve} curveInfo={CURVE_CATALOG.find(c => c.type === selectedCurve)!} />
          )}
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "5px 12px", color: "#6b7280", fontWeight: 500, borderBottom: "1px solid #e5e5e5", fontSize: 10 };
const td: React.CSSProperties = { padding: "5px 12px", color: "#2c2c2c", fontSize: 11 };

function DatasetDetail({ dataset, curve, loading, curveInfo }: {
  dataset: any;
  curve: { ivar: number[]; dvar: number[]; meta: Record<string, unknown> } | null;
  loading: boolean;
  curveInfo: typeof CURVE_CATALOG[0];
}) {
  const previewRows = curve ? curve.ivar.slice(0, 20).map((v, i) => ({ ivar: v, dvar: curve.dvar[i] })) : [];

  return (
    <div>
      <Card>
        <CardHeader
          title={dataset?.device_info?.part_number || "—"}
          subtitle={`${dataset?.device_info?.package || ""}  ·  BVdss ${dataset?.device_info?.bvdss_v || "?"}V  ·  RDSon ${dataset?.device_info?.rdson_max_mohm || "?"}mΩ`}
          action={<Badge variant="success">{Object.keys(dataset?.key_params || {}).length} key params</Badge>}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
          <Stat label="Vth 25C" value={`${dataset?.key_params?.vth_25c_v ?? "—"} V`} />
          <Stat label="RDSon @10V" value={`${(dataset?.key_params?.rdson_25c_10v_ohm ?? 0) * 1e3} mΩ`} />
          <Stat label="Qg @20V" value={`${dataset?.key_params?.qg_on_20v_nc ?? "—"} nC`} />
          <Stat label="Ciss @25V" value={`${dataset?.key_params?.ciss_25v_pf ?? "—"} pF`} />
          <Stat label="Coss @25V" value={`${dataset?.key_params?.coss_25v_pf ?? "—"} pF`} />
          <Stat label="Crss @25V" value={`${dataset?.key_params?.crss_25v_pf ?? "—"} pF`} />
        </div>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <CardHeader
          title={`Curve Preview: ${curveInfo?.label}`}
          subtitle={loading ? "Loading..." : curve ? `${curve.ivar.length} data points  ·  showing first 20` : "No data"}
          action={curve && <Badge variant="primary">{(curve.meta as any)?.curve_type || curveInfo?.type}</Badge>}
        />
        {!loading && curve && previewRows.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr>
                <th style={th}>#</th>
                <th style={th}>{curveInfo?.ivarLabel}</th>
                <th style={th}>{curveInfo?.dvarLabel}</th>
              </tr></thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #e5e5e5" }}>
                    <td style={td}>{i + 1}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{Number(row.ivar).toExponential(4)}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{Number(row.dvar).toExponential(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "#6b7280", fontSize: 12 }}>Select a curve from the left.</div>
        ) : null}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <CardHeader title="Available Curves on Server" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 8 }}>
          {Object.entries(dataset?.curve_counts || {}).map(([k, v]) => (
            <Stat key={k} label={k} value={`${v} pts`} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "8px 10px", background: "#ffffff", borderRadius: "var(--radius-md)", border: "1px solid #e5e5e5" }}>
      <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#2c2c2c", fontFamily: "'JetBrains Mono', Consolas, monospace" }}>{value}</div>
    </div>
  );
}
