// Workbench.tsx - Fit Project Tree 工作台（接 Figma v2 设计稿）
// 顶部菜单栏/工具栏在 App.tsx 的 MenuBar/路由里统一实现，本组件只负责 Tree 部分。
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  ChevronRight, ChevronDown, Plus, Trash2,
  CheckCircle2, Circle, Minus, FileCheck,
  Activity, Play, Square, Download,
} from "lucide-react";
import { useApp } from "../../lib/store";
import { SingleCurveFit, type StepRuntimeSummary } from "./SingleCurveFit";
import {
  addWorkbenchActionListener,
  addWorkbenchStateListener,
  dispatchWorkbenchAction,
  type WorkbenchRuntimeState,
} from "../../lib/events";

const C = {
  pageBg:    "#F6F7F9",
  panelBg:   "#FFFFFF",
  surface:   "#FFFFFF",
  border:    "#D7DDE5",
  borderMd:  "#BFC9D4",
  primary:   "#0D7F8F",
  primaryLt: "#DFF4F6",
  success:   "#2D8A4E",
  error:     "#BF3A30",
  text:      "#1A2633",
  textSm:    "#6B7A8D",
  textXs:    "#8D9BAA",
  selectedBg:  "#E5F3F6",
  selectedBdr: "#0D7F8F",
};
const ff   = "'Inter','Segoe UI',system-ui,sans-serif";
const mono = "'JetBrains Mono','Consolas',monospace";

const FIT_PROJECT_MIN_WIDTH = 180;
const FIT_PROJECT_MAX_WIDTH = 400;
const FIT_PROJECT_DEFAULT_WIDTH = 224;  // 320 * 0.7 = 224
const FIT_PROJECT_WIDTH_KEY = "spicebuilder.workbench.fitProjectWidth";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  const stored = Number(window.localStorage.getItem(key));
  return Number.isFinite(stored) ? clamp(stored, min, max) : fallback;
}

function fmtTreeNumber(value: number): string {
  return Number.isFinite(value) ? Number.parseFloat(value.toPrecision(6)).toString() : "?";
}

function axisLabelForSummary(summary: StepRuntimeSummary): string {
  if (summary.curveType === "idvd") return "Vds";
  if (summary.curveType === "cv") return "Vds";
  if (summary.curveType === "bv") return summary.bvKind === "bvdss" ? "Vds" : "Vgs";
  if (summary.curveType === "qg") return "Qg";
  return "Vgs";
}

const IDVD_DEFAULT_VGS = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10];

function idvdStepId(vgs: number): string {
  return `idvd_vgs${String(vgs).replace(".", "p")}`;
}

type FitStatus = "done" | "loaded" | "queued" | "running" | "empty" | "error";

interface TreeChild {
  id: string;
  label: string;
  status: FitStatus;
  r2: string | null;
  pts: number;
  bias?: string;
  csvFile?: string;
  range?: string;
  weight?: number;
  type?: string;
}
interface TreeFeature {
  id: string;
  label: string;
  tag: "live" | "next";
  canAdd: boolean;
  addLabel?: string;
  children: TreeChild[];
}

