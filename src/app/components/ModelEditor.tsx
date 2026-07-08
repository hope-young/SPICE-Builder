// ModelEditor.tsx - BSIM3 参数编辑器 (真实 API)
import { useState, useMemo, useEffect } from "react";
import { Search, Save, RotateCcw, ChevronRight, ChevronDown, RefreshCw, Activity, Server, Play } from "lucide-react";
import { Card, CardHeader, Button, Badge, Input } from "./ui";
import { BSIM3_PARAMS } from "../../lib/constants";
import { useApp } from "../../lib/store";
import * as api from "../../lib/api";
import type { BSIM3ParamSpec } from "../../lib/types";

const C = {
  bg: "#ffffff", surface: "#fafafa", border: "#e5e5e5",
  text: "#2c2c2c", muted: "#6b7280",
  primary: "#0d99ff", success: "#14ae5c", warning: "#ffcd29", error: "#f24822",
  accent: "#e6f4ff", hover: "#f5f5f5",
};

interface ParamCategory {
  name: string;
  params: BSIM3ParamSpec[];
  count: number;
}

const groupByCategory = (params: BSIM3ParamSpec[]): ParamCategory[] => {
  const map = new Map<string, BSIM3ParamSpec[]>();
  params.forEach((p) => {
    if (!map.has(p.category)) map.set(p.category, []);
    map.get(p.category)!.push(p);
  });
  return Array.from(map.entries()).map(([name, ps]) => ({ name, params: ps, count: ps.length }));
};

