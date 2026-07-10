// Workbench.tsx - Fit Project Tree 工作台（接 Figma v2 设计稿）
// 完整功能版本：可拖动宽度 + Add/Delete step + 操作按钮
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  ChevronRight, ChevronDown, Plus, Trash2,
  CheckCircle2, Circle, Minus,
  Upload, Activity, Play, Square,
} from "lucide-react";
import { useApp } from "../../lib/store";
import { SingleCurveFit } from "./SingleCurveFit";
import { dispatchWorkbenchAction } from "../../lib/events";

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

const FIT_PROJECT_MIN_WIDTH = 260;
const FIT_PROJECT_MAX_WIDTH = 520;
const FIT_PROJECT_DEFAULT_WIDTH = 300;
const FIT_PROJECT_WIDTH_KEY = "spicebuilder.workbench.fitProjectWidth";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  const stored = Number(window.localStorage.getItem(key));
  return Number.isFinite(stored) ? clamp(stored, min, max) : fallback;
}

type FitStatus = "done" | "queued" | "running" | "empty" | "error";

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
  if (status === "running") return <Circle size={12} color={C.primary} style={{ animation: "pulse 1s infinite" }} />;
  if (status === "queued")  return <Circle size={12} color={C.textXs} />;
  if (status === "error")   return <Minus size={12} color={C.error} />;
  return <Circle size={12} color={C.border} />;
}

function useTreeData() {
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

    return [
      {
        id: "idvg", label: "IdVg / Transfer", tag: "live", canAdd: true, addLabel: "Add Vds step",
        children: [
          { id: "idvg_05", label: "IdVg @ Vds=0.5V", status: idvg_done ? "done" : (haveData ? "queued" : "empty"),
            r2: idvg_done ? r2 : null, pts: points(dataset?.idvg_vds05),
            bias: "Vds=0.5V", csvFile: "IdVg.csv", range: "Vgs 0–10V", weight: 1.0, type: "IdVg" },
          { id: "idvg_5",  label: "IdVg @ Vds=5V",   status: idvg_done ? "done" : (haveData ? "queued" : "empty"),
            r2: idvg_done ? r2 : null, pts: points(dataset?.idvg_vds5),
            bias: "Vds=5V", csvFile: "IdVg.csv", range: "Vgs 0–10V", weight: 1.0, type: "IdVg" },
        ],
      },
      {
        id: "idvd", label: "IdVd / Output", tag: "live", canAdd: true, addLabel: "Add Vgs step",
        children: [
          { id: "idvd_default", label: "IdVd @ Vgs=10V", status: idvd_done ? "done" : (haveData ? "queued" : "empty"),
            r2: idvd_done ? r2 : null, pts: idvd_pts,
            bias: "Vgs=10V", csvFile: "IdVd.csv", range: "Vds 0–30V", weight: 1.0, type: "IdVd" },
        ],
      },
      { id: "bv",         label: "BV / Leakage",      tag: "next", canAdd: false, children: [
        { id: "bvdss",  label: "BVDSS", status: "empty", r2: null, pts: 0, type: "BV" },
        { id: "bvgss_p", label: "BVGSS+", status: "empty", r2: null, pts: 0, type: "BV" },
        { id: "bvgss_n", label: "BVGSS-", status: "empty", r2: null, pts: 0, type: "BV" },
      ]},
      { id: "bodydiode",  label: "Body Diode",        tag: "next", canAdd: false, children: [
        { id: "isvsd", label: "Is-Vsd", status: "empty", r2: null, pts: 0, type: "BodyDiode" },
        { id: "qrr",   label: "Qrr",    status: "empty", r2: null, pts: 0, type: "BodyDiode" },
      ]},
      { id: "cv", label: "CV / Capacitance", tag: "next", canAdd: false, children: [
        { id: "ciss", label: "Ciss", status: "empty", r2: null, pts: 0, type: "CV" },
        { id: "coss", label: "Coss", status: "empty", r2: null, pts: 0, type: "CV" },
        { id: "crss", label: "Crss", status: "empty", r2: null, pts: 0, type: "CV" },
      ]},
      { id: "qg", label: "Qg / Gate Charge", tag: "next", canAdd: false, children: [
        { id: "qg_total", label: "Qg total", status: "empty", r2: null, pts: 0, type: "Qg" },
        { id: "qgs",      label: "Qgs",      status: "empty", r2: null, pts: 0, type: "Qg" },
        { id: "qgd",      label: "Qgd",      status: "empty", r2: null, pts: 0, type: "Qg" },
      ]},
      { id: "dpt", label: "DPT / Switching", tag: "next", canAdd: false, children: [
        { id: "dpt_on",  label: "Turn-on",  status: "empty", r2: null, pts: 0, type: "DPT" },
        { id: "dpt_off", label: "Turn-off", status: "empty", r2: null, pts: 0, type: "DPT" },
      ]},
    ];
  }, [dataset, fitResult]);
}

/* ============================================================
   Fit Project Tree
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
  onDeleteStep: (stepId: string) => void;
}) {
  return (