function StatusIcon({ status }: { status: FitStatus }) {
  if (status === "done")    return <CheckCircle2 size={12} color={C.success} />;
  if (status === "loaded")  return <FileCheck size={12} color={C.success} />;
  if (status === "running") return <Circle size={12} color={C.primary} style={{ animation: "pulse 1s infinite" }} />;
  if (status === "queued")  return <Circle size={12} color={C.textXs} />;
  if (status === "error")   return <Minus size={12} color={C.error} />;
  return <Circle size={12} color={C.border} />;
}
function useTreeData(userSteps: Map<string, TreeChild[]>) {
  const { dataset, fitResult } = useApp();
  return useMemo<TreeFeature[]>(() => {
    const haveData = !!dataset;
    const points = (arr?: unknown[] | null) => (Array.isArray(arr) ? arr.length : 0);
    const idvg_pts = points(dataset?.idvg_vds5) || points(dataset?.idvg_vds05);
    const idvd_pts = points(dataset?.idvd);
    const r2 =
      fitResult?.success && fitResult.r_squared != null
        ? fitResult.r_squared.toFixed(3)
        : null;
    const idvg_done = !!fitResult?.success && idvg_pts > 0;
    const idvd_done = !!fitResult?.success && idvd_pts > 0;

    // 更新步骤状态（根据数据和拟合结果）
    const updateStepStatus = (steps: TreeChild[], featureType: "idvg" | "idvd"): TreeChild[] => {
      return steps.map(step => ({
        ...step,
        status: (featureType === "idvg" && idvg_done) || (featureType === "idvd" && idvd_done)
          ? "done"
          : haveData && step.status === "empty" ? "queued" : step.status,
        r2: (featureType === "idvg" && idvg_done) || (featureType === "idvd" && idvd_done) ? r2 : step.r2,
        pts: featureType === "idvg"
          ? ((step.id === "idvg_05" ? points(dataset?.idvg_vds05) : points(dataset?.idvg_vds5)) || step.pts)
          : (idvd_pts || step.pts),
      }));
    };

    return [
      {
        id: "idvg", label: "IdVg / Transfer", tag: "live", canAdd: true, addLabel: "Add Vds step",
        children: updateStepStatus(userSteps.get("idvg") || [], "idvg"),
      },
      {
        id: "idvd", label: "IdVd / Output", tag: "live", canAdd: true, addLabel: "Add Vgs step",
        children: updateStepStatus(userSteps.get("idvd") || [], "idvd"),
      },
      {
        id: "bv", label: "BV / Leakage", tag: "live", canAdd: false,
        children: userSteps.get("bv") || [],
      },
      { id: "bodydiode",  label: "Body Diode",        tag: "next", canAdd: false, children: [
        { id: "isvsd", label: "Is-Vsd", status: "empty", r2: null, pts: 0, type: "BodyDiode" },
        { id: "qrr",   label: "Qrr",    status: "empty", r2: null, pts: 0, type: "BodyDiode" },
      ]},
      {
        id: "cv", label: "CV / Capacitance", tag: "live", canAdd: false,
        children: userSteps.get("cv") || [],
      },
      {
        id: "qg", label: "Qg / Gate Charge", tag: "live", canAdd: false,
        children: userSteps.get("qg") || [],
      },
      { id: "dpt", label: "DPT / Switching", tag: "next", canAdd: false, children: [
        { id: "dpt_on",  label: "Turn-on",  status: "empty", r2: null, pts: 0, type: "DPT" },
        { id: "dpt_off", label: "Turn-off", status: "empty", r2: null, pts: 0, type: "DPT" },
      ]},
    ];
  }, [dataset, fitResult, userSteps]);
}
/* ============================================================
   Power Cell Section (器件级配置)
============================================================ */
function PowerCellSection({
  config,
  isSelected,
  onSelect,
}: {
  config: { activeAreaMm2: number; cellPitchUm: number };
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        padding: "8px 10px",
        backgroundColor: isSelected ? C.selectedBg : C.panelBg,
        borderLeft: isSelected ? `2px solid ${C.selectedBdr}` : "2px solid transparent",
        borderBottom: `1px solid ${C.border}`,
        cursor: "pointer",
        userSelect: "none",
      }}
      onMouseEnter={(e) => {
        if (!isSelected)
          (e.currentTarget as HTMLElement).style.backgroundColor = "#EFF1F4";
      }}
      onMouseLeave={(e) => {
        if (!isSelected)
          (e.currentTarget as HTMLElement).style.backgroundColor = C.panelBg;
      }}
    >
      <div style={{
        fontSize: 10,
        color: C.textXs,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontWeight: 600,
        marginBottom: 6,
      }}>
        Power Cell
      </div>
      <div style={{ display: "flex", gap: 12, fontSize: 11, color: C.text }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: C.textXs }}>AA:</span>
          <span style={{ fontFamily: mono, fontWeight: 600 }}>
            {config.activeAreaMm2}mm²
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: C.textXs }}>Pitch:</span>
          <span style={{ fontFamily: mono, fontWeight: 600 }}>
            {config.cellPitchUm}µm
          </span>
        </div>
      </div>
    </div>
  );
}