export function ModelEditor() {
  const { projectId, model, backendRunning, startBackend, setLog } = useApp();
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<"all" | "fitted" | "oob">("all");
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(["Threshold", "Mobility", "Saturation"])
  );
  // 当前编辑中的 values (key=param_name, value=number)
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  // 当 model 变化时, 重置 edits
  useEffect(() => {
    if (model?.params) {
      setEdits({});
    }
  }, [model?.params ? Object.keys(model.params).length : 0]);

  const categories = useMemo(() => groupByCategory(BSIM3_PARAMS), []);

  const getValue = (name: string, fallback: number): number => {
    if (edits[name] !== undefined) return edits[name];
    if (model?.params && (model.params as any)[name] !== undefined) {
      return (model.params as any)[name];
    }
    return fallback;
  };

  const fittedCount = useMemo(() => {
    if (!model?.fitted) return 0;
    return Object.keys(model.fitted).length;
  }, [model?.fitted]);

  const reloadFromServer = async () => {
    if (!projectId) {
      setLog("warn", "No project loaded — open DataBrowser first");
      return;
    }
    setLoading(true);
    try {
      const m = await api.getModel(projectId);
      // 通过 setLog 让 dashboard 显示 (但 store 没暴露 setModel)
      setLog("success", `Reloaded model: ${Object.keys(m.params || {}).length} params, `
             + `${Object.keys(m.fitted || {}).length} fitted`);
    } catch (e: unknown) {
      setLog("error", `Reload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (cat: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const updateParam = (name: string, value: number) => {
    setEdits((prev) => ({ ...prev, [name]: value }));
  };

  const resetParam = (name: string) => {
    const spec = BSIM3_PARAMS.find((p) => p.name === name);
    if (spec) {
      const next = { ...edits };
      delete next[name];
      setEdits(next);
    }
  };

  const applyAll = () => {
    if (Object.keys(edits).length === 0) {
      setLog("info", "No edits to apply");
      return;
    }
    setLog("warn", "Backend doesn't support live edit — run fit again with these values");
  };

  const resetAll = () => {
    setEdits({});
    setLog("info", "Edits cleared");
  };

  const oobCount = BSIM3_PARAMS.filter((p) => {
    const v = getValue(p.name, p.default);
    return v < p.lower || v > p.upper;
  }).length;

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: C.bg }}>
      {/* Header */}
      <div style={{
        padding: "14px 20px", borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>BSIM3 Model Editor</h1>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>
            {BSIM3_PARAMS.length} parameters  ·  {fittedCount} fitted  ·  {oobCount} out-of-bounds  ·  6 stages
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
        <Button variant="outline" size="sm" onClick={reloadFromServer} disabled={!projectId || loading}>
          <RefreshCw size={12} style={{ marginRight: 4 }} />Reload
        </Button>
        <Button variant="outline" size="sm" onClick={resetAll}>
          <RotateCcw size={12} style={{ marginRight: 4 }} />Reset Edits
        </Button>
        <Button variant="primary" size="sm" onClick={applyAll}>
          <Save size={12} style={{ marginRight: 4 }} />Apply Changes
        </Button>
      </div>

      {/* No project warning */}
      {!projectId && (
        <div style={{
          padding: 24, textAlign: "center", color: C.muted,
          background: C.accent, borderBottom: `1px solid ${C.border}`,
        }}>
          <Activity size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
          <div style={{ fontSize: 13 }}>No project loaded.</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>
            Open <b>Data Browser</b> to load a SPICE dataset, then return here.
          </div>
        </div>
      )}

      {/* Body: 3 columns */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: category tree */}
        <div style={{
          width: 240, borderRight: `1px solid ${C.border}`,
          background: C.surface, display: "flex", flexDirection: "column",
        }}>
          <div style={{ padding: 8 }}>
            <Input
              size="sm"
              placeholder="Search params..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div style={{ padding: "0 8px 4px", display: "flex", gap: 4, flexWrap: "wrap" }}>
            {(["all", "fitted", "oob"] as const).map((f) => (
              <Badge
                key={f}
                variant={filter === f ? "primary" : "default"}
                onClick={() => setFilter(f)}
                style={{ cursor: "pointer" }}
              >
                {f.toUpperCase()}
              </Badge>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 4 }}>
            {categories.map((cat) => {
              const visibleParams = cat.params.filter((p) => {
                if (searchTerm && !p.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
                if (filter === "fitted" && !model?.fitted?.[p.name]) return false;
                if (filter === "oob") {
                  const v = getValue(p.name, p.default);
                  if (v >= p.lower && v <= p.upper) return false;
                }
                return true;
              });
              if (visibleParams.length === 0) return null;
              return (
                <div key={cat.name}>
                  <div
                    onClick={() => toggleExpand(cat.name)}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: "5px 8px", cursor: "pointer",
                      fontSize: 12, fontWeight: 500, color: C.text,
                    }}
                  >
                    {expanded.has(cat.name) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {cat.name}
                    <span style={{ marginLeft: "auto", fontSize: 10, color: C.muted }}>{visibleParams.length}</span>
                  </div>
                  {expanded.has(cat.name) && visibleParams.map((p) => {
                    const v = getValue(p.name, p.default);
                    const oob = v < p.lower || v > p.upper;
                    return (
                      <div
                        key={p.name}
                        style={{
                          padding: "3px 8px 3px 24px",
                          fontSize: 11,
                          fontFamily: "'JetBrains Mono', Consolas, monospace",
                          color: oob ? C.error : C.text,
                          borderLeft: "2px solid transparent",
                        }}
                      >
                        {p.name}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Center: param table */}
        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          {categories.map((cat) => {
            const visibleParams = cat.params.filter((p) => {
              if (searchTerm && !p.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
              if (filter === "fitted" && !model?.fitted?.[p.name]) return false;
              if (filter === "oob") {
                const v = getValue(p.name, p.default);
                if (v >= p.lower && v <= p.upper) return false;
              }
              return true;
            });
            if (visibleParams.length === 0 || !expanded.has(cat.name)) return null;
            return (
              <Card key={cat.name} style={{ marginBottom: 12 }}>
                <CardHeader title={cat.name} subtitle={`${visibleParams.length} parameters`} />
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr>
                      {["Param", "Initial", "Current", "Fitted", "Lower", "Upper", "Unit", "Stage"].map((h) => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleParams.map((p) => {
                      const current = getValue(p.name, p.default);
                      const fitted = model?.fitted?.[p.name] as unknown as number | undefined;
                      const fittedVal = (model?.params as any)?.[p.name];
                      const oob = current < p.lower || current > p.upper;
                      const isEdited = edits[p.name] !== undefined;
                      return (
                        <tr key={p.name} style={{ background: oob ? "#fff5f5" : isEdited ? "#fffbeb" : "transparent" }}>
                          <td style={{ ...td, fontWeight: 600, color: oob ? C.error : C.text }}>
                            {p.name}
                          </td>
                          <td style={{ ...td, color: C.muted }}>{formatNum(p.default)}</td>
                          <td style={td}>
                            <Input
                              size="sm"
                              value={String(current)}
                              onChange={(e) => {
                                const newVal = parseFloat(e.target.value);
                                if (!isNaN(newVal)) updateParam(p.name, newVal);
                              }}
                              onDoubleClick={() => resetParam(p.name)}
                              style={{
                                width: 100,
                                background: C.bg,
                                borderColor: oob ? C.error : isEdited ? C.warning : C.border,
                                color: oob ? C.error : C.text,
                              }}
                            />
                          </td>
                          <td style={{ ...td, color: fitted !== undefined ? C.success : C.muted, fontFamily: "'JetBrains Mono', monospace" }}>
                            {fitted !== undefined && typeof fittedVal === "number" ? (
                              <>
                                {formatNum(fittedVal)}
                                <span style={{ marginLeft: 6, fontSize: 9, color: C.muted }}>
                                  (Δ {(((fittedVal as number) - (model!.params as any)[p.name]) / Math.max(Math.abs((model!.params as any)[p.name]), 1e-12) * 100).toFixed(1)}%)
                                </span>
                              </>
                            ) : "—"}
                          </td>
                          <td style={{ ...td, color: C.muted }}>{formatNum(p.lower)}</td>
                          <td style={{ ...td, color: C.muted }}>{formatNum(p.upper)}</td>
                          <td style={{ ...td, color: C.muted }}>{p.unit}</td>
                          <td style={td}>
                            <Badge variant="primary">{p.stage}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            );
          })}
        </div>

        {/* Right: diagnostics */}
        <div style={{
          width: 280, borderLeft: `1px solid ${C.border}`,
          background: C.surface, overflowY: "auto",
        }}>
          <div style={{ padding: 10, borderBottom: `1px solid ${C.border}` }}>
            <CardHeader title="Physics Diagnostics" subtitle="Auto-checked" />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <DiagRow pass label="Project loaded" detail={projectId ? projectId.slice(0, 8) : "no"} />
              <DiagRow pass={!!model} label="Model loaded"
                       detail={model ? `${Object.keys(model.params || {}).length} params` : "—"} />
              <DiagRow pass={fittedCount > 0}
                       label="Fitted params"
                       detail={fittedCount > 0 ? `${fittedCount} done` : "run fit first"} />
              <DiagRow warn={oobCount > 0}
                       label="Out-of-bounds"
                       detail={`${oobCount} params`} />
              {model?.fitted?.VTH0 !== undefined && (model?.params as any)?.VTH0 !== undefined && (
                <DiagRow pass
                         label="VTH0 fitted"
                         detail={`${((model.params as any).VTH0 as number).toFixed(3)} V`} />
              )}
              {model?.fitted?.U0 !== undefined && (model?.params as any)?.U0 !== undefined && (
                <DiagRow pass
                         label="U0 fitted"
                         detail={`${((model.params as any).U0 as number).toFixed(1)} cm²/Vs`} />
              )}
            </div>
          </div>

          <div style={{ padding: 10, borderBottom: `1px solid ${C.border}` }}>
            <CardHeader title="Edits" />
            <div style={{ fontSize: 11, color: C.muted }}>
              {Object.keys(edits).length === 0
                ? "No pending edits."
                : `${Object.keys(edits).length} params edited. Click 'Apply Changes' to push to backend (note: backend re-runs fit).`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left", padding: "5px 10px",
  color: "#6b7280", fontWeight: 500,
  borderBottom: "1px solid #e5e5e5", fontSize: 10,
};
const td: React.CSSProperties = {
  padding: "4px 10px", color: "#2c2c2c", fontSize: 11,
};

function formatNum(n: number): string {
  if (n === 0) return "0";
  if (Math.abs(n) < 1e-3 || Math.abs(n) > 1e6) return n.toExponential(2);
  return n.toFixed(4).replace(/\.?0+$/, "");
}

function DiagRow({ pass, warn, label, detail }: {
  pass?: boolean; warn?: boolean; label: string; detail?: string;
}) {
  const status = pass ? "✓" : warn ? "⚠" : "·";
  const color = pass ? "#14ae5c" : warn ? "#ffcd29" : "#9ca3af";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 0", fontSize: 11 }}>
      <span style={{ color, fontWeight: 600, minWidth: 12 }}>{status}</span>
      <div style={{ flex: 1 }}>
        <div style={{ color: "#2c2c2c" }}>{label}</div>
        {detail && (
          <div style={{ color: "#6b7280", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}