function ExportModelStep({
  isSelected,
  onSelect,
}: {
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        padding: "8px 10px",
        backgroundColor: isSelected ? C.selectedBg : C.panelBg,
        borderLeft: isSelected ? `2px solid ${C.selectedBdr}` : "2px solid transparent",
        borderTop: `1px solid ${C.border}`,
        borderBottom: `1px solid ${C.border}`,
        cursor: "pointer",
        userSelect: "none",
      }}
      onMouseEnter={(e) => {
        if (!isSelected)
          (e.currentTarget as HTMLElement).style.backgroundColor = "#EFF1F4";
      }}
      onMouseLeave={(e) => {
        if (!isSelected)
          (e.currentTarget as HTMLElement).style.backgroundColor = C.panelBg;
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Download size={13} color={isSelected ? C.primary : C.textSm} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: C.text, fontWeight: 700 }}>
            Export Model
          </div>
          <div style={{ marginTop: 2, fontSize: 10, color: C.textXs }}>
            Final SPICE .lib step
          </div>
        </div>
        <span style={{
          fontSize: 9,
          padding: "1px 5px",
          borderRadius: 2,
          fontWeight: 600,
          letterSpacing: "0.04em",
          backgroundColor: C.primaryLt,
          color: C.primary,
        }}>
          FINAL
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   Fit Project Tree（v2 设计稿关键组件，核心改造点）
============================================================ */
function FitProjectTree({
  treeData, checkedFeatures, checkedChildren, expandedFeatures,
  selectedId, onToggleFeature, onToggleChild, onToggleExpand,
  onSelect, onAddStep, onDeleteStep,
}: {
  treeData: TreeFeature[];
  checkedFeatures: Set<string>;
  checkedChildren: Set<string>;
  expandedFeatures: Set<string>;
  selectedId: string | null;
  onToggleFeature: (id: string) => void;
  onToggleChild: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onAddStep: (featureId: string) => void;
  onDeleteStep: (childId: string) => void;
}) {
  return (
    <div style={{ flex: 1, overflowY: "auto", fontSize: 11, fontFamily: ff, minHeight: 0 }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        ::-webkit-scrollbar { width:5px; height:5px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:${C.borderMd}; border-radius:3px; }
      `}</style>
      <div style={{
        padding: "7px 10px 4px",
        borderBottom: `1px solid ${C.border}`,
        fontSize: 10, color: C.textXs,
        textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600,
      }}>
        Fit Project
      </div>

      {treeData.map((feat) => {
        const isNext = feat.tag === "next";
        const isExpanded = expandedFeatures.has(feat.id);
        const isFeatChecked = checkedFeatures.has(feat.id);

        return (
          <div key={feat.id}>
            {/* Feature row */}
            <div
              onClick={() => onSelect(feat.id)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 10px 5px 6px",
                backgroundColor: selectedId === feat.id ? C.selectedBg : "transparent",
                borderLeft: selectedId === feat.id ? `2px solid ${C.selectedBdr}` : "2px solid transparent",
                cursor: "pointer", userSelect: "none",
              }}
              onMouseEnter={(e) => {
                if (selectedId !== feat.id)
                  (e.currentTarget as HTMLElement).style.backgroundColor = "#EFF1F4";
              }}
              onMouseLeave={(e) => {
                if (selectedId !== feat.id)
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
              }}
            >
              <button
                onClick={(e) => { e.stopPropagation(); onToggleExpand(feat.id); }}
                style={{
                  border: "none", background: "transparent",
                  cursor: "pointer", padding: 0,
                  display: "flex", color: C.textSm, flexShrink: 0,
                }}
              >
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>

              <div
                onClick={(e) => { e.stopPropagation(); if (!isNext) onToggleFeature(feat.id); }}
                style={{
                  width: 13, height: 13, borderRadius: 3, flexShrink: 0,
                  border: `1.5px solid ${isFeatChecked && !isNext ? C.primary : C.borderMd}`,
                  backgroundColor: isFeatChecked && !isNext ? C.primary : isNext ? C.pageBg : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: isNext ? "default" : "pointer",
                }}
              >
                {isFeatChecked && !isNext && (
                  <div style={{
                    width: 7, height: 7,
                    backgroundColor: "#fff", borderRadius: 1,
                    clipPath: "polygon(14% 44%,0 65%,50% 100%,100% 16%,80% 0%,43% 62%)",
                  }} />
                )}
              </div>

              <span style={{
                flex: 1, fontWeight: 600, fontSize: 11,
                color: isNext ? C.textXs : C.text,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {feat.label}
              </span>

              <span style={{
                fontSize: 9, padding: "1px 5px", borderRadius: 2,
                fontWeight: 600, letterSpacing: "0.04em",
                backgroundColor: isNext ? "#F0F1F3" : C.primaryLt,
                color: isNext ? C.textXs : C.primary,
              }}>
                {feat.tag.toUpperCase()}
              </span>
            </div>
            {/* Children */}
            {isExpanded && (
              <div>
                {feat.children.map((child) => {
                  const isChildChecked = checkedChildren.has(child.id);
                  const isSelected = selectedId === child.id;
                  return (
                    <div
                      key={child.id}
                      onClick={() => onSelect(child.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "4px 10px 4px 28px",
                        backgroundColor: isSelected ? C.selectedBg : "transparent",
                        borderLeft: isSelected ? `2px solid ${C.selectedBdr}` : "2px solid transparent",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected)
                          (e.currentTarget as HTMLElement).style.backgroundColor = "#EFF1F4";
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected)
                          (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                      }}
                    >
                      <div
                        onClick={(e) => { e.stopPropagation(); onToggleChild(child.id); }}
                        style={{
                          width: 12, height: 12, borderRadius: 3, flexShrink: 0,
                          border: `1.5px solid ${isChildChecked ? C.primary : C.borderMd}`,
                          backgroundColor: isChildChecked ? C.primary : "#fff",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer",
                        }}
                      >
                        {isChildChecked && (
                          <div style={{
                            width: 6, height: 6,
                            backgroundColor: "#fff", borderRadius: 1,
                            clipPath: "polygon(14% 44%,0 65%,50% 100%,100% 16%,80% 0%,43% 62%)",
                          }} />
                        )}
                      </div>
                      <StatusIcon status={child.status} />
                      <span style={{
                        flex: 1, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                        fontSize: 11, color: C.text,
                      }}>
                        {child.label}
                      </span>

                      {child.r2 && (
                        <span style={{
                          fontSize: 10, fontFamily: mono,
                          color: C.success, flexShrink: 0,
                        }}>
                          {child.r2}
                        </span>
                      )}
                      {child.pts > 0 && (
                        <span style={{ fontSize: 9, color: C.textXs, flexShrink: 0 }}>
                          {child.pts}pt
                        </span>
                      )}
                      {/* 删除按钮 */}
                      {!isNext && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteStep(child.id);
                          }}
                          title="删除该 step"
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            padding: 2,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: C.textXs,
                            borderRadius: 3,
                            flexShrink: 0,
                            transition: "color 0.15s ease",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.color = C.error;
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.color = C.textXs;
                          }}
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  );
                })}

                {feat.canAdd && !isNext && (
                  <button
                    onClick={() => onAddStep(feat.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "3px 10px 4px 32px",
                      border: "none", cursor: "pointer",
                      backgroundColor: "transparent",
                      fontFamily: ff, width: "100%",
                      color: C.primary, fontSize: 10,
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLElement).style.backgroundColor = "#EFF1F4")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")
                    }
                  >
                    <Plus size={10} />{feat.addLabel}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
/* ============================================================
   Operation Buttons Panel (2×2 Grid)
============================================================ */
function OperationButtonsPanel() {
  const [runtime, setRuntime] = useState<WorkbenchRuntimeState>({
    hasCsv: false,
    canFit: false,
    canSimulate: false,
    fitting: false,
    simulating: false,
    loading: false,
    isRunning: false,
    loadedStepCount: 0,
    activeStepName: "",
  });

  useEffect(() => {
    return addWorkbenchStateListener(setRuntime);
  }, []);

  const handleFit = () => {
    if (!runtime.canFit) return;
    dispatchWorkbenchAction("fit-selected");
  };

  const handleSimulate = () => {
    if (!runtime.canSimulate) return;
    dispatchWorkbenchAction("simulate");
  };

  const handleStop = () => {
    if (!runtime.isRunning) return;
    dispatchWorkbenchAction("stop");
  };

  const fitDisabled = !runtime.canFit;
  const simulateDisabled = !runtime.canSimulate;
  const stopDisabled = !runtime.isRunning;

  return (
    <div style={{
      borderTop: `1px solid ${C.border}`,
      backgroundColor: C.panelBg,
      padding: "8px 10px",
      flexShrink: 0,
    }}>
      <div style={{
        fontSize: 9,
        color: C.textXs,
        marginBottom: 5,
        fontFamily: mono,
      }}>
        数据: {runtime.hasCsv ? "已加载" : "未加载"} | 状态: {runtime.isRunning ? (runtime.fitting ? "拟合中" : "仿真中") : "空闲"}
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 6,
      }}>
        <button
          onClick={handleFit}
          disabled={fitDisabled}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            padding: "6px 5px",
            border: `1px solid ${fitDisabled ? C.border : C.primary}`,
            borderRadius: 6,
            backgroundColor: fitDisabled ? C.pageBg : C.primaryLt,
            cursor: fitDisabled ? "not-allowed" : "pointer",
            opacity: fitDisabled ? 0.5 : 1,
            transition: "all 0.15s ease",
            fontFamily: ff,
          }}
          onMouseEnter={(e) => {
            if (fitDisabled) return;
            const el = e.currentTarget as HTMLElement;
            el.style.backgroundColor = "#C0E8EC";
            el.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            if (fitDisabled) return;
            const el = e.currentTarget as HTMLElement;
            el.style.backgroundColor = C.primaryLt;
            el.style.transform = "translateY(0)";
          }}
        >
          <Activity size={14} color={fitDisabled ? C.textXs : C.primary} />
          <span style={{ fontSize: 10, fontWeight: 600, color: fitDisabled ? C.textXs : C.text }}>
            FIT
          </span>
        </button>

        <button
          onClick={handleSimulate}
          disabled={simulateDisabled}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            padding: "6px 5px",
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            backgroundColor: simulateDisabled ? C.pageBg : C.panelBg,
            cursor: simulateDisabled ? "not-allowed" : "pointer",
            opacity: simulateDisabled ? 0.5 : 1,
            transition: "all 0.15s ease",
            fontFamily: ff,
          }}
          onMouseEnter={(e) => {
            if (simulateDisabled) return;
            const el = e.currentTarget as HTMLElement;
            el.style.backgroundColor = "#E5EEF0";
            el.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            if (simulateDisabled) return;
            const el = e.currentTarget as HTMLElement;
            el.style.backgroundColor = C.panelBg;
            el.style.transform = "translateY(0)";
          }}
        >
          <Play size={14} color={simulateDisabled ? C.textXs : C.primary} />
          <span style={{ fontSize: 10, fontWeight: 600, color: simulateDisabled ? C.textXs : C.text }}>
            Simulate
          </span>
        </button>

        <button
          onClick={handleStop}
          disabled={stopDisabled}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            padding: "6px 5px",
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            backgroundColor: stopDisabled ? C.pageBg : C.panelBg,
            cursor: stopDisabled ? "not-allowed" : "pointer",
            opacity: stopDisabled ? 0.5 : 1,
            transition: "all 0.15s ease",
            fontFamily: ff,
          }}
          onMouseEnter={(e) => {
            if (stopDisabled) return;
            const el = e.currentTarget as HTMLElement;
            el.style.backgroundColor = "#F5E5E4";
            el.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            if (stopDisabled) return;
            const el = e.currentTarget as HTMLElement;
            el.style.backgroundColor = C.panelBg;
            el.style.transform = "translateY(0)";
          }}
        >
          <Square size={14} color={stopDisabled ? C.textXs : C.error} />
          <span style={{ fontSize: 10, fontWeight: 600, color: stopDisabled ? C.textXs : C.error }}>
            Stop
          </span>
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   Workbench 顶层组件
============================================================ */
export interface WorkbenchProps {
  onOpenSettings?: () => void;
  onOpenFitting?: () => void;
}

export function Workbench(props: WorkbenchProps) {
  // 默认步骤和用户添加步骤的合并管理
  const [userSteps, setUserSteps] = useState<Map<string, TreeChild[]>>(() => {
    const initialMap = new Map<string, TreeChild[]>();
    // 添加默认的 IdVg 步骤
    initialMap.set("idvg", [
      { id: "idvg_05", label: "IdVg @ Vds=0.5V", status: "empty", r2: null, pts: 0,
        bias: "Vds=0.5V", csvFile: "IdVg.csv", range: "Vgs 0–10V", weight: 1.0, type: "IdVg" },
      { id: "idvg_5", label: "IdVg @ Vds=5V", status: "empty", r2: null, pts: 0,
        bias: "Vds=5V", csvFile: "IdVg.csv", range: "Vgs 0–10V", weight: 1.0, type: "IdVg" },
    ]);
    // 添加默认的 IdVd 步骤
    initialMap.set("idvd", IDVD_DEFAULT_VGS.map(vgs => ({
      id: idvdStepId(vgs),
      label: `IdVd @ Vgs=${fmtTreeNumber(vgs)}V`,
      status: "empty" as const,
      r2: null,
      pts: 0,
      bias: `Vgs=${fmtTreeNumber(vgs)}V`,
      csvFile: "IdVd.csv",
      range: "Vds 0-30V",
      weight: 1.0,
      type: "IdVd",
    })));
    initialMap.set("bv", [
      { id: "bvdss", label: "BVDSS", status: "empty", r2: null, pts: 0,
        bias: "Vgs=0V", csvFile: "BVDSS.csv", range: "Vds sweep", weight: 1.0, type: "BV" },
      { id: "bvgss_p", label: "BVGSS+", status: "empty", r2: null, pts: 0,
        bias: "Vgs=+", csvFile: "BVGSS_pos.csv", range: "Vgs+ sweep", weight: 1.0, type: "BV" },
      { id: "bvgss_n", label: "BVGSS-", status: "empty", r2: null, pts: 0,
        bias: "Vgs=-", csvFile: "BVGSS_neg.csv", range: "Vgs- sweep", weight: 1.0, type: "BV" },
    ]);
    initialMap.set("cv", [
      { id: "ciss", label: "Ciss", status: "empty", r2: null, pts: 0,
        bias: "f=1MHz", csvFile: "Ciss.csv", range: "Vds sweep", weight: 1.0, type: "CV" },
      { id: "coss", label: "Coss", status: "empty", r2: null, pts: 0,
        bias: "f=1MHz", csvFile: "Coss.csv", range: "Vds sweep", weight: 1.0, type: "CV" },
      { id: "crss", label: "Crss", status: "empty", r2: null, pts: 0,
        bias: "f=1MHz", csvFile: "Crss.csv", range: "Vds sweep", weight: 1.0, type: "CV" },
    ]);
    initialMap.set("qg", [
      { id: "qg_curve", label: "Qg Curve", status: "empty", r2: null, pts: 0,
        bias: "Vg=10V", csvFile: "Generated", range: "Qg sweep", weight: 1.0, type: "Qg" },
    ]);
    return initialMap;
  });
  const treeData = useTreeData(userSteps);
  const [checkedFeatures, setCheckedFeatures]   = useState<Set<string>>(new Set(["idvg", "idvd", "bv", "cv", "qg"]));
  const [checkedChildren, setCheckedChildren]   = useState<Set<string>>(
    () => new Set(["idvg_05", "idvg_5", ...IDVD_DEFAULT_VGS.map(idvdStepId), "bvdss", "bvgss_p", "bvgss_n", "ciss", "coss", "crss", "qg_curve"])
  );
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(new Set(["idvg", "idvd", "bv", "cv", "qg"]));
  const [selectedId, setSelectedId] = useState<string | null>("idvg_5");

  // Power Cell 配置
  const [powerCellConfig, setPowerCellConfig] = useState({
    activeAreaMm2: 10.0,
    cellPitchUm: 2.0,
  });

  const toggleFeature = (id: string) =>
    setCheckedFeatures((prev) => {
      const s = new Set(prev);
      const nextChecked = !s.has(id);
      nextChecked ? s.add(id) : s.delete(id);
      const childIds = (userSteps.get(id) || []).map(step => step.id);
      setCheckedChildren((old) => {
        const next = new Set(old);
        childIds.forEach(childId => {
          nextChecked ? next.add(childId) : next.delete(childId);
        });
        return next;
      });
      return s;
    });
  const toggleChild = (id: string) =>
    setCheckedChildren((prev) => {
      const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
    });
  const toggleExpand = (id: string) =>
    setExpandedFeatures((prev) => {
      const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
    });
  const handleAddStep = (featureId: string) => {
    const newId = `${featureId}_user_${Date.now()}`;
    const label = featureId === "idvg"
      ? "IdVg @ Vds=?"
      : "IdVd @ Vgs=?";

    const newChild: TreeChild = {
      id: newId,
      label,
      status: "empty",
      r2: null,
      pts: 0,
      type: featureId === "idvg" ? "IdVg" : "IdVd",
      bias: "?",
      csvFile: featureId === "idvg" ? "IdVg.csv" : "IdVd.csv",
      range: "?",
      weight: 1.0,
    };

    setUserSteps((prev) => {
      const newMap = new Map(prev);
      const existing = newMap.get(featureId) || [];
      newMap.set(featureId, [...existing, newChild]);
      return newMap;
    });

    setSelectedId(newId);
    if (checkedFeatures.has(featureId)) {
      setCheckedChildren(prev => new Set(prev).add(newId));
    }
    setExpandedFeatures(prev => new Set(prev).add(featureId));
    console.info("[Workbench] add step:", featureId, newId);
  };

  const handleDeleteStep = (childId: string) => {
    // 遍历所有 feature，查找要删除的 step
    let found = false;
    setUserSteps((prev) => {
      const newMap = new Map(prev);
      for (const [featureId, steps] of newMap.entries()) {
        const index = steps.findIndex(s => s.id === childId);
        if (index !== -1) {
          const newSteps = [...steps];
          newSteps.splice(index, 1);
          if (newSteps.length > 0) {
            newMap.set(featureId, newSteps);
          } else {
            newMap.delete(featureId);
          }
          found = true;
          break;
        }
      }
      return found ? newMap : prev;
    });

    if (found && selectedId === childId) {
      setSelectedId(null);
    }
    if (found) {
      setCheckedChildren(prev => {
        const next = new Set(prev);
        next.delete(childId);
        return next;
      });
    }

    if (found) {
      console.info("[Workbench] delete step:", childId);
    }
  };

  const handleStepRuntimeChange = useCallback((summaries: StepRuntimeSummary[]) => {
    const byId = new Map(summaries.map(summary => [summary.id, summary]));
    setUserSteps((prev) => {
      let changed = false;
      const next = new Map(prev);

      for (const [featureId, steps] of next.entries()) {
        const updated = steps.map((step) => {
          const summary = byId.get(step.id);
          if (!summary) return step;

          const csvFile = summary.csvPath
            ? summary.csvPath.split(/[/\\]/).pop() || step.csvFile
            : step.csvFile;
          const r2 = summary.r2Log != null ? summary.r2Log.toFixed(3) : step.r2;
          const status = summary.status === "fitted"
            ? "done"
            : summary.status === "loaded" || summary.status === "simulated"
              ? "loaded"
              : summary.status === "running"
                ? "running"
                : step.status;
          const nextStep = {
            ...step,
            status,
            r2,
            pts: summary.pts,
            bias: summary.curveType === "idvd"
              ? `Vgs=${fmtTreeNumber(summary.vgs)}V`
              : summary.curveType === "bv"
                ? step.bias
                : summary.curveType === "cv"
                  ? step.bias
                  : summary.curveType === "qg"
                    ? `Vg=${fmtTreeNumber(summary.vgs)}V`
                : `Vds=${fmtTreeNumber(summary.vds)}V`,
            csvFile,
            range: summary.pts > 0
              ? `${axisLabelForSummary(summary)} ${fmtTreeNumber(summary.vmin)}-${fmtTreeNumber(summary.vmax)}${summary.curveType === "qg" ? "nC" : "V"}`
              : step.range,
          };
          changed = changed || JSON.stringify(nextStep) !== JSON.stringify(step);
          return nextStep;
        });
        next.set(featureId, updated);
      }

      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    return addWorkbenchActionListener((action) => {
      if (action === "export") {
        setSelectedId("export_model");
      }
    });
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        height: "100%",
        backgroundColor: C.pageBg,
        fontFamily: ff,
        fontSize: 12,
        overflow: "hidden",
        pointerEvents: "auto",
      }}
    >
      {/* Fit Project Tree 列 */}
      <div
        style={{
          width: 224,
          minWidth: 224,
          display: "flex",
          flexDirection: "column",
          borderRight: `1px solid ${C.border}`,
          backgroundColor: C.panelBg,
          overflow: "hidden",
          pointerEvents: "auto",
        }}
      >
        <PowerCellSection
          config={powerCellConfig}
          isSelected={selectedId === "power_cell"}
          onSelect={() => setSelectedId("power_cell")}
        />
        <FitProjectTree
          treeData={treeData}
          checkedFeatures={checkedFeatures}
          checkedChildren={checkedChildren}
          expandedFeatures={expandedFeatures}
          selectedId={selectedId}
          onToggleFeature={toggleFeature}
          onToggleChild={toggleChild}
          onToggleExpand={toggleExpand}
          onSelect={setSelectedId}
          onAddStep={handleAddStep}
          onDeleteStep={handleDeleteStep}
        />
        <OperationButtonsPanel />
        <ExportModelStep
          isSelected={selectedId === "export_model"}
          onSelect={() => setSelectedId("export_model")}
        />
      </div>

      {/* 主区：嵌入 SingleCurveFit（hideChrome 关闭其内置菜单栏/工具栏） */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          backgroundColor: C.pageBg,
          overflow: "hidden",
          pointerEvents: "auto",
        }}
      >
        <SingleCurveFit
          hideChrome
          hideFitTargetsPanel
          externalPowerCell={powerCellConfig}
          onPowerCellChange={setPowerCellConfig}
          onStepRuntimeChange={handleStepRuntimeChange}
          selectedFitStepIds={checkedChildren}
          externalSelectedStep={
            selectedId === "power_cell"
              ? { id: "power_cell", label: "Power Cell", type: "power_cell" }
              : selectedId === "export_model"
              ? { id: "export_model", label: "Export Model", type: "export_model" }
              : selectedId
              ? (() => {
                  for (const feat of treeData) {
                    const child = feat.children.find(c => c.id === selectedId);
                    if (child) return child;
                  }
                  return null;
                })()
              : null
          }
        />
      </div>
    </div>
  );
}

export default Workbench;
