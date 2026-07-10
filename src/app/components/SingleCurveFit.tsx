// SingleCurveFit.tsx - 单曲线 IdVg 拟合工作流（独立页面，无 project_id）
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend
} from "recharts";
import {
  Upload, Play, Pause, Plus, CheckCircle2, CircleMinus, Trash2, GripVertical,
  ChevronRight, LayoutGrid, AlignJustify, AlignLeft, Download, Square, Activity
} from "lucide-react";
import { Button } from "./ui";
import {
  csvLoad,
  csvSimulate,
  csvFitStream,
  csvCvWrapperFit,
  csvDualFitStream,
  csvExportModel,
  isApiEndpointNotFound,
  startBackend,
  stopBackend,
} from "../../lib/api";
import type { PowerMOSSubcktParams } from "../../lib/api";
import type { BvKind, CapType, PowerCapWrapper } from "../../lib/api";
import { useApp } from "../../lib/store";
import { BSIM3_PARAMS } from "../../lib/constants";
import { ParamSliders } from "./ParamSliders";

/* =========================================================================
   Plan: 单曲线 IdVg 拟合（解耦 project_id + 区间拖动）
   - 数据源: 用户用 open_excel_file 选 CSV, 不需要去 Data 页面加载
   - 流程: Load CSV -> 自动按 IdVg 渲染 -> 拖动区间 -> 勾选参数 -> Fit
   - 后端使用 /api/csv/* stateless 接口
   - 区间通过 recharts 上的 ReferenceLine + 透明覆盖层 div 实现拖动
   ========================================================================= */

import { addWorkbenchActionListener, dispatchWorkbenchState } from "../../lib/events";

const MARGIN = { top: 16, right: 32, bottom: 24, left: 56 };  // 与 recharts LineChart 一致
const CONFIG_PANEL_MIN_WIDTH = 340;
const CONFIG_PANEL_MAX_WIDTH = 680;
const CONFIG_PANEL_DEFAULT_WIDTH = 380;
const CONFIG_PANEL_WIDTH_KEY = "spicebuilder.workbench.configPanelWidth";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  const stored = Number(window.localStorage.getItem(key));
  return Number.isFinite(stored) ? clamp(stored, min, max) : fallback;
}

type StopPreset = "fast" | "balanced" | "precise" | "custom";
type CurveType = "idvg" | "idvd" | "bv" | "cv";
type FitTargetId = "idvg" | "idvd" | "bv" | "diode" | "cv" | "qg" | "dpt";
type LayoutMode = "grid" | "vertical" | "horizontal";

const IDVD_DEFAULT_VGS = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10];

const FIT_TARGET_TEMPLATES: Array<{
  id: FitTargetId;
  label: string;
  hint: string;
  children: string[];
  implemented: boolean;
}> = [
  {
    id: "idvg",
    label: "IdVg / Transfer",
    hint: "Vds 可自定义",
    children: ["IdVg @ Vds=0.5V", "IdVg @ Vds=5V"],
    implemented: true,
  },
  {
    id: "idvd",
    label: "IdVd / Output",
    hint: "Vgs 可自定义",
    children: IDVD_DEFAULT_VGS.map(vgs => `IdVd @ Vgs=${Number.parseFloat(vgs.toPrecision(6)).toString()}V`),
    implemented: true,
  },
  {
    id: "bv",
    label: "BV / Leakage",
    hint: "击穿与漏电",
    children: ["BVDSS", "BVGSS+", "BVGSS-"],
    implemented: true,
  },
  {
    id: "diode",
    label: "Body Diode",
    hint: "体二极管",
    children: ["Is-Vsd", "Qrr"],
    implemented: false,
  },
  {
    id: "cv",
    label: "CV / Capacitance",
    hint: "电容曲线",
    children: ["Ciss", "Coss", "Crss"],
    implemented: true,
  },
  {
    id: "qg",
    label: "Qg / Gate Charge",
    hint: "栅电荷",
    children: ["Qg total", "Qgs", "Qgd"],
    implemented: false,
  },
  {
    id: "dpt",
    label: "DPT / Switching",
    hint: "动态验证",
    children: ["Turn-on", "Turn-off"],
    implemented: false,
  },
];

const STOP_PRESETS: Record<Exclude<StopPreset, "custom">, {
  label: string;
  r2_log: number;
  r2_linear: number;
  ftol: number;
  xtol: number;
  gtol: number;
  max_nfev: number;
}> = {
  fast: { label: "快速", r2_log: 0.99, r2_linear: 0.99, ftol: 1e-4, xtol: 1e-4, gtol: 1e-4, max_nfev: 50 },
  balanced: { label: "标准", r2_log: 0.99, r2_linear: 0.99, ftol: 1e-6, xtol: 1e-6, gtol: 1e-6, max_nfev: 120 },
  precise: { label: "精细", r2_log: 0.99, r2_linear: 0.99, ftol: 1e-8, xtol: 1e-8, gtol: 1e-8, max_nfev: 300 },
};

const WB = {
  pageBg: "#F6F7F9",
  panelBg: "#FFFFFF",
  menuBg: "#EAECF0",
  border: "#D7DDE5",
  borderMd: "#BFC9D4",
  primary: "#0D7F8F",
  primaryLt: "#DFF4F6",
  text: "#1A2633",
  textMd: "#3D4F61",
  textSm: "#6B7A8D",
  textXs: "#8D9BAA",
  warning: "#B45309",
  shadow: "0 2px 8px rgba(0,0,0,0.12)",
};

const WORKBENCH_MENUS: Record<string, string[]> = {
  文件: ["导入 CSV", "导出结果", "—", "关闭项目"],
  编辑: ["重置当前参数", "锁定已拟合参数"],
  视图: ["Grid 多图布局", "Vertical 纵向布局", "Horizontal 横向布局"],
  拟合: ["仿真当前 Step", "拟合当前 Step", "拟合勾选 Steps", "停止拟合"],
  帮助: ["关于 SpiceBuilder"],
};

function WorkbenchMenuBar({
  onAction,
  onLayout,
}: {
  onAction: (action: string) => void;
  onLayout: (layout: LayoutMode) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleItem = (item: string) => {
    setOpen(null);
    if (item === "导入 CSV") onAction("import");
    if (item === "导出结果") onAction("export");
    if (item === "重置当前参数") onAction("reset-current");
    if (item === "锁定已拟合参数") onAction("lock-fitted");
    if (item === "Grid 多图布局") onLayout("grid");
    if (item === "Vertical 纵向布局") onLayout("vertical");
    if (item === "Horizontal 横向布局") onLayout("horizontal");
    if (item === "仿真当前 Step") onAction("simulate");
    if (item === "拟合当前 Step") onAction("fit-current");
    if (item === "拟合勾选 Steps") onAction("fit-selected");
    if (item === "停止拟合") onAction("stop");
    if (item === "关于 SpiceBuilder") onAction("about");
  };

  return (
    <div
      ref={ref}
      style={{
        height: 28,
        display: "flex",
        alignItems: "center",
        background: WB.menuBg,
        borderBottom: `1px solid ${WB.border}`,
        paddingLeft: 8,
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 700, color: WB.primary, paddingRight: 10 }}>SpiceBuilder</span>
      <div style={{ width: 1, height: 16, background: WB.border, marginRight: 6 }} />
      {Object.keys(WORKBENCH_MENUS).map(menu => (
        <div key={menu} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setOpen(open === menu ? null : menu)}
            onMouseEnter={() => { if (open) setOpen(menu); }}
            style={{
              height: 28,
              padding: "0 10px",
              border: 0,
              cursor: "pointer",
              background: open === menu ? WB.primaryLt : "transparent",
              color: open === menu ? WB.primary : WB.text,
              fontSize: 12,
            }}
          >
            {menu}
          </button>
          {open === menu && (
            <div
              style={{
                position: "absolute",
                top: 28,
                left: 0,
                zIndex: 1000,
                minWidth: 190,
                padding: "3px 0",
                background: WB.panelBg,
                border: `1px solid ${WB.border}`,
                borderRadius: "var(--radius-sm)",
                boxShadow: WB.shadow,
              }}
            >
              {WORKBENCH_MENUS[menu].map((item, idx) => item === "—" ? (
                <div key={`${menu}-${idx}`} style={{ height: 1, background: WB.border, margin: "3px 0" }} />
              ) : (
                <button
                  key={item}
                  type="button"
                  onClick={() => handleItem(item)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "5px 14px",
                    border: 0,
                    cursor: "pointer",
                    background: "transparent",
                    color: WB.text,
                    fontSize: 12,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = WB.primaryLt; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ToolButton({
  children,
  active,
  primary,
  disabled,
  onClick,
  title,
}: {
  children: ReactNode;
  active?: boolean;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 10px",
        borderRadius: "var(--radius-sm)",
        border: primary ? 0 : `1px solid ${active ? WB.primary : WB.border}`,
        background: primary ? WB.primary : active ? WB.primaryLt : WB.panelBg,
        color: primary ? "#fff" : active ? WB.primary : disabled ? WB.textXs : WB.textMd,
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function WorkbenchToolbar({
  layout,
  isRunning,
  loadedCount,
  activeStepName,
  canImport,
  canSimulate,
  canFit,
  onLayout,
  onAction,
}: {
  layout: LayoutMode;
  isRunning: boolean;
  loadedCount: number;
  activeStepName: string;
  canImport: boolean;
  canSimulate: boolean;
  canFit: boolean;
  onLayout: (layout: LayoutMode) => void;
  onAction: (action: string) => void;
}) {
  return (
    <div
      style={{
        height: 44,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 14px",
        borderBottom: `1px solid ${WB.border}`,
        background: WB.panelBg,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: WB.textSm, minWidth: 0 }}>
        <span style={{ color: WB.textXs }}>Project</span>
        <ChevronRight size={11} color={WB.textXs} />
        <span style={{ color: WB.textMd, fontWeight: 600 }}>Power MOS</span>
        <ChevronRight size={11} color={WB.textXs} />
        <span style={{ color: WB.text, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {activeStepName}
        </span>
        <span style={{ fontSize: 10, color: WB.textXs, paddingLeft: 4 }}>{loadedCount} loaded</span>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", border: `1px solid ${WB.border}`, borderRadius: "var(--radius-md)", overflow: "hidden" }}>
        {([
          { id: "grid" as LayoutMode, icon: <LayoutGrid size={13} />, label: "Grid" },
          { id: "vertical" as LayoutMode, icon: <AlignLeft size={13} />, label: "Vertical" },
          { id: "horizontal" as LayoutMode, icon: <AlignJustify size={13} />, label: "Horizontal" },
        ]).map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => onLayout(item.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              border: 0,
              cursor: "pointer",
              fontSize: 12,
              background: layout === item.id ? WB.primary : "transparent",
              color: layout === item.id ? "#fff" : WB.textSm,
            }}
          >
            {item.icon}{item.label}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 24, background: WB.border }} />

      <ToolButton disabled={!canImport} onClick={() => onAction("import")} title="加载当前 step 的 CSV">
        <Upload size={13} />Import
      </ToolButton>
      <ToolButton disabled={!canSimulate} onClick={() => onAction("simulate")} title="用当前参数仿真当前 step">
        <Activity size={13} />Simulate
      </ToolButton>
      <ToolButton primary disabled={!canFit || isRunning} onClick={() => onAction("fit-selected")} title="一个已加载 step 时执行单拟合，两个及以上执行联合拟合">
        <Play size={13} />Fit Selected
      </ToolButton>
      <ToolButton disabled={!isRunning} onClick={() => onAction("stop")} title="停止当前拟合，并保存当前最好结果">
        <Square size={13} />Stop
      </ToolButton>
      <ToolButton onClick={() => onAction("export")} title="导出结果入口">
        <Download size={13} />Export
      </ToolButton>
    </div>
  );
}

type CurveRaw = { ivar: number[]; dvar: number[]; meta: Record<string, unknown> };

type FitHistoryPoint = {
  step: number;
  params: Record<string, number>;
  sim: number[];
  r2_linear: number;
  r2_log: number;
  ftol_metric: number;
  xtol_metric: number;
  gtol_metric: number;
  fit_rms: number;
  bound_events?: Array<Record<string, unknown>>;
};

type TransferStep = {
  id: string;
  name: string;
  curveType: CurveType;
  vds: number;
  vgs: number;
  vdsMax: number;
  bvKind: BvKind;
  capType: CapType;
  csvPath: string;
  raw: CurveRaw | null;
  simCurve: number[];
  vmin: number;
  vmax: number;
  status: "empty" | "loaded" | "simulated" | "fitted";
  rms: number | null;
  r2Log: number | null;
  r2Linear: number | null;
  fitHistory: FitHistoryPoint[];
  selectedForFit: boolean;
  fittedParams?: Record<string, number>;
};

export type StepRuntimeSummary = {
  id: string;
  status: "empty" | "loaded" | "simulated" | "fitted" | "running";
  curveType: CurveType;
  csvPath: string;
  pts: number;
  vds: number;
  vgs: number;
  vdsMax: number;
  bvKind: BvKind;
  capType: CapType;
  vmin: number;
  vmax: number;
  r2Log: number | null;
  r2Linear: number | null;
  rms: number | null;
};

function makeTransferStep(
  index: number,
  bias: number,
  id?: string,
  name?: string,
  curveType: CurveType = "idvg",
): TransferStep {
  const bvKind = bvKindFromStepId(id);
  const capType = capTypeFromStepId(id);
  const bvLabel = bvKind === "bvgss_p" ? "BVGSS+" : bvKind === "bvgss_n" ? "BVGSS-" : "BVDSS";
  const cvLabel = capType === "coss" ? "Coss" : capType === "crss" ? "Crss" : "Ciss";
  return {
    id: id ?? `step-${Date.now()}-${index}`,
    name: name ?? (curveType === "idvd" ? `IdVd @ Vgs=${bias}V` : curveType === "bv" ? bvLabel : curveType === "cv" ? cvLabel : `IdVg @ Vds=${bias}V`),
    curveType,
    vds: curveType === "idvg" ? bias : 0.5,
    vgs: curveType === "idvd" ? bias : 10.0,
    vdsMax: curveType === "bv" ? Math.max(120.0, bias || 120.0) : curveType === "cv" ? Math.max(25.0, bias || 25.0) : 12.0,
    bvKind,
    capType,
    csvPath: "",
    raw: null,
    simCurve: [],
    vmin: curveType === "idvd" ? 0.0 : curveType === "bv" ? 0.0 : curveType === "cv" ? 1.0 : 3.5,
    vmax: curveType === "idvd" ? 12.0 : curveType === "bv" ? Math.max(120.0, bias || 120.0) : curveType === "cv" ? Math.max(25.0, bias || 25.0) : 5.0,
    status: "empty",
    rms: null,
    r2Log: null,
    r2Linear: null,
    fitHistory: [],
    selectedForFit: true,
  };
}

function fmtParam(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) return v.toExponential(4);
  return Number.parseFloat(v.toPrecision(6)).toString();
}

function fmtTol(v: number): string {
  if (!Number.isFinite(v)) return "1e-6";
  if (v === 0) return "0";
  return v.toExponential(0);
}

const SPICE_PARAM_NAMES = new Set(BSIM3_PARAMS.map(param => param.name.toUpperCase()));

function parseSpiceNumber(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/^\(/, "")
    .replace(/[),]+$/, "")
    .replace(/[dD]([+-]?\d+)$/, "e$1");
  const match = cleaned.match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)([a-zA-Z]*)$/);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    f: 1e-15,
    p: 1e-12,
    n: 1e-9,
    u: 1e-6,
    m: 1e-3,
    k: 1e3,
    meg: 1e6,
    g: 1e9,
    t: 1e12,
  };
  if (!suffix) return base;
  return suffix in multipliers ? base * multipliers[suffix] : null;
}

function stripSpiceComment(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("*")) return "";
  const semi = line.indexOf(";");
  return semi >= 0 ? line.slice(0, semi) : line;
}

type SpiceWrapperImport = {
  activeAreaMm2?: number;
  cellPitchUm?: number;
  rgOhm?: number;
  rdExtOhm?: number;
  rsExtOhm?: number;
  rdriftOhm?: number;
  rjfetOhm?: number;
  unitMultiplier?: number;
  unitWidthM?: number;
  includeDiode?: boolean;
  inferredFromM1?: boolean;
};

function parsePowerNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(/[),]+$/, "");
  const unitless = trimmed.replace(/(mm2|um|ohm)$/i, "");
  return parseSpiceNumber(unitless);
}

function parseTokenMap(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const tokenRegex = /(^|[\s,])([A-Za-z][A-Za-z0-9_]*)\s*=\s*([^\s,()]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(text)) !== null) {
    const value = parsePowerNumber(match[3]);
    if (value !== null && Number.isFinite(value)) {
      out[match[2].toUpperCase()] = value;
    }
  }
  return out;
}

function parseSpiceWrapper(text: string, fallbackCellPitchUm: number): SpiceWrapperImport {
  const wrapper: SpiceWrapperImport = {};
  const lines = text.split(/\r?\n/);
  const powerLine = lines.find(line => /^\s*\*\s*Power wrapper:/i.test(line));
  if (powerLine) {
    const values = parseTokenMap(powerLine.replace(/^\s*\*\s*Power wrapper:\s*/i, ""));
    if (values.RG !== undefined) wrapper.rgOhm = values.RG;
    if (values.RD_EXT !== undefined) wrapper.rdExtOhm = values.RD_EXT;
    if (values.RS_EXT !== undefined) wrapper.rsExtOhm = values.RS_EXT;
    if (values.RDRIFT !== undefined) wrapper.rdriftOhm = values.RDRIFT;
    if (values.RJFET !== undefined) wrapper.rjfetOhm = values.RJFET;
    if (values.AA !== undefined && values.AA > 0) wrapper.activeAreaMm2 = values.AA;
    if (values.CELLPITCH !== undefined && values.CELLPITCH > 0) wrapper.cellPitchUm = values.CELLPITCH;
    if (values.UNITM !== undefined && values.UNITM > 0) wrapper.unitMultiplier = values.UNITM;
  }

  const m1Line = lines.find(line => /^\s*M1\b/i.test(stripSpiceComment(line)));
  if (m1Line) {
    const values = parseTokenMap(stripSpiceComment(m1Line));
    if (values.W !== undefined && values.W > 0) wrapper.unitWidthM = values.W;
    if (values.M !== undefined && values.M > 0) {
      wrapper.unitMultiplier = wrapper.unitMultiplier ?? values.M;
      if (wrapper.activeAreaMm2 === undefined) {
        const pitch = wrapper.cellPitchUm ?? fallbackCellPitchUm;
        if (Number.isFinite(pitch) && pitch > 0) {
          wrapper.activeAreaMm2 = values.M * pitch / 1e6;
          wrapper.inferredFromM1 = true;
        }
      }
    }
  }

  const hasSubckt = /^\s*\.SUBCKT\b/im.test(text);
  const hasBodyDiode = /^\s*Dbody\b/im.test(text) || /^\s*\.MODEL\s+Dbody_diode\b/im.test(text);
  if (hasSubckt || powerLine) wrapper.includeDiode = hasBodyDiode;
  return wrapper;
}

function parseSpiceParams(text: string, fallbackCellPitchUm = 2.0): { params: Record<string, number>; unknown: string[]; invalid: string[]; wrapper: SpiceWrapperImport } {
  const params: Record<string, number> = {};
  const unknown = new Set<string>();
  const invalid: string[] = [];
  const normalized = text
    .split(/\r?\n/)
    .map(stripSpiceComment)
    .filter(Boolean)
    .map(line => line.replace(/^\s*\+\s*/, " "))
    .join(" ")
    .replace(/[()]/g, " ");

  const tokenRegex = /(^|[\s,])([A-Za-z][A-Za-z0-9_]*)\s*=\s*([^\s,()]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(normalized)) !== null) {
    const rawName = match[2].toUpperCase();
    const rawValue = match[3];
    if (!SPICE_PARAM_NAMES.has(rawName)) {
      unknown.add(rawName);
      continue;
    }
    const value = parseSpiceNumber(rawValue);
    if (value === null || !Number.isFinite(value)) {
      invalid.push(`${rawName}=${rawValue}`);
      continue;
    }
    params[rawName] = value;
  }

  return { params, unknown: Array.from(unknown), invalid, wrapper: parseSpiceWrapper(text, fallbackCellPitchUm) };
}

function positiveOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function parseBiasVoltage(bias: string | undefined, fallback: number): number {
  if (!bias) return fallback;
  const match = bias.match(/=\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/i);
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) ? value : fallback;
}

function curveTypeFromExternal(type: string | undefined): CurveType {
  if (type === "IdVd") return "idvd";
  if (type === "BV") return "bv";
  if (type === "CV") return "cv";
  return "idvg";
}

function bvKindFromStepId(id: string | undefined): BvKind {
  if (id === "bvgss_p") return "bvgss_p";
  if (id === "bvgss_n") return "bvgss_n";
  return "bvdss";
}

function capTypeFromStepId(id: string | undefined): CapType {
  if (id === "coss") return "coss";
  if (id === "crss") return "crss";
  return "ciss";
}

function targetIdForCurve(curveType: CurveType): FitTargetId {
  if (curveType === "idvd") return "idvd";
  if (curveType === "bv") return "bv";
  if (curveType === "cv") return "cv";
  return "idvg";
}

function initialFitRange(values: number[], curveType: CurveType, bvKind: BvKind = "bvdss"): [number, number] {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return curveType === "idvd" ? [0, 1] : curveType === "bv" ? [0, 120] : curveType === "cv" ? [1, 25] : [3.5, 5.0];
  const lo = finite[0];
  const hi = finite[finite.length - 1];
  if (!(hi > lo)) {
    const pad = Math.max(Math.abs(hi) * 0.05, curveType === "idvd" || curveType === "bv" || curveType === "cv" ? 0.1 : 0.05);
    return [lo - pad, hi + pad];
  }
  const q = (p: number) => finite[Math.min(finite.length - 1, Math.max(0, Math.round((finite.length - 1) * p)))];
  const bvNegSweep = curveType === "bv" && bvKind === "bvgss_n" && Math.abs(lo) >= Math.abs(hi);
  let nextMin = q(curveType === "idvd" ? 0.2 : curveType === "bv" ? (bvNegSweep ? 0.0 : 0.55) : curveType === "cv" ? 0.0 : 0.4);
  let nextMax = q(curveType === "idvd" ? 0.85 : curveType === "bv" ? (bvNegSweep ? 0.45 : 1.0) : curveType === "cv" ? 1.0 : 0.6);
  if (!(nextMax > nextMin)) {
    nextMin = lo + (hi - lo) * (curveType === "idvd" ? 0.15 : curveType === "bv" ? (bvNegSweep ? 0.0 : 0.5) : curveType === "cv" ? 0.0 : 0.35);
    nextMax = lo + (hi - lo) * (curveType === "idvd" ? 0.85 : curveType === "bv" ? (bvNegSweep ? 0.45 : 1.0) : curveType === "cv" ? 1.0 : 0.65);
  }
  if (!(nextMax > nextMin)) return [lo, hi];
  return [Number(nextMin.toPrecision(6)), Number(nextMax.toPrecision(6))];
}

export function SingleCurveFit({
  hideChrome = false,
  hideFitTargetsPanel = false,
  externalSelectedStep = null,
  externalPowerCell = null,
  onPowerCellChange = null,
  onStepRuntimeChange = null,
  selectedFitStepIds = null,
}: {
  hideChrome?: boolean;
  hideFitTargetsPanel?: boolean;
  externalSelectedStep?: {
    id: string;
    label: string;
    type?: string;
    bias?: string;
    csvFile?: string;
    range?: string;
    weight?: number;
  } | null;
  externalPowerCell?: {
    activeAreaMm2: number;
    cellPitchUm: number;
  } | null;
  onPowerCellChange?: ((config: { activeAreaMm2: number; cellPitchUm: number }) => void) | null;
  onStepRuntimeChange?: ((steps: StepRuntimeSummary[]) => void) | null;
  selectedFitStepIds?: Set<string> | string[] | null;
} = {}) {
  const { setLog } = useApp();
  const [steps, setSteps] = useState<TransferStep[]>(() => [
    makeTransferStep(1, 0.5, "idvg_05", "IdVg @ Vds=0.5V"),
    makeTransferStep(2, 5.0, "idvg_5", "IdVg @ Vds=5V"),
  ]);
  const [activeStep, setActiveStep] = useState(0);
  const [selectedFitTargets, setSelectedFitTargets] = useState<Set<FitTargetId>>(
    () => new Set(FIT_TARGET_TEMPLATES.map(item => item.id))
  );
  const [activeTreeItem, setActiveTreeItem] = useState<FitTargetId | "idvg-step">("idvg");
  const [expandedFitTargets, setExpandedFitTargets] = useState<Set<FitTargetId>>(
    () => new Set(FIT_TARGET_TEMPLATES.map(item => item.id))
  );

  // Power Cell 配置：如果外部提供则使用外部的，否则使用本地状态
  const [localActiveAreaMm2, setLocalActiveAreaMm2] = useState(10.0);
  const [localCellPitchUm, setLocalCellPitchUm] = useState(2.0);

  const activeAreaMm2 = externalPowerCell?.activeAreaMm2 ?? localActiveAreaMm2;
  const cellPitchUm = externalPowerCell?.cellPitchUm ?? localCellPitchUm;

  const setActiveAreaMm2 = useCallback((value: number) => {
    if (onPowerCellChange && externalPowerCell) {
      onPowerCellChange({ ...externalPowerCell, activeAreaMm2: value });
    } else {
      setLocalActiveAreaMm2(value);
    }
  }, [onPowerCellChange, externalPowerCell]);

  const setCellPitchUm = useCallback((value: number) => {
    if (onPowerCellChange && externalPowerCell) {
      onPowerCellChange({ ...externalPowerCell, cellPitchUm: value });
    } else {
      setLocalCellPitchUm(value);
    }
  }, [onPowerCellChange, externalPowerCell]);

  // ---- 文件 ----
  const [csvPath, setCsvPath] = useState("");
  const [loading, setLoading] = useState(false);

  // ---- 数据 ----
  const [raw, setRaw] = useState<{ ivar: number[]; dvar: number[]; meta: Record<string, unknown> } | null>(null);
  const [simCurve, setSimCurve] = useState<number[]>([]);

  // ---- 区间 ----
  // 默认 3.5-5V, 避开亚阈值仪器噪声 (Vgs<3.5V 是 30mA 噪声地板)
  const [vmin, setVmin] = useState(3.5);
  const [vmax, setVmax] = useState(5.0);
  const [vds, setVds] = useState(0.5);  // 曲线 1 的 Vds 偏置 (V)
  const [vgs, setVgs] = useState(10.0);  // IdVd 的固定 Vgs 偏置 (V)
  const [vdsMax, setVdsMax] = useState(12.0);  // IdVd 的 Vds sweep 上限
  const [dragging, setDragging] = useState<null | "min" | "max">(null);

  // ---- 参数 ----
  const [pvals, setPvals] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    BSIM3_PARAMS.forEach(p => { m[p.name] = p.default; });
    return m;
  });
  // 默认勾选 8 个对 IdVg 形状最关键的参数 (VTH0+U0+TOX+UA+UB+VSAT+A0+AGS)
  // 5 参数时线性 R² 只有 0.48, 加上 A0/AGS (CLM) 才能 0.99+
  // 9+ 会触发 overfit, 慎用
  const [checked, setChecked] = useState<Set<string>>(
    new Set(["VTH0", "U0", "TOX", "UA", "UB", "VSAT", "A0", "AGS"])
  );
  const [lockedParams, setLockedParams] = useState<Set<string>>(new Set());
  const [customBounds, setCustomBounds] = useState<Record<string, { min?: string; max?: string }>>({});

  // ---- 拟合 ----
  const [fitting, setFitting] = useState(false);
  const [fitRMS, setFitRMS] = useState<number | null>(null);
  const [fitR2, setFitR2] = useState<number | null>(null);
  const [fitR2Linear, setFitR2Linear] = useState<number | null>(null);
  const [stopPreset, setStopPreset] = useState<StopPreset>("balanced");
  const [fitStop, setFitStop] = useState({
    r2_log: STOP_PRESETS.balanced.r2_log,
    r2_linear: STOP_PRESETS.balanced.r2_linear,
    ftol: STOP_PRESETS.balanced.ftol,
    xtol: STOP_PRESETS.balanced.xtol,
    gtol: STOP_PRESETS.balanced.gtol,
    max_nfev: STOP_PRESETS.balanced.max_nfev,
  });
  const [fitHistory, setFitHistory] = useState<FitHistoryPoint[]>([]);
  // 拟合收敛动画播放
  const [animPlaying, setAnimPlaying] = useState(false);
  const [animIndex, setAnimIndex] = useState(0);
  const [plotSplit, setPlotSplit] = useState(0.7);
  const [configPanelWidth, setConfigPanelWidth] = useState(() =>
    readStoredWidth(CONFIG_PANEL_WIDTH_KEY, CONFIG_PANEL_DEFAULT_WIDTH, CONFIG_PANEL_MIN_WIDTH, CONFIG_PANEL_MAX_WIDTH)
  );
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [yScaleMode, setYScaleMode] = useState<"linear" | "log">("linear");
  const [workbenchLayout, setWorkbenchLayout] = useState<LayoutMode>("grid");
  const [protectPrevious, setProtectPrevious] = useState(true);
  const [protectWeight, setProtectWeight] = useState(0.4);
  const [dragStepId, setDragStepId] = useState<string | null>(null);
  const [dragOverStepIndex, setDragOverStepIndex] = useState<number | null>(null);
  // 侧边栏 Tab 切换: "steps" = Transfer Steps, "params" = BSIM3 参数, "export" = SPICE 导出
  const [sidePanelTab, setSidePanelTab] = useState<"steps" | "params" | "export">("steps");
  const [exportFormat, setExportFormat] = useState<"subckt" | "bsim3">("subckt");
  const [exportSubcktName, setExportSubcktName] = useState("MY_MOSFET");
  const [exportOutputPath, setExportOutputPath] = useState("");
  const [exportIncludeDiode, setExportIncludeDiode] = useState(true);
  const [exportRgOhm, setExportRgOhm] = useState(1.6);
  const [importedWrapperOverrides, setImportedWrapperOverrides] = useState<Partial<PowerMOSSubcktParams>>({});
  const [capWrapper, setCapWrapper] = useState<PowerCapWrapper | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ path: string; nBytes: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [importingParams, setImportingParams] = useState(false);
  // ParamSliders 回调包装 (避免 JSX-in-JSX prop 嵌入)
  const onBoundsChange = useCallback((name: string, next: { min?: string; max?: string }) => {
    setCustomBounds(prev => ({ ...prev, [name]: next }));
  }, []);
  const onResetBounds = useCallback((name: string) => {
    setCustomBounds(prev => { const n = { ...prev }; delete n[name]; return n; });
  }, []);
  const onResetCatBounds = useCallback((cat: string) => {
    setCustomBounds(prev => { const n = { ...prev } as Record<string, { min?: string; max?: string }>; for (const p of BSIM3_PARAMS.filter(item => item.category === cat)) delete (n as Record<string, { min?: string; max?: string }>)[p.name]; return n; });
  }, []);


  // ---- 防抖 ----
  const pendingRef = useRef<Record<string, number>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chartPaneRef = useRef<HTMLDivElement>(null);
  const stepRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const stepDragRef = useRef<{ stepId: string; startY: number; active: boolean } | null>(null);
  const suppressStepClickRef = useRef(false);

  const beginConfigResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = configPanelWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      setConfigPanelWidth(clamp(
        startWidth + ev.clientX - startX,
        CONFIG_PANEL_MIN_WIDTH,
        CONFIG_PANEL_MAX_WIDTH,
      ));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [configPanelWidth]);

  // mount 时 log 一次 (开发模式)
  useEffect(() => {
    setLog("info", "TransferFit mounted");
    return () => setLog("info", "TransferFit unmounted");
  }, [setLog]);

  useEffect(() => {
    window.localStorage.setItem(CONFIG_PANEL_WIDTH_KEY, String(Math.round(configPanelWidth)));
  }, [configPanelWidth]);

  // 拟合收敛动画自动播放: 抽样到 ~30 帧, 200ms 一步
  useEffect(() => {
    if (!animPlaying) {
      if (animTimerRef.current !== null) {
        clearTimeout(animTimerRef.current);
        animTimerRef.current = null;
      }
      return;
    }
    const total = fitHistory.length;
    if (total === 0) return;
    const targetFrames = 30;
    const stepInterval = Math.max(1, Math.floor(total / targetFrames));
    if (animIndex >= total - 1) {
      setAnimPlaying(false);
      return;
    }
    animTimerRef.current = setTimeout(() => {
      setAnimIndex(i => Math.min(i + stepInterval, total - 1));
    }, 200);
    return () => {
      if (animTimerRef.current !== null) clearTimeout(animTimerRef.current);
    };
  }, [animPlaying, animIndex, fitHistory.length]);

  useEffect(() => {
    if (!draggingSplit) return;
    const onMove = (e: MouseEvent) => {
      const rect = chartPaneRef.current?.getBoundingClientRect();
      if (!rect || rect.height <= 0) return;
      const next = (e.clientY - rect.top) / rect.height;
      setPlotSplit(Math.max(0.45, Math.min(0.85, next)));
    };
    const onUp = () => setDraggingSplit(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingSplit]);

  // 拟合取消: AbortController 让 fetch 中断
  const fitAbortRef = useRef<AbortController | null>(null);
  const simAbortRef = useRef<AbortController | null>(null);
  const simRunIdRef = useRef(0);

  const currentStepPatch = useCallback((overrides: Partial<TransferStep> = {}): TransferStep => ({
    ...steps[activeStep],
    csvPath,
    raw,
    simCurve,
    vmin,
    vmax,
    vds,
    vgs,
    vdsMax,
    bvKind: steps[activeStep]?.bvKind ?? "bvdss",
    capType: steps[activeStep]?.capType ?? "ciss",
    rms: fitRMS,
    r2Log: fitR2,
    r2Linear: fitR2Linear,
    fitHistory,
    ...overrides,
  }), [steps, activeStep, csvPath, raw, simCurve, vmin, vmax, vds, vgs, vdsMax, fitRMS, fitR2, fitR2Linear, fitHistory]);

  const updateActiveStep = useCallback((overrides: Partial<TransferStep> = {}) => {
    setSteps(prev => prev.map((step, idx) => (
      idx === activeStep
        ? {
            ...step,
            csvPath,
            raw,
            simCurve,
            vmin,
            vmax,
            vds,
            vgs,
            vdsMax,
            bvKind: step.bvKind,
            capType: step.capType,
            rms: fitRMS,
            r2Log: fitR2,
            r2Linear: fitR2Linear,
            fitHistory,
            ...overrides,
          }
        : step
    )));
  }, [activeStep, csvPath, raw, simCurve, vmin, vmax, vds, vgs, vdsMax, fitRMS, fitR2, fitR2Linear, fitHistory]);

  const loadStepIntoEditor = useCallback((step: TransferStep) => {
    setCsvPath(step.csvPath);
    setRaw(step.raw);
    setSimCurve(step.simCurve);
    setVmin(step.vmin);
    setVmax(step.vmax);
    setVds(step.vds);
    setVgs(step.vgs);
    setVdsMax(step.vdsMax);
    // capType/bvKind live on the step object; scalar editor controls read
    // them from steps[activeStep] after setActiveStep.
    setFitRMS(step.rms);
    setFitR2(step.r2Log);
    setFitR2Linear(step.r2Linear);
    setFitHistory(step.fitHistory ?? []);
    setAnimIndex(0);
    setAnimPlaying(false);
  }, []);

  const onSelectStep = useCallback((idx: number) => {
    if (idx === activeStep || fitting) return;
    const saved = currentStepPatch();
    setSteps(prev => prev.map((step, i) => i === activeStep ? saved : step));
    loadStepIntoEditor(idx === activeStep ? saved : steps[idx]);
    setActiveStep(idx);
  }, [activeStep, currentStepPatch, fitting, loadStepIntoEditor, steps]);

  useEffect(() => {
    if (
      !externalSelectedStep ||
      externalSelectedStep.id === "power_cell" ||
      externalSelectedStep.id === "export_model" ||
      fitting
    ) return;
    if (steps[activeStep]?.id === externalSelectedStep.id) {
      updateActiveStep();
      return;
    }

    const saved = currentStepPatch();
    const existingIdx = steps.findIndex(step => step.id === externalSelectedStep.id);
    if (existingIdx >= 0) {
      setSteps(prev => prev.map((step, i) => i === activeStep ? saved : step));
      loadStepIntoEditor(existingIdx === activeStep ? saved : steps[existingIdx]);
      setActiveStep(existingIdx);
      return;
    }

    const nextCurveType: CurveType = curveTypeFromExternal(externalSelectedStep.type);
    const nextBias = parseBiasVoltage(
      externalSelectedStep.bias,
      nextCurveType === "idvd" ? (steps[steps.length - 1]?.vgs ?? 10.0) : nextCurveType === "bv" ? 120.0 : nextCurveType === "cv" ? 25.0 : (steps[steps.length - 1]?.vds ?? 0.5),
    );
    const next = makeTransferStep(
      steps.length + 1,
      nextBias,
      externalSelectedStep.id,
      externalSelectedStep.label,
      nextCurveType,
    );
    next.bvKind = bvKindFromStepId(externalSelectedStep.id);
    next.capType = capTypeFromStepId(externalSelectedStep.id);
    setSteps(prev => prev.map((step, i) => i === activeStep ? saved : step).concat(next));
    loadStepIntoEditor(next);
    setActiveStep(steps.length);
  }, [
    activeStep,
    currentStepPatch,
    externalSelectedStep,
    fitting,
    loadStepIntoEditor,
    steps,
    updateActiveStep,
  ]);

  const onAddStep = useCallback(() => {
    if (fitting) return;
    const saved = currentStepPatch();
    const nextVds = steps.length === 0 ? 0.5 : steps[steps.length - 1].vds;
    const next = makeTransferStep(steps.length + 1, nextVds);
    setSteps(prev => prev.map((step, i) => i === activeStep ? saved : step).concat(next));
    loadStepIntoEditor(next);
    setActiveStep(steps.length);
  }, [activeStep, currentStepPatch, fitting, loadStepIntoEditor, steps]);

  const onDeleteStep = useCallback((idx: number) => {
    if (fitting || steps.length <= 1) return;
    const saved = currentStepPatch();
    const materialized = steps.map((step, i) => i === activeStep ? saved : step);
    const nextSteps = materialized.filter((_, i) => i !== idx);
    const nextActive = idx === activeStep
      ? Math.min(idx, nextSteps.length - 1)
      : idx < activeStep
        ? activeStep - 1
        : activeStep;
    setSteps(nextSteps);
    setActiveStep(nextActive);
    loadStepIntoEditor(nextSteps[nextActive]);
  }, [activeStep, currentStepPatch, fitting, loadStepIntoEditor, steps]);

  const onReorderStep = useCallback((fromId: string, insertIdx: number) => {
    if (fitting) return;
    const saved = currentStepPatch();
    const materialized = steps.map((step, i) => i === activeStep ? saved : step);
    const fromIdx = materialized.findIndex(step => step.id === fromId);
    if (fromIdx < 0) return;
    const activeId = materialized[activeStep]?.id;
    const next = [...materialized];
    const [moved] = next.splice(fromIdx, 1);
    const normalizedInsertIdx = Math.max(0, Math.min(insertIdx, materialized.length));
    const adjustedInsertIdx = fromIdx < normalizedInsertIdx
      ? normalizedInsertIdx - 1
      : normalizedInsertIdx;
    if (fromIdx === adjustedInsertIdx) return;
    next.splice(adjustedInsertIdx, 0, moved);
    const nextActive = Math.max(0, next.findIndex(step => step.id === activeId));
    setSteps(next);
    setActiveStep(nextActive);
    loadStepIntoEditor(next[nextActive]);
  }, [activeStep, currentStepPatch, fitting, loadStepIntoEditor, steps]);

  const getStepInsertIndex = useCallback((clientY: number) => {
    for (let idx = 0; idx < steps.length; idx += 1) {
      const rect = stepRowRefs.current[steps[idx].id]?.getBoundingClientRect();
      if (!rect) continue;
      if (clientY < rect.top + rect.height / 2) return idx;
    }
    return steps.length;
  }, [steps]);

  // 使用 ref 保存最新的依赖项，避免拖动过程中重新注册监听器
  const dragDepsRef = useRef({ fitting: false, getStepInsertIndex, onReorderStep });
  useEffect(() => {
    dragDepsRef.current = { fitting, getStepInsertIndex, onReorderStep };
  }, [fitting, getStepInsertIndex, onReorderStep]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = stepDragRef.current;
      if (!drag || dragDepsRef.current.fitting) return;
      const moved = Math.abs(e.clientY - drag.startY);
      if (!drag.active && moved < 5) return;
      if (!drag.active) {
        drag.active = true;
        suppressStepClickRef.current = true;
        setDragStepId(drag.stepId);
      }
      setDragOverStepIndex(dragDepsRef.current.getStepInsertIndex(e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      const drag = stepDragRef.current;
      if (!drag) return;
      stepDragRef.current = null;
      if (drag.active && !dragDepsRef.current.fitting) {
        dragDepsRef.current.onReorderStep(drag.stepId, dragDepsRef.current.getStepInsertIndex(e.clientY));
      }
      setDragStepId(null);
      setDragOverStepIndex(null);
      window.setTimeout(() => {
        suppressStepClickRef.current = false;
      }, 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []); // 空依赖数组，监听器只注册一次

  const onCancelFit = useCallback(() => {
    let cancelled = false;
    if (fitAbortRef.current) {
      fitAbortRef.current.abort();
      setLog("warn", "Fit cancelled by user");
      cancelled = true;
    }
    if (simAbortRef.current) {
      simAbortRef.current.abort();
      simAbortRef.current = null;
      simRunIdRef.current += 1;
      setSimulating(false);
      setLog("warn", "Simulation cancelled by user");
      cancelled = true;
    }
    if (!cancelled) {
      setLog("warn", "No fit or simulation is running");
    }
  }, [setLog]);

  const onToggleFitTarget = useCallback((id: FitTargetId, on: boolean) => {
    setSelectedFitTargets(prev => {
      const next = new Set(prev);
      on ? next.add(id) : next.delete(id);
      return next;
    });
  }, []);

  const onToggleStepFit = useCallback((idx: number, on: boolean) => {
    setSteps(prev => prev.map((step, i) => (
      i === idx ? { ...step, selectedForFit: on } : step
    )));
  }, []);

  // 动画播放时, 实时显示对应 step 的 sim 曲线
  const displaySim = animPlaying && fitHistory.length > 0
    ? fitHistory[animIndex]?.sim ?? simCurve
    : simCurve;
  const displayParams = animPlaying && fitHistory.length > 0
    ? fitHistory[animIndex]?.params ?? pvals
    : pvals;

  // ---- 绘图域（clientX → 数据 X）----
  const plotRef = useRef<HTMLDivElement>(null);
  const xDomain = useMemo(() => {
    if (!raw || raw.ivar.length === 0) return [0, 1] as [number, number];
    return [Math.min(...raw.ivar), Math.max(...raw.ivar)];
  }, [raw]);
  const plotMetrics = useRef<{ left: number; right: number; top: number; bottom: number } | null>(null);

  const measurePlotArea = useCallback(() => {
    const root = plotRef.current;
    if (!root) return null;
    const svg = root.querySelector("svg.recharts-surface") as SVGSVGElement | null;
    const clipRect = root.querySelector("clipPath rect") as SVGRectElement | null;
    if (!svg || !clipRect) return null;

    const svgRect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const scaleX = viewBox.width > 0 ? svgRect.width / viewBox.width : 1;
    const scaleY = viewBox.height > 0 ? svgRect.height / viewBox.height : 1;
    const x = Number(clipRect.getAttribute("x") ?? 0);
    const y = Number(clipRect.getAttribute("y") ?? 0);
    const width = Number(clipRect.getAttribute("width") ?? 0);
    const height = Number(clipRect.getAttribute("height") ?? 0);
    if (!Number.isFinite(width) || width <= 0) return null;

    return {
      left: svgRect.left + x * scaleX,
      right: svgRect.left + (x + width) * scaleX,
      top: svgRect.top + y * scaleY,
      bottom: svgRect.top + (y + height) * scaleY,
    };
  }, []);

  // 测量绘图区
  useEffect(() => {
    if (!plotRef.current) return;
    const update = () => {
      const measured = measurePlotArea();
      if (measured) {
        plotMetrics.current = measured;
        return;
      }
      const r = plotRef.current!.getBoundingClientRect();
      plotMetrics.current = {
        left: r.left + MARGIN.left,
        right: r.left + r.width - MARGIN.right,
        top: r.top + MARGIN.top,
        bottom: r.top + r.height - MARGIN.bottom,
      };
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(plotRef.current);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, [xDomain, raw, measurePlotArea]);

  const pixelToDataX = useCallback((clientX: number): number | null => {
    const metrics = measurePlotArea() ?? plotMetrics.current;
    if (!metrics) return null;
    const axisLeft = metrics.left;
    const axisWidth = metrics.right - metrics.left;
    if (axisWidth === 0) return null;
    return xDomain[0] + ((clientX - axisLeft) / axisWidth) * (xDomain[1] - xDomain[0]);
  }, [xDomain, measurePlotArea]);

  // ---- 拖动全局事件 ----
  useEffect(() => {
    if (dragging === null) return;
    const onMove = (e: MouseEvent) => {
      const x = pixelToDataX(e.clientX);
      if (x === null) return;
      if (dragging === "min") {
        setVmin(prev => Math.max(xDomain[0], Math.min(x, vmax - 0.05)));
      } else {
        setVmax(prev => Math.min(xDomain[1], Math.max(x, vmin + 0.05)));
      }
    };
    const onUp = () => setDragging(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, vmin, vmax, pixelToDataX, xDomain]);

  // 决定离鼠标最近的线
  const decideLine = useCallback((dataX: number): null | "min" | "max" => {
    const dMin = Math.abs(dataX - vmin);
    const dMax = Math.abs(dataX - vmax);
    const threshold = (xDomain[1] - xDomain[0]) * 0.03; // 3% domain
    if (Math.min(dMin, dMax) > threshold) return null;
    return dMin < dMax ? "min" : "max";
  }, [vmin, vmax, xDomain]);

  const onOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    const x = pixelToDataX(e.clientX);
    if (x === null) return;
    const line = decideLine(x);
    if (line) {
      setDragging(line);
      e.preventDefault();
    }
  }, [pixelToDataX, decideLine]);

  // 计算 hover 光标样式
  const [hoverCursor, setHoverCursor] = useState("crosshair");
  const onOverlayMouseMove = useCallback((e: React.MouseEvent) => {
    const x = pixelToDataX(e.clientX);
    if (x === null) { setHoverCursor("crosshair"); return; }
    const dMin = Math.abs(x - vmin);
    const dMax = Math.abs(x - vmax);
    const threshold = (xDomain[1] - xDomain[0]) * 0.03;
    setHoverCursor(Math.min(dMin, dMax) < threshold ? "ew-resize" : "crosshair");
  }, [pixelToDataX, vmin, vmax, xDomain]);

  // ---- 加载 CSV: 优先用 Tauri invoke, fallback 用浏览器 file input ----
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadCsvData = useCallback(async (path: string) => {
    const selectedStepIndex = externalSelectedStep?.id
      ? steps.findIndex(step => step.id === externalSelectedStep.id)
      : -1;
    const writeStepIndex = selectedStepIndex >= 0 ? selectedStepIndex : activeStep;
    const activeCurveType = steps[writeStepIndex]?.curveType ?? curveTypeFromExternal(externalSelectedStep?.type);
    const activeBvKind = steps[writeStepIndex]?.bvKind ?? bvKindFromStepId(externalSelectedStep?.id);
    const activeCapType = steps[writeStepIndex]?.capType ?? capTypeFromStepId(externalSelectedStep?.id);
    setLog("info", `Loading CSV: ${path}`);
    const r = await csvLoad(path, { curveType: activeCurveType, bvKind: activeBvKind, capType: activeCapType });
    console.log("[loadCsvData] received", r.ivar.length, "points, path:", path);
    console.log("[loadCsvData] first ivar/dvar:", r.ivar[0], r.dvar[0], r.ivar[r.ivar.length-1], r.dvar[r.dvar.length-1]);
    setLog("success", `Loaded ${r.ivar.length} pts from ${path.split(/[/\\]/).pop()}`);
    setCsvPath(path);
    const a = r.ivar[0], b = r.ivar[r.ivar.length - 1];
    const nextRaw = { ivar: r.ivar, dvar: r.dvar, meta: r.metadata };
    setRaw(nextRaw);
    const metadataVds = Number((r.metadata as any)?.vds_v);
    const metadataVgs = Number((r.metadata as any)?.vgs_v);
    const nextVds = Number.isFinite(metadataVds) ? metadataVds : vds;
    const nextVgs = Number.isFinite(metadataVgs) ? metadataVgs : vgs;
    const nextBvKind = ((r.metadata as any)?.bv_kind as BvKind | undefined) ?? activeBvKind;
    const nextCapType = ((r.metadata as any)?.cap_type as CapType | undefined) ?? activeCapType;
    const nextVdsMax = (activeCurveType === "idvd" || activeCurveType === "bv" || activeCurveType === "cv") && Number.isFinite(b) ? Math.max(Math.abs(b), vdsMax) : vdsMax;

    const [nextVmin, nextVmax] = initialFitRange(r.ivar, activeCurveType, nextBvKind);
    const nextSim = new Array(r.ivar.length).fill(0);
    setVmin(nextVmin);
    setVmax(nextVmax);
    setVds(nextVds);
    setVgs(nextVgs);
    setVdsMax(nextVdsMax);
    setYScaleMode("linear");
    setSidePanelTab("steps");
    setSimCurve(nextSim);
    setFitRMS(null);
    setFitR2(null);
    setFitR2Linear(null);
    setFitHistory([]);
    setAnimIndex(0);
    setAnimPlaying(false);
    if (activeCurveType === "bv") {
      const bvParamNames = nextBvKind === "bvdss"
        ? ["BV", "IBV", "IS", "N"]
        : [nextBvKind === "bvgss_p" ? "BVGSP" : "BVGSN", "IGS0", "VGSLP"];
      setChecked(new Set(bvParamNames.filter(name => !lockedParams.has(name))));
    } else if (activeCurveType === "cv") {
      const cvParamNames = nextCapType === "ciss"
        ? ["CGSO", "CGDO", "CGBO", "TOX"]
        : nextCapType === "coss"
          ? ["CGDO", "MJ", "MJSW", "PB", "PBSW"]
          : ["CGDO", "CGSO", "TOX"];
      setChecked(new Set(cvParamNames.filter(name => !lockedParams.has(name))));
    }
    setSteps(prev => prev.map((step, idx) => idx === writeStepIndex ? {
      ...step,
      curveType: activeCurveType,
      csvPath: path,
      raw: nextRaw,
      simCurve: nextSim,
      vmin: nextVmin,
      vmax: nextVmax,
      vds: nextVds,
      vgs: nextVgs,
      vdsMax: nextVdsMax,
      bvKind: nextBvKind,
      capType: nextCapType,
      status: "loaded",
      rms: null,
      r2Log: null,
      r2Linear: null,
      fitHistory: [],
    } : step));
    if (writeStepIndex !== activeStep) {
      setActiveStep(writeStepIndex);
    }
  }, [activeStep, externalSelectedStep?.id, externalSelectedStep?.type, lockedParams, setLog, steps, vds, vgs, vdsMax]);

  const onLoad = useCallback(async () => {
    setLoading(true);
    try {
      // 优先 Tauri invoke (有 native dialog)
      let csvPath: string | null = null;
      try {
        csvPath = await invoke<string>("open_excel_file");
      } catch {
        csvPath = null;
      }

      // 检查是否拿到的是文件路径而不是误解析的 File 对象
      if (csvPath && typeof csvPath === "string" && csvPath.endsWith(".csv")) {
        await loadCsvData(csvPath);
        return;
      }

      // Fallback: 浏览器模式下直接用 <input type="file"> + 上传到临时后端
      csvPath = await pickCsvInBrowser();
      if (csvPath) await loadCsvData(csvPath);
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : String(e);
      setLog("error", `Load CSV failed: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [loadCsvData, setLog]);

  // 在浏览器里通过 file input + 后端 upload 拿到路径
  const pickCsvInBrowser = useCallback(async (): Promise<string | null> => {
    return new Promise((resolve) => {
      // 创建一个临时 file input
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".csv";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        // 上传到后端临时目录（一个新端点 /csv/upload）
        const form = new FormData();
        form.append("file", file);
        try {
          const res = await fetch("http://127.0.0.1:8765/api/csv/upload", {
            method: "POST",
            body: form,
          });
          if (!res.ok) { alert("上传失败"); return resolve(null); }
          const data = await res.json();
          resolve(data.csv_path);
        } catch (e) {
          alert(`上传失败: ${e}`);
          resolve(null);
        }
      };
      input.click();
    });
  }, []);

  const powerParams = useMemo(() => ({
    ...importedWrapperOverrides,
    active_area_mm2: Math.min(Math.max(Number(activeAreaMm2) || 10.0, 1e-6), 1e6),
    cell_pitch_um: Math.min(Math.max(Number(cellPitchUm) || 2.0, 0.01), 1000),
    rg_ohm: Math.min(Math.max(Number(exportRgOhm) || 1.6, 0), 1e6),
    include_diode: exportIncludeDiode,
  }), [activeAreaMm2, cellPitchUm, exportRgOhm, exportIncludeDiode, importedWrapperOverrides]);

  const fittedStepSummaries = useMemo(() => (
    steps
      .filter(step => step.status === "fitted" || step.status === "loaded" || step.status === "simulated")
      .map(step => ({
        name: step.name,
        curveType: step.curveType,
        bvKind: step.bvKind,
        capType: step.capType,
        vds: step.vds,
        vgs: step.vgs,
        vmin: step.vmin,
        vmax: step.vmax,
        pts: step.raw?.ivar.length ?? 0,
        r2Log: step.r2Log,
        r2Linear: step.r2Linear,
        rms: step.rms,
      }))
  ), [steps]);

  const exportPreview = useMemo(() => {
    const params = Object.entries(pvals)
      .map(([name, value]) => `+${name}=${fmtParam(value)}`)
      .join("\n");
    const unitMultiplier = Math.max(
      (Math.max(Number(activeAreaMm2) || 10.0, 1e-6) * 1e6) /
        Math.max(Number(cellPitchUm) || 2.0, 0.01),
      1.0,
    );
    const stepLines = fittedStepSummaries.length > 0
      ? fittedStepSummaries.map(step => (
        `* Step: ${step.name}, ${step.curveType === "idvd" ? `Vgs=${fmtParam(step.vgs)}V` : step.curveType === "bv" ? `BV=${step.bvKind}` : step.curveType === "cv" ? `CV=${step.capType}` : `Vds=${fmtParam(step.vds)}V`}, range=${fmtParam(step.vmin)}-${fmtParam(step.vmax)}V, pts=${step.pts}` +
        `${step.r2Log != null ? `, R2log=${step.r2Log.toFixed(4)}` : ""}` +
        `${step.r2Linear != null ? `, R2lin=${step.r2Linear.toFixed(4)}` : ""}`
      )).join("\n")
      : "* Step: draft parameter export, no fitted curve summary";
    if (exportFormat === "bsim3") {
      return `* SpiceBuilder Workbench Export\n${stepLines}\n* Format: A (pure BSIM3 .model)\n* NOTICE: Core model only. This file does not include AA/CellPitch scaling,\n* package resistance, or the power-MOS wrapper. External netlists must provide\n* the intended W/L/M scaling when instantiating this model.\n* Parameter count: ${Object.keys(pvals).length}\n\n.MODEL ${exportSubcktName || "BSIM3_core"} NMOS LEVEL=49\n${params}\n.END`;
    }
    const subcktName = exportSubcktName || "MY_MOSFET";
    const capNotice = capWrapper?.enabled
      ? `* CV wrapper: enabled (${capWrapper.mode}), residual Cgs/Cgd/Cds behavioral currents included\n`
      : "";
    const formatCapFunc = (name: "cgs" | "cgd" | "cds") => {
      const table = capWrapper?.[name];
      if (!table || !table.voltage_v.length) return "";
      const pairs = table.voltage_v
        .map((v, idx) => {
          const cPf = table.capacitance_pf[idx] ?? 0;
          return `${fmtParam(v)},${(cPf * 1e-12).toExponential(12)}`;
        })
        .join(",");
      return `.func SB_${name.toUpperCase()}(x) table(x,${pairs})`;
    };
    const capWrapperLines = capWrapper?.enabled ? [
      "* CV residual wrapper: table capacitance values are in Farads",
      "* Residual sources are connected at external package pins to match",
      "* datasheet-style Ciss/Coss/Crss terminal measurements.",
      formatCapFunc("cgs"),
      formatCapFunc("cgd"),
      formatCapFunc("cds"),
      capWrapper.cgs ? "Bcv_cgs G S I={SB_CGS(V(D,S))*ddt(V(G,S))}" : "",
      capWrapper.cgd ? "Bcv_cgd G D I={SB_CGD(V(D,S))*ddt(V(G,D))}" : "",
      capWrapper.cds ? "Bcv_cds D S I={SB_CDS(V(D,S))*ddt(V(D,S))}" : "",
    ].filter(Boolean).join("\n") + "\n" : "";
    return `* SpiceBuilder Workbench Export\n${stepLines}\n* Format: B (subckt wrapper)\n* NOTICE: Complete power MOSFET subcircuit. Use: X1 D G S ${subcktName}\n* Do not instantiate BSIM3_core directly unless your netlist supplies its own\n* W/L/M scaling. AA and CellPitch are baked into the internal M1 multiplier.\n${capNotice}* Parameter count: ${Object.keys(pvals).length}\n* Power: Rg=${fmtParam(exportRgOhm)} AA=${fmtParam(activeAreaMm2)}mm2 Pitch=${fmtParam(cellPitchUm)}um UnitM=${fmtParam(unitMultiplier)}\n\n.SUBCKT ${subcktName} D G S\nM1 D_int G_int S_int S_int BSIM3_core L=1u W=<unit_width> M=${fmtParam(unitMultiplier)}\nRg G G_int ${fmtParam(exportRgOhm)}\nRd_ext D D_int <from RD or override>\nRs_ext S_int S <from RS or override>\n${capWrapperLines}${exportIncludeDiode ? "Dbody S D Dbody_diode\n.MODEL Dbody_diode D (...)" : "* Body diode disabled"}\n.ENDS\n\n.MODEL BSIM3_core NMOS LEVEL=49\n${params}\n.END`;
  }, [activeAreaMm2, capWrapper, cellPitchUm, exportFormat, exportIncludeDiode, exportRgOhm, exportSubcktName, fittedStepSummaries, pvals]);
  const exportPreviewLines = useMemo(() => exportPreview.split("\n"), [exportPreview]);

  const pickExportPath = useCallback(async () => {
    try {
      const defaultName = `${exportSubcktName || "MY_MOSFET"}.lib`;
      const path = await invoke<string>("save_file_dialog", { defaultName });
      if (path) setExportOutputPath(path.endsWith(".lib") ? path : `${path}.lib`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLog("error", `Save path dialog failed: ${message}`);
    }
  }, [exportSubcktName, setLog]);

  const onExportModel = useCallback(async () => {
    if (!exportOutputPath) {
      setExportError("Please choose an output .lib path first.");
      return;
    }
    setExporting(true);
    setExportError(null);
    setExportResult(null);
    const exportRequest = {
        outputPath: exportOutputPath,
        format: exportFormat,
        subcktName: exportSubcktName || "MY_MOSFET",
        modelName: exportFormat === "bsim3" ? (exportSubcktName || "BSIM3_core") : "BSIM3_core",
        params: pvals,
        powerParams,
        capWrapper,
        includeDiode: exportIncludeDiode,
        rgOhm: exportRgOhm,
    } as const;

    try {
      const result = await csvExportModel(exportRequest);
      setExportResult({ path: result.file_path, nBytes: result.n_bytes });
      setLog("success", `Exported SPICE model: ${result.file_path}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isApiEndpointNotFound(e, "/api/csv/export_model")) {
        const restartHint = "Export endpoint is missing in the running backend. Restarting Python backend and retrying once...";
        setExportError(restartHint);
        setLog("warn", restartHint);
        try {
          await stopBackend();
          const restarted = await startBackend();
          if (!restarted) {
            throw new Error("Python backend restart returned false");
          }
          setLog("info", "Python backend restarted. Retrying SPICE export...");
          const retryResult = await csvExportModel(exportRequest);
          setExportResult({ path: retryResult.file_path, nBytes: retryResult.n_bytes });
          setExportError(null);
          setLog("success", `Exported SPICE model after backend restart: ${retryResult.file_path}`);
          return;
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
          const finalMessage = `Export SPICE failed after backend restart: ${retryMessage}. If this is still 404 Not Found, close the app completely and reopen it so port 8765 is not held by an old backend process.`;
          setExportError(finalMessage);
          setLog("error", finalMessage);
          return;
        }
      }
      setExportError(message);
      setLog("error", `Export SPICE failed: ${message}`);
    } finally {
      setExporting(false);
    }
  }, [capWrapper, exportFormat, exportIncludeDiode, exportOutputPath, exportRgOhm, exportSubcktName, powerParams, pvals, setLog]);

  // ---- 实时 LTspice 仿真（防抖 300ms）----
  const doSim = useCallback(async (
    params: Record<string, number>,
    powerOverride?: typeof powerParams,
  ) => {
    if (!csvPath) return;
    const activeCurveType = steps[activeStep]?.curveType ?? "idvg";
    simAbortRef.current?.abort();
    const abort = new AbortController();
    const runId = simRunIdRef.current + 1;
    simRunIdRef.current = runId;
    simAbortRef.current = abort;
    setSimulating(true);
    try {
      const r = await csvSimulate(csvPath, {
        curveType: activeCurveType,
        bvKind: steps[activeStep]?.bvKind ?? "bvdss",
        capType: steps[activeStep]?.capType ?? "ciss",
        paramOverrides: params,
        vds,
        vgs_v: vgs,
        vds_max: vdsMax,
        powerParams: powerOverride ?? powerParams,
        capWrapper,
        signal: abort.signal,
      });
      if (abort.signal.aborted || runId !== simRunIdRef.current) return;
      setSimCurve(r.sim);
      setSteps(prev => prev.map((step, idx) => idx === activeStep ? {
        ...step,
        simCurve: r.sim,
        status: step.status === "fitted" ? "fitted" : "simulated",
      } : step));
    } catch (e) {
      if (e && typeof e === "object" && "name" in e && e.name === "AbortError") {
        setLog("warn", "Simulation cancelled by user");
      } else {
        console.error("simulate failed:", e);
      }
    } finally {
      if (runId === simRunIdRef.current) {
        simAbortRef.current = null;
        setSimulating(false);
      }
    }
  }, [activeStep, capWrapper, csvPath, vds, vgs, vdsMax, powerParams, setLog, steps]);

  // 参数变化 -> 防抖刷新 sim
  const [simulating, setSimulating] = useState(false);
  const onParamChange = useCallback((name: string, value: number) => {
    setPvals(prev => ({ ...prev, [name]: value }));
    pendingRef.current = { ...pendingRef.current, [name]: value };
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void doSim({ ...pvals, ...pendingRef.current });
      pendingRef.current = {};
    }, 300);
  }, [doSim, pvals]);

  const onCheck = useCallback((name: string, on: boolean) => {
    if (lockedParams.has(name)) return;
    setChecked(prev => {
      const n = new Set(prev);
      on ? n.add(name) : n.delete(name);
      return n;
    });
  }, [lockedParams]);

  const onToggleLock = useCallback((name: string) => {
    setLockedParams(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
        setChecked(old => {
          const n = new Set(old);
          n.delete(name);
          return n;
        });
      }
      return next;
    });
  }, []);

  const fitParamNames = useMemo(() => (
    Array.from(checked).filter(name => !lockedParams.has(name))
  ), [checked, lockedParams]);

  const lockParamsAfterFit = useCallback((names: string[]) => {
    if (names.length === 0) return;
    setLockedParams(prev => {
      const next = new Set(prev);
      names.forEach(name => next.add(name));
      return next;
    });
    setChecked(prev => {
      const next = new Set(prev);
      names.forEach(name => next.delete(name));
      return next;
    });
  }, []);

  const selectedFitStepIdSet = useMemo(() => {
    if (!selectedFitStepIds) return null;
    return selectedFitStepIds instanceof Set
      ? selectedFitStepIds
      : new Set(selectedFitStepIds);
  }, [selectedFitStepIds]);

  const isStepSelectedForFit = useCallback((step: TransferStep): boolean => {
    return selectedFitStepIdSet ? selectedFitStepIdSet.has(step.id) : step.selectedForFit;
  }, [selectedFitStepIdSet]);

  const applyActiveFitHistory = useCallback((history: FitHistoryPoint[]) => {
    setFitHistory(history);
    setSteps(prev => prev.map((step, idx) => (
      idx === activeStep ? { ...step, fitHistory: history } : step
    )));
  }, [activeStep]);

  const onReset = useCallback((name: string) => {
    const spec = BSIM3_PARAMS.find(p => p.name === name);
    if (!spec) return;
    onParamChange(name, spec.default);
  }, [onParamChange]);

  const onResetCat = useCallback((cat: string) => {
    const catP = BSIM3_PARAMS.filter(p => p.category === cat);
    const next = { ...pvals };
    catP.forEach(p => { next[p.name] = p.default; });
    setPvals(next);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    void doSim(next);
  }, [pvals, doSim]);

  const onImportSpiceParams = useCallback(async () => {
    setImportingParams(true);
    try {
      const path = await invoke<string>("open_spice_model_file");
      const text = await invoke<string>("read_text_file", { path });
      const parsed = parseSpiceParams(text, cellPitchUm);
      const importedNames = Object.keys(parsed.params);
      if (importedNames.length === 0) {
        setLog("warn", `No supported BSIM parameters found in ${path.split(/[/\\]/).pop() || path}`);
        return;
      }
      const next = { ...pvals, ...parsed.params };
      const nextArea = parsed.wrapper.activeAreaMm2;
      const nextPitch = parsed.wrapper.cellPitchUm;
      const nextRg = parsed.wrapper.rgOhm;
      const nextIncludeDiode = parsed.wrapper.includeDiode;

      const nextPowerParams = {
        active_area_mm2: Math.min(Math.max(Number(nextArea ?? activeAreaMm2) || 10.0, 1e-6), 1e6),
        cell_pitch_um: Math.min(Math.max(Number(nextPitch ?? cellPitchUm) || 2.0, 0.01), 1000),
        rg_ohm: Math.min(Math.max(Number(nextRg ?? exportRgOhm) || 1.6, 0), 1e6),
        include_diode: nextIncludeDiode ?? exportIncludeDiode,
        ...(parsed.wrapper.rdExtOhm !== undefined ? { rd_ext_ohm: parsed.wrapper.rdExtOhm } : {}),
        ...(parsed.wrapper.rsExtOhm !== undefined ? { rs_ext_ohm: parsed.wrapper.rsExtOhm } : {}),
        ...(parsed.wrapper.rdriftOhm !== undefined ? { rdrift_ohm: parsed.wrapper.rdriftOhm } : {}),
        ...(parsed.wrapper.rjfetOhm !== undefined ? { rjfet_ohm: parsed.wrapper.rjfetOhm } : {}),
      };

      setPvals(next);
      setImportedWrapperOverrides({
        ...(parsed.wrapper.rdExtOhm !== undefined ? { rd_ext_ohm: parsed.wrapper.rdExtOhm } : {}),
        ...(parsed.wrapper.rsExtOhm !== undefined ? { rs_ext_ohm: parsed.wrapper.rsExtOhm } : {}),
        ...(parsed.wrapper.rdriftOhm !== undefined ? { rdrift_ohm: parsed.wrapper.rdriftOhm } : {}),
        ...(parsed.wrapper.rjfetOhm !== undefined ? { rjfet_ohm: parsed.wrapper.rjfetOhm } : {}),
      });
      if (nextArea !== undefined) setActiveAreaMm2(nextPowerParams.active_area_mm2);
      if (nextPitch !== undefined) setCellPitchUm(nextPowerParams.cell_pitch_um);
      if (nextRg !== undefined) setExportRgOhm(nextPowerParams.rg_ohm);
      if (nextIncludeDiode !== undefined) setExportIncludeDiode(nextPowerParams.include_diode);
      pendingRef.current = {};
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      void doSim(next, nextPowerParams);
      const skippedText = parsed.unknown.length > 0 ? `, skipped ${parsed.unknown.length} unknown tokens` : "";
      const invalidText = parsed.invalid.length > 0 ? `, ignored ${parsed.invalid.length} invalid values` : "";
      const wrapperNotes = [
        nextArea !== undefined ? `AA=${fmtParam(nextPowerParams.active_area_mm2)}mm²${parsed.wrapper.inferredFromM1 ? " inferred" : ""}` : null,
        nextPitch !== undefined ? `Pitch=${fmtParam(nextPowerParams.cell_pitch_um)}µm` : null,
        nextRg !== undefined ? `Rg=${fmtParam(nextPowerParams.rg_ohm)}Ω` : null,
        parsed.wrapper.rdExtOhm !== undefined ? `Rd_ext=${fmtParam(parsed.wrapper.rdExtOhm)}Ω` : null,
        parsed.wrapper.rsExtOhm !== undefined ? `Rs_ext=${fmtParam(parsed.wrapper.rsExtOhm)}Ω` : null,
        parsed.wrapper.rdriftOhm !== undefined ? `Rdrift=${fmtParam(parsed.wrapper.rdriftOhm)}Ω` : null,
        parsed.wrapper.rjfetOhm !== undefined ? `Rjfet=${fmtParam(parsed.wrapper.rjfetOhm)}Ω` : null,
        nextIncludeDiode !== undefined ? `Diode=${nextPowerParams.include_diode ? "on" : "off"}` : null,
        parsed.wrapper.unitMultiplier !== undefined ? `M=${fmtParam(parsed.wrapper.unitMultiplier)}` : null,
      ].filter(Boolean).join(", ");
      const wrapperText = wrapperNotes ? `, wrapper: ${wrapperNotes}` : "";
      setLog("success", `Imported ${importedNames.length} BSIM params from ${path.split(/[/\\]/).pop() || path}${wrapperText}${skippedText}${invalidText}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/no file selected/i.test(message)) return;
      setLog("error", `Import SPICE params failed: ${message}`);
    } finally {
      setImportingParams(false);
    }
  }, [
    activeAreaMm2,
    cellPitchUm,
    doSim,
    exportIncludeDiode,
    exportRgOhm,
    pvals,
    setActiveAreaMm2,
    setCellPitchUm,
    setLog,
  ]);

  const parseBound = useCallback((rawValue: string | undefined, fallback: number): number => {
    if (rawValue === undefined || rawValue.trim() === "" || rawValue.trim() === "-") return fallback;
    const value = Number.parseFloat(rawValue);
    return Number.isFinite(value) ? value : fallback;
  }, []);

  const fitParamBounds = useMemo(() => {
    const out: Record<string, [number, number]> = {};
    for (const name of fitParamNames) {
      const spec = BSIM3_PARAMS.find(p => p.name === name);
      if (!spec) continue;
      const cb = customBounds[name];
      const lo = parseBound(cb?.min, spec.lower);
      const hi = parseBound(cb?.max, spec.upper);
      if (Number.isFinite(lo) && Number.isFinite(hi) && lo < hi) {
        out[name] = [lo, hi];
      }
    }
    return out;
  }, [fitParamNames, customBounds, parseBound]);

  const protectedCurves = useMemo(() => {
    if (!protectPrevious) return [];
    return steps.slice(0, activeStep)
      .filter(step => step.status === "fitted" && step.csvPath && step.raw)
      .map(step => ({
        csvPath: step.csvPath,
        curve_type: step.curveType,
        bv_kind: step.bvKind,
        cap_type: step.capType,
        vds: step.vds,
        vgs_v: step.vgs,
        vds_max: step.vdsMax,
        vmin: step.vmin,
        vmax: step.vmax,
        weight: protectWeight,
      }));
  }, [activeStep, protectPrevious, protectWeight, steps]);

  const fitStopPayload = useMemo(() => ({
    r2_log: Math.min(Math.max(Number(fitStop.r2_log) || 0.99, 0), 0.999999),
    r2_linear: Math.min(Math.max(Number(fitStop.r2_linear) || 0.99, 0), 0.999999),
    ftol: Math.min(Math.max(Number(fitStop.ftol) || 1e-6, 1e-12), 1e-2),
    xtol: Math.min(Math.max(Number(fitStop.xtol) || 1e-6, 1e-12), 1e-2),
    gtol: Math.min(Math.max(Number(fitStop.gtol) || 1e-6, 1e-12), 1e-2),
    max_nfev: Math.min(Math.max(Math.round(Number(fitStop.max_nfev) || 120), 5), 10000),
  }), [fitStop]);

  const updateStopValue = useCallback((key: keyof typeof fitStop, value: number) => {
    setStopPreset("custom");
    setFitStop(prev => ({ ...prev, [key]: value }));
  }, []);

  const applyStopPreset = useCallback((preset: StopPreset) => {
    setStopPreset(preset);
    if (preset !== "custom") {
      const next = STOP_PRESETS[preset];
      setFitStop({
        ftol: next.ftol,
        xtol: next.xtol,
        gtol: next.gtol,
        max_nfev: next.max_nfev,
        r2_log: next.r2_log,
        r2_linear: next.r2_linear,
      });
    }
  }, []);

  // ---- Fit ----
  const onFit = useCallback(async () => {
    setFitting(true);
    setFitRMS(null);
    setFitR2(null);
    setFitR2Linear(null);
    applyActiveFitHistory([]);
    setAnimIndex(0);
    setAnimPlaying(false);
    // 创建 AbortController 用于取消
    const abort = new AbortController();
    fitAbortRef.current = abort;
    let bestPoint: FitHistoryPoint | null = null;
    const isBetterPoint = (next: FitHistoryPoint, best: FitHistoryPoint | null): boolean => {
      if (!best) return true;
      const nextRms = Number.isFinite(next.fit_rms) && next.fit_rms > 0 ? next.fit_rms : Number.POSITIVE_INFINITY;
      const bestRms = Number.isFinite(best.fit_rms) && best.fit_rms > 0 ? best.fit_rms : Number.POSITIVE_INFINITY;
      if (Number.isFinite(nextRms) || Number.isFinite(bestRms)) return nextRms < bestRms;
      return (next.r2_log + next.r2_linear) > (best.r2_log + best.r2_linear);
    };
    const commitPoint = (point: FitHistoryPoint, reason: string) => {
      setSimCurve(point.sim);
      setPvals(prev => ({ ...prev, ...point.params }));
      pendingRef.current = {};
      setFitRMS(point.fit_rms);
      setFitR2(point.r2_log);
      setFitR2Linear(point.r2_linear);
      setSteps(prev => prev.map((step, idx) => idx === activeStep ? {
        ...step,
        csvPath,
        raw,
        simCurve: point.sim,
        vmin,
        vmax,
        vds,
        vgs,
        vdsMax,
        status: "fitted",
        rms: point.fit_rms,
        r2Log: point.r2_log,
        r2Linear: point.r2_linear,
        fitHistory: step.fitHistory,
        fittedParams: point.params,
      } : step));
      lockParamsAfterFit(Object.keys(point.params));
      setLog("success", `${reason}: saved current best, RMS=${point.fit_rms.toFixed(4)}, R²(log)=${point.r2_log.toFixed(4)}, R²(linear)=${point.r2_linear.toFixed(4)}`);
    };
    const enrichMetrics = (point: FitHistoryPoint, prev: FitHistoryPoint | undefined): FitHistoryPoint => {
      const fitRms = point.fit_rms > 0 ? point.fit_rms : Math.max(1e-12, 1 - point.r2_log);
      if (!prev) return { ...point, fit_rms: fitRms };
      const prevRms = prev.fit_rms > 0 ? prev.fit_rms : Math.max(1e-12, 1 - prev.r2_log);
      const cost = fitRms * fitRms;
      const prevCost = prevRms * prevRms;
      const keys = Array.from(new Set([...Object.keys(point.params), ...Object.keys(prev.params)]));
      const delta = keys.map(k => (point.params[k] ?? 0) - (prev.params[k] ?? 0));
      const curr = keys.map(k => point.params[k] ?? 0);
      const norm = (arr: number[]) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
      const ftolLocal = Math.abs(prevCost - cost) / Math.max(Math.abs(prevCost), Math.abs(cost), 1e-30);
      const xtolLocal = norm(delta) / (1 + norm(curr));
      const gtolLocal = Math.abs(prevRms - fitRms) / Math.max(Math.abs(prevRms), Math.abs(fitRms), 1e-30);
      return {
        ...point,
        fit_rms: fitRms,
        ftol_metric: point.ftol_metric > 0 ? point.ftol_metric : ftolLocal,
        xtol_metric: point.xtol_metric > 0 ? point.xtol_metric : xtolLocal,
        gtol_metric: point.gtol_metric > 0 ? point.gtol_metric : gtolLocal,
      };
    };
    let committedEarlyStop = false;
    try {
      const params = fitParamNames;
      const activeCurveType = steps[activeStep]?.curveType ?? "idvg";
      const activeTargetId: FitTargetId = targetIdForCurve(activeCurveType);
      if (!csvPath || !raw) {
        setFitting(false);
        return;
      }
      if (!selectedFitTargets.has(activeTargetId)) {
        setLog("warn", `${activeCurveType === "idvd" ? "IdVd / Output" : activeCurveType === "bv" ? "BV / Leakage" : activeCurveType === "cv" ? "CV / Capacitance" : "IdVg / Transfer"} 未勾选，无法执行当前 step 拟合。`);
        setFitting(false);
        return;
      }
      if (!isStepSelectedForFit(steps[activeStep])) {
        setLog("warn", "当前 step 未勾选，不会参与拟合。请先在左侧 tree 勾选该 step。");
        setFitting(false);
        return;
      }
      if (activeCurveType === "cv") {
        const saved = currentStepPatch();
        const materialized = steps.map((step, idx) => idx === activeStep ? saved : step);
        const cvSteps = materialized
          .map((step, idx) => ({ step, idx }))
          .filter(({ step }) => step.curveType === "cv" && step.csvPath && step.raw);
        if (cvSteps.length === 0) {
          setLog("warn", "CV wrapper fit needs at least one loaded CV step.");
          setFitting(false);
          return;
        }
        setLog("info", `CV wrapper fit start: ${cvSteps.map(({ step }) => step.capType).join(", ")}, AA=${powerParams.active_area_mm2}mm², pitch=${powerParams.cell_pitch_um}µm`);
        setSimulating(true);
        const result = await csvCvWrapperFit({
          curves: cvSteps.map(({ step }) => ({
            csvPath: step.csvPath,
            capType: step.capType,
            weight: 1.0,
          })),
          params: pvals,
          powerParams,
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        setCapWrapper(result.cap_wrapper);
        const byCap = new Map(result.curves.map(curve => [curve.cap_type, curve]));
        const nextSteps = materialized.map((step) => {
          if (step.curveType !== "cv") return step;
          const curve = byCap.get(step.capType);
          if (!curve) return step;
          return {
            ...step,
            simCurve: curve.sim,
            status: "fitted" as const,
            r2Log: curve.r2_log,
            r2Linear: curve.r2_linear,
            rms: null,
            fitHistory: [{
              step: 1,
              params: {},
              sim: curve.sim,
              r2_linear: curve.r2_linear,
              r2_log: curve.r2_log,
              ftol_metric: 0,
              xtol_metric: 0,
              gtol_metric: 0,
              fit_rms: Math.max(0, 1 - curve.r2_linear),
            }],
          };
        });
        setSteps(nextSteps);
        const activeCurve = byCap.get(saved.capType);
        if (activeCurve) {
          setSimCurve(activeCurve.sim);
          setFitR2(activeCurve.r2_log);
          setFitR2Linear(activeCurve.r2_linear);
          setFitRMS(Math.max(0, 1 - activeCurve.r2_linear));
          setFitHistory([{
            step: 1,
            params: {},
            sim: activeCurve.sim,
            r2_linear: activeCurve.r2_linear,
            r2_log: activeCurve.r2_log,
            ftol_metric: 0,
            xtol_metric: 0,
            gtol_metric: 0,
            fit_rms: Math.max(0, 1 - activeCurve.r2_linear),
          }]);
        }
        const warningText = result.warnings.length > 0 ? `; warnings=${result.warnings.join(" | ")}` : "";
        const perCurve = result.curves.map(curve => `${curve.cap_type}: R²lin=${curve.r2_linear.toFixed(4)}`).join(", ");
        setLog("success", `CV wrapper fit done: ${perCurve}${warningText}`);
        return;
      }
      if (params.length === 0) {
        setLog("warn", "没有可拟合参数：已勾选的参数都被锁住了，请先解锁或重新勾选参数。");
        setFitting(false);
        return;
      }
      const protectText = protectedCurves.length > 0 ? `, protect=${protectedCurves.length} step(s), weight=${protectWeight}` : "";
      const biasText = activeCurveType === "idvd" ? `Vgs=${vgs}V` : activeCurveType === "bv" ? `BV=${steps[activeStep]?.bvKind ?? "bvdss"}` : `Vds=${vds}V`;
      setLog("info", `Fit start: ${biasText}, range [${vmin.toFixed(2)}, ${vmax.toFixed(2)}] V${protectText}, AA=${powerParams.active_area_mm2}mm², pitch=${powerParams.cell_pitch_um}µm, stop=R²log:${fitStopPayload.r2_log.toFixed(3)}, R²lin:${fitStopPayload.r2_linear.toFixed(3)}, ftol:${fmtTol(fitStopPayload.ftol)}, xtol:${fmtTol(fitStopPayload.xtol)}, gtol:${fmtTol(fitStopPayload.gtol)}, max_nfev:${fitStopPayload.max_nfev}, params=${params.join(",")}`);
      setSimulating(true);
      let stepCount = 0;
      const streamedHistory: FitHistoryPoint[] = [];
      let lastBoundEventCount = 0;
      for await (const ev of csvFitStream({
        csvPath,
        curveType: activeCurveType,
        bvKind: steps[activeStep]?.bvKind ?? "bvdss",
        capType: steps[activeStep]?.capType ?? "ciss",
        paramNames: params,
        paramBounds: fitParamBounds,
        initialParams: pvals,
        protectCurves: protectedCurves,
        vmin, vmax, vds, vgs_v: vgs, vds_max: vdsMax, historyInterval: 1,
        stop: fitStopPayload,
        powerParams,
        signal: abort.signal,
      })) {
          if (ev.kind === "step" && ev.sim && ev.params) {
            stepCount++;
            const point = enrichMetrics({
              step: ev.step,
              params: ev.params,
              sim: ev.sim as number[],
              r2_linear: ev.r2_linear ?? ev.r2 ?? 0,
              r2_log: ev.r2_log ?? 0,
              ftol_metric: ev.ftol_metric ?? 0,
              xtol_metric: ev.xtol_metric ?? 0,
              gtol_metric: ev.gtol_metric ?? 0,
              fit_rms: ev.fit_rms ?? 0,
              bound_events: ev.bound_events ?? [],
            }, streamedHistory[streamedHistory.length - 1]);
            if (isBetterPoint(point, bestPoint)) bestPoint = point;
            streamedHistory.push(point);
            applyActiveFitHistory([...streamedHistory]);
            setSimCurve(point.sim);
            setPvals(prev => ({ ...prev, ...ev.params }));
            const eventCount = point.bound_events?.length ?? 0;
            if (eventCount > lastBoundEventCount) {
              const latest = point.bound_events?.slice(lastBoundEventCount) ?? [];
              const summary = latest
                .map(e => `${String(e.param)}:${String(e.side)}`)
                .join(", ");
              setLog("warn", `Bounds hit: ${summary}`);
              lastBoundEventCount = eventCount;
            }
            if (point.r2_log >= fitStopPayload.r2_log && point.r2_linear >= fitStopPayload.r2_linear) {
              commitPoint(point, "R² stop reached");
              committedEarlyStop = true;
              abort.abort();
              break;
            }
          } else if (ev.kind === "final" || (ev.fitted_params && ev.ivar)) {
            const r2Log = ev.r2_log ?? ev.r2 ?? null;
            if (ev.sim && ev.fitted_params) {
              const finalPoint = {
                step: ev.step ?? -1,
                params: ev.fitted_params,
                sim: ev.sim,
                r2_linear: ev.r2_linear ?? ev.r2 ?? 0,
                r2_log: ev.r2_log ?? ev.r2 ?? 0,
                ftol_metric: ev.ftol_metric ?? streamedHistory[streamedHistory.length - 1]?.ftol_metric ?? 0,
                xtol_metric: ev.xtol_metric ?? streamedHistory[streamedHistory.length - 1]?.xtol_metric ?? 0,
                gtol_metric: ev.gtol_metric ?? streamedHistory[streamedHistory.length - 1]?.gtol_metric ?? 0,
                fit_rms: ev.fit_rms ?? ev.rms ?? 0,
                bound_events: ev.bound_events ?? [],
              };
              if (streamedHistory.length === 0 || streamedHistory[streamedHistory.length - 1].sim !== finalPoint.sim) {
                streamedHistory.push(finalPoint);
                applyActiveFitHistory([...streamedHistory]);
              }
              if (isBetterPoint(finalPoint, bestPoint)) bestPoint = finalPoint;
            }
            setSimCurve(ev.sim!);
            setPvals(prev => ({ ...prev, ...ev.fitted_params! }));
            setFitRMS(ev.rms ?? null);
            setFitR2(r2Log);
            setFitR2Linear(ev.r2_linear ?? null);
            setSteps(prev => prev.map((step, idx) => idx === activeStep ? {
              ...step,
              csvPath,
              raw,
              simCurve: ev.sim ?? step.simCurve,
              vmin,
              vmax,
              vds,
              vgs,
              vdsMax,
              status: "fitted",
              rms: ev.rms ?? null,
              r2Log,
              r2Linear: ev.r2_linear ?? null,
              fitHistory: streamedHistory,
              fittedParams: ev.fitted_params,
            } : step));
            if (ev.success !== false) lockParamsAfterFit(params);
            if ((ev.bound_events?.length ?? 0) > lastBoundEventCount) {
              const latest = ev.bound_events?.slice(lastBoundEventCount) ?? [];
              const summary = latest
                .map(e => `${String(e.param)}:${String(e.side)}`)
                .join(", ");
              setLog("warn", `Bounds hit: ${summary}`);
            }
            const stopReason = ev.optimizer_message ? `, stop="${ev.optimizer_message}"` : "";
            const evalText = ev.nfev ? `, nfev=${ev.nfev}` : "";
            const logLevel = ev.success === false ? "warn" : "success";
            setLog(logLevel, `Fit done: ${stepCount} steps${evalText}, RMS=${ev.rms?.toFixed(4)}, R²(log)=${r2Log?.toFixed(4)}, R²(linear)=${ev.r2_linear?.toFixed(4)}${stopReason}`);
          } else if (ev.kind === "error") {
            throw new Error(ev.error);
          }
        }
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'name' in e && e.name === "AbortError") {
        if (committedEarlyStop) {
          // Already saved the R²-qualified point.
        } else if (bestPoint) {
          commitPoint(bestPoint, "Fit stopped by user");
        } else {
          setLog("info", "Fit aborted");
        }
      } else {
        console.error("fit failed:", e);
        const message = e instanceof Error ? e.message : String(e);
        setLog("error", `Fit failed: ${message}`);
      }
    } finally {
      fitAbortRef.current = null;
      setSimulating(false);
      setFitting(false);
    }
  }, [activeStep, csvPath, raw, fitParamNames, fitParamBounds, protectedCurves, protectWeight, fitStopPayload, powerParams, pvals, selectedFitTargets, steps, vmin, vmax, vds, vgs, vdsMax, setLog, applyActiveFitHistory, lockParamsAfterFit, isStepSelectedForFit, currentStepPatch]);

  const onJointFit = useCallback(async () => {
    const saved = currentStepPatch();
    const materialized = steps.map((step, idx) => idx === activeStep ? saved : step);
    const loadedSteps = materialized
      .map((step, idx) => ({ step, idx }))
      .filter(({ step }) => (
        isStepSelectedForFit(step) &&
        selectedFitTargets.has(targetIdForCurve(step.curveType)) &&
        step.csvPath &&
        step.raw
      ));

    if (loadedSteps.length < 2) {
      setLog("warn", "Joint fit needs at least 2 checked and loaded steps");
      return;
    }

    if (loadedSteps.every(({ step }) => step.curveType === "cv")) {
      setFitting(true);
      applyActiveFitHistory([]);
      setAnimIndex(0);
      setAnimPlaying(false);
      setSimulating(true);

      const abort = new AbortController();
      fitAbortRef.current = abort;
      try {
        setLog("info", `CV wrapper fit start: ${loadedSteps.map(({ step }) => step.capType).join(", ")}, AA=${powerParams.active_area_mm2}mm², pitch=${powerParams.cell_pitch_um}µm`);
        const result = await csvCvWrapperFit({
          curves: loadedSteps.map(({ step }) => ({
            csvPath: step.csvPath,
            capType: step.capType,
            weight: 1.0,
          })),
          params: pvals,
          powerParams,
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        setCapWrapper(result.cap_wrapper);
        const byCap = new Map(result.curves.map(curve => [curve.cap_type, curve]));
        const nextSteps = materialized.map((step) => {
          if (step.curveType !== "cv") return step;
          const curve = byCap.get(step.capType);
          if (!curve) return step;
          return {
            ...step,
            simCurve: curve.sim,
            status: "fitted" as const,
            r2Log: curve.r2_log,
            r2Linear: curve.r2_linear,
            rms: null,
            fitHistory: [{
              step: 1,
              params: {},
              sim: curve.sim,
              r2_linear: curve.r2_linear,
              r2_log: curve.r2_log,
              ftol_metric: 0,
              xtol_metric: 0,
              gtol_metric: 0,
              fit_rms: Math.max(0, 1 - curve.r2_linear),
            }],
          };
        });
        setSteps(nextSteps);
        const activeCapType = materialized[activeStep]?.capType ?? saved.capType;
        const activeCurve = byCap.get(activeCapType);
        if (activeCurve) {
          setSimCurve(activeCurve.sim);
          setFitR2(activeCurve.r2_log);
          setFitR2Linear(activeCurve.r2_linear);
          setFitRMS(Math.max(0, 1 - activeCurve.r2_linear));
          setFitHistory([{
            step: 1,
            params: {},
            sim: activeCurve.sim,
            r2_linear: activeCurve.r2_linear,
            r2_log: activeCurve.r2_log,
            ftol_metric: 0,
            xtol_metric: 0,
            gtol_metric: 0,
            fit_rms: Math.max(0, 1 - activeCurve.r2_linear),
          }]);
        }
        const warningText = result.warnings.length > 0 ? `; warnings=${result.warnings.join(" | ")}` : "";
        const perCurve = result.curves.map(curve => `${curve.cap_type}: R²lin=${curve.r2_linear.toFixed(4)}`).join(", ");
        setLog("success", `CV wrapper fit done: ${perCurve}${warningText}`);
      } catch (e) {
        if (abort.signal.aborted) {
          setLog("warn", "CV wrapper fit cancelled.");
        } else {
          const message = e instanceof Error ? e.message : String(e);
          setLog("error", `CV wrapper fit failed: ${message}`);
        }
      } finally {
        fitAbortRef.current = null;
        setSimulating(false);
        setFitting(false);
      }
      return;
    }

    const params = fitParamNames;
    if (params.length === 0) {
      setLog("warn", "没有可拟合参数：已勾选的参数都被锁住了，请先解锁或重新勾选参数。");
      return;
    }

    setFitting(true);
    applyActiveFitHistory([]);
    setAnimIndex(0);
    setAnimPlaying(false);
    setSimulating(true);

    const abort = new AbortController();
    fitAbortRef.current = abort;
    const enrichJointMetrics = (point: FitHistoryPoint, prev: FitHistoryPoint | undefined): FitHistoryPoint => {
      const fitRms = point.fit_rms > 0 ? point.fit_rms : Math.max(1e-12, 1 - point.r2_log);
      if (!prev) return { ...point, fit_rms: fitRms };
      const prevRms = prev.fit_rms > 0 ? prev.fit_rms : Math.max(1e-12, 1 - prev.r2_log);
      const cost = fitRms * fitRms;
      const prevCost = prevRms * prevRms;
      const keys = Array.from(new Set([...Object.keys(point.params), ...Object.keys(prev.params)]));
      const delta = keys.map(k => (point.params[k] ?? 0) - (prev.params[k] ?? 0));
      const curr = keys.map(k => point.params[k] ?? 0);
      const norm = (arr: number[]) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
      const ftolLocal = Math.abs(prevCost - cost) / Math.max(Math.abs(prevCost), Math.abs(cost), 1e-30);
      const xtolLocal = norm(delta) / (1 + norm(curr));
      const gtolLocal = Math.abs(prevRms - fitRms) / Math.max(Math.abs(prevRms), Math.abs(fitRms), 1e-30);
      return {
        ...point,
        fit_rms: fitRms,
        ftol_metric: point.ftol_metric > 0 ? point.ftol_metric : ftolLocal,
        xtol_metric: point.xtol_metric > 0 ? point.xtol_metric : xtolLocal,
        gtol_metric: point.gtol_metric > 0 ? point.gtol_metric : gtolLocal,
      };
    };

    try {
      const loadedStepIndexes = new Set(loadedSteps.map(item => item.idx));
      const preparedSteps = materialized.map((step, idx) => (
        loadedStepIndexes.has(idx) ? { ...step, fitHistory: [] } : step
      ));
      setSteps(preparedSteps);
      const curveText = loadedSteps
        .map(({ step }, i) => {
          const bias = step.curveType === "idvd" ? `Vgs=${step.vgs}V` : step.curveType === "bv" ? `BV=${step.bvKind}` : step.curveType === "cv" ? `CV=${step.capType}` : `Vds=${step.vds}V`;
          return `Step${i + 1}:${step.curveType.toUpperCase()},${bias},[${step.vmin.toFixed(2)},${step.vmax.toFixed(2)}]`;
        })
        .join("; ");
      setLog("info", `Joint fit start: ${loadedSteps.length} steps, ${curveText}, params=${params.join(",")}`);

      let stepCount = 0;
      let lastBoundEventCount = 0;
      let currentSteps = preparedSteps;
      const historiesByStep = new Map<number, FitHistoryPoint[]>();
      loadedSteps.forEach(({ idx }) => historiesByStep.set(idx, []));

      for await (const ev of csvDualFitStream({
        curves: loadedSteps.map(({ step }) => ({
          csvPath: step.csvPath,
          curveType: step.curveType,
          bvKind: step.bvKind,
          capType: step.capType,
          vds: step.vds,
          vgs_v: step.vgs,
          vds_max: step.vdsMax,
          vmin: step.vmin,
          vmax: step.vmax,
          weight: 1.0,
        })),
        paramNames: params,
        paramBounds: fitParamBounds,
        initialParams: pvals,
        historyInterval: 1,
        powerParams,
        stop: fitStopPayload,
        signal: abort.signal,
      })) {
        if (ev.kind === "step" && ev.curves && ev.params) {
          stepCount++;
          setPvals(prev => ({ ...prev, ...ev.params }));
          pendingRef.current = {};

          ev.curves.forEach(curve => {
            const stepIdx = loadedSteps[curve.index]?.idx;
            if (stepIdx === undefined) return;
            const prevHistory = historiesByStep.get(stepIdx) ?? [];
            const point = enrichJointMetrics({
              step: ev.step,
              params: ev.params!,
              sim: curve.sim,
              r2_linear: curve.r2_linear,
              r2_log: curve.r2_log,
              ftol_metric: ev.ftol_metric ?? 0,
              xtol_metric: ev.xtol_metric ?? 0,
              gtol_metric: ev.gtol_metric ?? 0,
              fit_rms: ev.fit_rms ?? 0,
              bound_events: ev.bound_events ?? [],
            }, prevHistory[prevHistory.length - 1]);
            historiesByStep.set(stepIdx, [...prevHistory, point]);
          });

          const nextSteps = currentSteps.map((step, idx) => {
            const loadedIdx = loadedSteps.findIndex(item => item.idx === idx);
            const curve = loadedIdx >= 0 ? ev.curves?.find(c => c.index === loadedIdx) : undefined;
            if (!curve) return step;
            return {
              ...step,
              simCurve: curve.sim,
              status: "simulated" as const,
              rms: ev.fit_rms ?? step.rms,
              r2Log: curve.r2_log,
              r2Linear: curve.r2_linear,
              fitHistory: historiesByStep.get(idx) ?? step.fitHistory,
            };
          });
          currentSteps = nextSteps;
          setSteps(nextSteps);

          const activeLoadedIdx = loadedSteps.findIndex(item => item.idx === activeStep);
          const activeCurve = activeLoadedIdx >= 0 ? ev.curves.find(c => c.index === activeLoadedIdx) : undefined;
          if (activeCurve) {
            const activeHistory = historiesByStep.get(activeStep) ?? [];
            setFitHistory(activeHistory);
            setSimCurve(activeCurve.sim);
            setFitRMS(activeHistory[activeHistory.length - 1]?.fit_rms ?? ev.fit_rms ?? null);
            setFitR2(activeCurve.r2_log);
            setFitR2Linear(activeCurve.r2_linear);
          }

          const eventCount = ev.bound_events?.length ?? 0;
          if (eventCount > lastBoundEventCount) {
            const latest = ev.bound_events?.slice(lastBoundEventCount) ?? [];
            const summary = latest.map(e => `${String(e.param)}:${String(e.side)}`).join(", ");
            setLog("warn", `Bounds hit: ${summary}`);
            lastBoundEventCount = eventCount;
          }
        } else if (ev.kind === "final" && ev.curves && ev.fitted_params) {
          const fittedParams = ev.fitted_params;
          setPvals(prev => ({ ...prev, ...fittedParams }));
          pendingRef.current = {};

          const nextSteps = currentSteps.map((step, idx) => {
            const loadedIdx = loadedSteps.findIndex(item => item.idx === idx);
            const curve = loadedIdx >= 0 ? ev.curves?.find(c => c.index === loadedIdx) : undefined;
            if (!curve) return step;
            return {
              ...step,
              simCurve: curve.sim,
              status: "fitted" as const,
              rms: ev.rms ?? null,
              r2Log: curve.r2_log,
              r2Linear: curve.r2_linear,
              fitHistory: historiesByStep.get(idx) ?? step.fitHistory,
              fittedParams,
            };
          });
          currentSteps = nextSteps;
          setSteps(nextSteps);

          const activeLoadedIdx = loadedSteps.findIndex(item => item.idx === activeStep);
          const activeCurve = activeLoadedIdx >= 0 ? ev.curves.find(c => c.index === activeLoadedIdx) : undefined;
          if (activeCurve) {
            setSimCurve(activeCurve.sim);
            setFitRMS(ev.rms ?? null);
            setFitR2(activeCurve.r2_log);
            setFitR2Linear(activeCurve.r2_linear);
          } else {
            setFitRMS(ev.rms ?? null);
            setFitR2(ev.r_squared ?? null);
            setFitR2Linear(ev.r_squared_linear ?? null);
          }
          if (ev.success !== false) lockParamsAfterFit(params);

          const perCurveText = ev.curves
            .map((curve, idx) => `Step${idx + 1}: R²log=${curve.r2_log.toFixed(4)}, R²lin=${curve.r2_linear.toFixed(4)}`)
            .join("; ");
          const stopReason = ev.optimizer_message ? `, stop="${ev.optimizer_message}"` : "";
          const evalText = ev.nfev ? `, nfev=${ev.nfev}` : "";
          setLog(
            ev.success === false ? "warn" : "success",
            `Joint fit done: ${stepCount} steps${evalText}, RMS=${ev.rms?.toFixed(4)}, pooled R²log=${ev.r_squared?.toFixed(4)}, pooled R²lin=${ev.r_squared_linear?.toFixed(4)}${stopReason}; ${perCurveText}`
          );
        } else if (ev.kind === "error") {
          throw new Error(ev.error);
        }
      }
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'name' in e && e.name === "AbortError") {
        setLog("info", "Joint fit aborted");
      } else {
        console.error("joint fit failed:", e);
        const message = e instanceof Error ? e.message : String(e);
        setLog("error", `Joint fit failed: ${message}`);
      }
    } finally {
      fitAbortRef.current = null;
      setSimulating(false);
      setFitting(false);
    }
  }, [activeStep, fitParamNames, currentStepPatch, fitParamBounds, fitStopPayload, pvals, powerParams, selectedFitTargets, setLog, steps, applyActiveFitHistory, lockParamsAfterFit, isStepSelectedForFit]);

  // ---- 图表数据 (动画时显示动画帧的 sim) ----
  const chartData = useMemo(() => {
    if (!raw) return [];
    return raw.ivar
      .map((x, i) => {
        const measRaw = raw.dvar[i];
        const simRaw = displaySim[i];
        return {
          x,
          meas: yScaleMode === "log" ? positiveOrNull(measRaw) : (Number.isFinite(measRaw) ? measRaw : null),
          sim: yScaleMode === "log" ? positiveOrNull(simRaw) : (Number.isFinite(simRaw) ? simRaw : null),
        };
      })
      .filter(d => Number.isFinite(d.x) && (d.meas !== null || d.sim !== null));
  }, [raw, displaySim, yScaleMode]);

  const logYDomain = useMemo(() => {
    const vals = chartData
      .flatMap(d => [d.meas, d.sim])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
    if (vals.length === 0) return [1e-12, 1] as [number, number];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const lo = 10 ** Math.floor(Math.log10(Math.max(min, 1e-30)));
    const hi = 10 ** Math.ceil(Math.log10(Math.max(max, lo * 10)));
    return [lo, hi] as [number, number];
  }, [chartData]);

  const convergenceData = useMemo(() => (
    fitHistory.map((h, idx) => ({
      step: idx + 1,
      r2_log: h.r2_log,
      r2_linear: h.r2_linear,
      ftol_metric: h.ftol_metric > 0 ? h.ftol_metric : 1e-12,
      xtol_metric: h.xtol_metric > 0 ? h.xtol_metric : 1e-12,
      gtol_metric: h.gtol_metric > 0 ? h.gtol_metric : 1e-12,
    }))
  ), [fitHistory]);

  const convergenceRightDomain = useMemo(() => {
    const vals = convergenceData
      .flatMap(d => [d.ftol_metric, d.xtol_metric, d.gtol_metric])
      .filter(v => Number.isFinite(v) && v > 0);
    if (vals.length === 0) return [1e-12, 1] as [number, number];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const lo = 10 ** Math.floor(Math.log10(Math.max(min, 1e-12)));
    const hi = 10 ** Math.ceil(Math.log10(Math.max(max, lo * 10)));
    return [lo, hi] as [number, number];
  }, [convergenceData]);

  const fittedParamRows = useMemo(() => {
    const latest = fitHistory.length > 0 ? fitHistory[fitHistory.length - 1].params : pvals;
    const names = fitHistory.length > 0 ? Object.keys(latest) : Array.from(checked);
    return names.slice(0, 10).map(name => {
      const spec = BSIM3_PARAMS.find(p => p.name === name);
      return {
        name,
        value: latest[name] ?? pvals[name],
        unit: spec?.unit ?? "",
      };
    });
  }, [checked, fitHistory, pvals]);

  const inRange = raw ? raw.ivar.filter(v => v >= vmin && v <= vmax).length : 0;
  const fileName = csvPath.split(/[/\\]/).pop() ?? "";
  const loadedStepCount = useMemo(() => {
    const saved = currentStepPatch();
    return steps.filter((step, idx) => {
      const s = idx === activeStep ? saved : step;
      return Boolean(
        isStepSelectedForFit(s) &&
        selectedFitTargets.has(targetIdForCurve(s.curveType)) &&
        s.csvPath &&
        s.raw
      );
    }).length;
  }, [activeStep, currentStepPatch, steps, isStepSelectedForFit, selectedFitTargets]);
  const fitScopeSummary = useMemo(() => {
    const selected = FIT_TARGET_TEMPLATES.filter(item => selectedFitTargets.has(item.id));
    const count = selected.length;
    const mode = count === 0 ? "No Fit Target" : count === 1 ? "Auto Single Fit" : "Auto Joint Fit";
    return {
      count,
      mode,
      labels: selected.map(item => item.label),
      implementedCount: selected.filter(item => item.implemented).length,
    };
  }, [selectedFitTargets]);

  const runWorkbenchAction = useCallback((action: string) => {
    if (action === "import") {
      void onLoad();
      return;
    }
    if (action === "simulate") {
      void doSim(pvals);
      return;
    }
    if (action === "fit-current") {
      void onFit();
      return;
    }
    if (action === "fit-selected") {
      if (loadedStepCount >= 2) {
        void onJointFit();
      } else {
        void onFit();
      }
      return;
    }
    if (action === "stop") {
      onCancelFit();
      return;
    }
    if (action === "export") {
      setSidePanelTab("export");
      setLog("info", "Switched to Export Model panel.");
      return;
    }
    if (action === "reset-current") {
      for (const name of Array.from(checked)) onReset(name);
      setLog("info", "已重置当前勾选参数。");
      return;
    }
    if (action === "lock-fitted") {
      const fitted = steps.flatMap(step => step.fittedParams ? Object.keys(step.fittedParams) : []);
      if (fitted.length === 0) {
        setLog("warn", "当前还没有可锁定的拟合参数。");
        return;
      }
      lockParamsAfterFit(Array.from(new Set(fitted)));
      setLog("success", `已锁定 ${new Set(fitted).size} 个拟合参数。`);
      return;
    }
    if (action === "about") {
      setLog("info", "SpiceBuilder Workbench: 多电性曲线 SPICE 参数提取工作台。");
    }
  }, [checked, doSim, loadedStepCount, lockParamsAfterFit, onCancelFit, onFit, onJointFit, onLoad, onReset, pvals, setLog, steps]);

  useEffect(() => {
    return addWorkbenchActionListener((action) => {
      runWorkbenchAction(action);
    });
  }, [runWorkbenchAction]);

  const activeCurveType = steps[activeStep]?.curveType ?? "idvg";
  const activeTargetId: FitTargetId = targetIdForCurve(activeCurveType);
  const canWorkbenchSimulate = Boolean(raw && !fitting && !simulating && selectedFitTargets.has(activeTargetId));
  const canWorkbenchFit = Boolean(
    (raw && isStepSelectedForFit(steps[activeStep]) && selectedFitTargets.has(activeTargetId)) ||
    loadedStepCount >= 2
  );
  const workbenchIsRunning = fitting || simulating;
  const targetConfigStep = externalSelectedStep?.id
    ? steps.find(step => step.id === externalSelectedStep.id) ?? steps[activeStep]
    : steps[activeStep];
  const targetConfigFileName = targetConfigStep?.csvPath
    ? targetConfigStep.csvPath.split(/[/\\]/).pop()
    : "";
  const isTargetLoadSupported = !externalSelectedStep?.type || externalSelectedStep.type === "IdVg" || externalSelectedStep.type === "IdVd" || externalSelectedStep.type === "BV" || externalSelectedStep.type === "CV";
  const canLoadTargetCsv = (
    !loading &&
    !workbenchIsRunning &&
    externalSelectedStep?.id !== "power_cell" &&
    externalSelectedStep?.id !== "export_model" &&
    isTargetLoadSupported
  );
  const isExportStepSelected = externalSelectedStep?.id === "export_model";
  const isExportPanelVisible = isExportStepSelected || sidePanelTab === "export";

  useEffect(() => {
    if (isExportStepSelected && sidePanelTab !== "export") {
      setSidePanelTab("export");
      return;
    }
    if (!isExportStepSelected && externalSelectedStep && sidePanelTab === "export") {
      setSidePanelTab("steps");
    }
  }, [externalSelectedStep, isExportStepSelected, sidePanelTab]);

  useEffect(() => {
    dispatchWorkbenchState({
      hasCsv: Boolean(csvPath && raw),
      canFit: Boolean(canWorkbenchFit && !workbenchIsRunning && !loading),
      canSimulate: Boolean(canWorkbenchSimulate && !workbenchIsRunning && !loading),
      fitting,
      simulating,
      loading,
      isRunning: workbenchIsRunning,
      loadedStepCount,
      activeStepName: steps[activeStep]?.name ?? (activeCurveType === "idvd" ? `IdVd @ Vgs=${vgs}V` : activeCurveType === "bv" ? "BV / Leakage" : activeCurveType === "cv" ? "CV / Capacitance" : `IdVg @ Vds=${vds}V`),
    });
  }, [
    activeStep,
    canWorkbenchFit,
    canWorkbenchSimulate,
    csvPath,
    fitting,
    loadedStepCount,
    loading,
    raw,
    simulating,
    steps,
    activeCurveType,
    vgs,
    vds,
    workbenchIsRunning,
  ]);

  useEffect(() => {
    if (!onStepRuntimeChange) return;
    const activeSnapshot = currentStepPatch();
    onStepRuntimeChange(steps.map((step, idx) => {
      const liveStep = idx === activeStep ? activeSnapshot : step;
      return {
        id: liveStep.id,
        status: workbenchIsRunning && idx === activeStep ? "running" : liveStep.status,
        curveType: liveStep.curveType,
        bvKind: liveStep.bvKind,
        csvPath: liveStep.csvPath,
        pts: liveStep.raw?.ivar.length ?? 0,
        vds: liveStep.vds,
        vgs: liveStep.vgs,
        vdsMax: liveStep.vdsMax,
        vmin: liveStep.vmin,
        vmax: liveStep.vmax,
        r2Log: liveStep.r2Log,
        r2Linear: liveStep.r2Linear,
        rms: liveStep.rms,
        capType: liveStep.capType,
      };
    }));
  }, [activeStep, currentStepPatch, onStepRuntimeChange, steps, workbenchIsRunning]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0,
      overflow: "hidden",
      background: WB.pageBg,
    }}>
      <style>{`
        .spice-workbench ::-webkit-scrollbar { width: 6px; height: 6px; }
        .spice-workbench ::-webkit-scrollbar-track { background: transparent; }
        .spice-workbench ::-webkit-scrollbar-thumb { background: ${WB.borderMd}; border-radius: var(--radius-sm); }
      `}</style>
      {!hideChrome && (<>
        <WorkbenchMenuBar onAction={runWorkbenchAction} onLayout={setWorkbenchLayout} />
        <WorkbenchToolbar
          layout={workbenchLayout}
          isRunning={fitting}
          loadedCount={loadedStepCount}
          activeStepName={steps[activeStep]?.name ?? (activeCurveType === "idvd" ? `IdVd @ Vgs=${vgs}V` : activeCurveType === "bv" ? "BV / Leakage" : activeCurveType === "cv" ? "CV / Capacitance" : `IdVg @ Vds=${vds}V`)}
          canImport={!loading && !fitting}
          canSimulate={canWorkbenchSimulate}
          canFit={canWorkbenchFit}
          onLayout={setWorkbenchLayout}
          onAction={runWorkbenchAction}
        />
      </>)}
      <div className="spice-workbench" style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
      {!hideFitTargetsPanel && (
        <div style={{ width: 270, minWidth: 240, borderRight: "1px solid var(--border)", background: WB.panelBg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 700 }}>
            Electrical Targets
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
            {FIT_TARGET_TEMPLATES.map(target => {
              const checkedTarget = selectedFitTargets.has(target.id);
              const expanded = expandedFitTargets.has(target.id);
              return (
                <div key={target.id} style={{ borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                  <div
                    onClick={() => setActiveTreeItem(target.id)}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 2px", background: activeTreeItem === target.id ? WB.primaryLt : "transparent", cursor: "pointer" }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedFitTargets(prev => {
                          const next = new Set(prev);
                          next.has(target.id) ? next.delete(target.id) : next.add(target.id);
                          return next;
                        });
                      }}
                      style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", display: "flex", color: WB.textSm }}
                      title={expanded ? "Collapse" : "Expand"}
                    >
                      <ChevronRight size={13} style={{ transform: expanded ? "rotate(90deg)" : "none" }} />
                    </button>
                    <input
                      type="checkbox"
                      checked={checkedTarget}
                      disabled={!target.implemented}
                      onChange={e => onToggleFitTarget(target.id, e.target.checked)}
                      title={target.implemented ? "参与拟合队列" : "后续版本开放"}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: target.implemented ? WB.text : WB.textXs, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {target.label}
                      </div>
                      <div style={{ fontSize: 10, color: WB.textXs, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {target.hint}
                      </div>
                    </div>
                    <span style={{ fontSize: 9, color: target.implemented ? WB.primary : WB.textXs, border: `1px solid ${target.implemented ? WB.primaryLt : WB.border}`, borderRadius: "var(--radius-sm)", padding: "1px 4px" }}>
                      {target.implemented ? "LIVE" : "NEXT"}
                    </span>
                  </div>
                  {expanded && (
                    <div style={{ padding: "4px 0 0 30px", display: "flex", flexDirection: "column", gap: 4 }}>
                      {target.children.map(child => (
                        <div key={child} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "center", fontSize: 10, color: target.implemented ? WB.textMd : WB.textXs }}>
                          <button
                            type="button"
                            onClick={() => setActiveTreeItem(target.id === "idvg" ? "idvg-step" : target.id)}
                            disabled={!target.implemented}
                            style={{ textAlign: "left", border: 0, background: "transparent", padding: "3px 0", color: "inherit", cursor: target.implemented ? "pointer" : "default", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          >
                            {child}
                          </button>
                          <span>{target.id === "idvg" ? `${loadedStepCount} loaded` : "config"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ borderTop: "1px solid var(--border)", padding: 10, fontSize: 10, color: WB.textSm }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span>Mode</span><strong style={{ color: WB.text }}>{fitScopeSummary.mode}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Active targets</span><strong style={{ color: WB.primary }}>{fitScopeSummary.implementedCount}/{fitScopeSummary.count}</strong>
            </div>
          </div>
        </div>
      )}

      {/* ===== 右栏: 曲线图 + 拖动覆盖层 ===== */}
      <div style={{
        order: hideFitTargetsPanel ? 3 : 1,
        flex: 1, minWidth: 360, display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        <div style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          fontWeight: 600, fontSize: 13,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          {isExportPanelVisible ? "SPICE Model Preview" : `Curves Plot · ${steps[activeStep]?.name ?? (activeCurveType === "idvd" ? `IdVd @ Vgs=${vgs}V` : activeCurveType === "bv" ? "BV / Leakage" : activeCurveType === "cv" ? "CV / Capacitance" : `IdVg @ Vds=${vds}V`)}`}
          {dragging && <span style={{ fontSize: 10, color: "var(--primary)" }}>拖动 {dragging === "min" ? "min" : "max"} 线...</span>}
        </div>
        <div ref={chartPaneRef} style={{ flex: 1, minHeight: 400, display: "flex", flexDirection: "column", background: "#fff", overflow: "hidden", position: "relative" }}>
          {isExportPanelVisible ? (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 14, gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(120px, 1fr))", gap: 8, flexShrink: 0 }}>
                <div style={{ border: "1px solid var(--border)", padding: 8, borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontSize: 10, color: WB.textXs }}>Format</div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{exportFormat === "subckt" ? "Subckt wrapper" : "Pure BSIM3"}</div>
                </div>
                <div style={{ border: "1px solid var(--border)", padding: 8, borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontSize: 10, color: WB.textXs }}>Parameters</div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{Object.keys(pvals).length}</div>
                </div>
                <div style={{ border: "1px solid var(--border)", padding: 8, borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontSize: 10, color: WB.textXs }}>Fitted Steps</div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{fittedStepSummaries.filter(s => s.r2Log != null || s.r2Linear != null).length}</div>
                </div>
                <div style={{ border: "1px solid var(--border)", padding: 8, borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontSize: 10, color: WB.textXs }}>Power Cell</div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{fmtParam(activeAreaMm2)} mm²</div>
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  background: "#F8FAFC",
                  color: WB.text,
                  fontSize: 12,
                  lineHeight: 1.55,
                  fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "48px minmax(0, 1fr)" }}>
                  {exportPreviewLines.map((line, index) => (
                    <div key={index} style={{ display: "contents" }}>
                      <div
                        style={{
                          padding: "0 10px",
                          textAlign: "right",
                          color: WB.textXs,
                          background: "#EEF2F7",
                          borderRight: "1px solid var(--border)",
                          userSelect: "none",
                        }}
                      >
                        {index + 1}
                      </div>
                      <div style={{ padding: "0 12px", whiteSpace: "pre" }}>
                        {line || " "}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : !raw ? (
            <div style={{
              color: "var(--muted)", textAlign: "center",
              marginTop: 80, fontSize: 14,
            }}>
              点 "Load CSV" 加载数据
            </div>
          ) : (
            <>
              <div
                ref={plotRef}
                style={{
                  flex: `0 0 ${plotSplit * 100}%`,
                  minHeight: 180,
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, position: "relative", zIndex: 12 }}>
                  <div style={{ fontSize: 10, color: "var(--muted)", flex: 1 }}>
                    {activeCurveType === "idvd" ? `Vgs = ${vgs} V` : activeCurveType === "bv" ? `BV kind = ${steps[activeStep]?.bvKind ?? "bvdss"}` : activeCurveType === "cv" ? `CV = ${steps[activeStep]?.capType ?? "ciss"}` : `Vds = ${vds} V`}
                  </div>
                  <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                    {(["linear", "log"] as const).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setYScaleMode(mode)}
                        style={{
                          border: 0,
                          padding: "2px 7px",
                          fontSize: 10,
                          cursor: "pointer",
                          background: yScaleMode === mode ? "var(--primary)" : "var(--surface)",
                          color: yScaleMode === mode ? "#fff" : "var(--text)",
                        }}
                      >
                        {mode === "linear" ? "Linear" : "Log"}
                      </button>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="x" tick={{ fontSize: 10 }} type="number"
                      domain={[xDomain[0], xDomain[1]]} allowDataOverflow />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      allowDataOverflow
                      scale={yScaleMode === "log" ? "log" : "auto"}
                      domain={yScaleMode === "log" ? logYDomain : ["auto", "auto"]}
                      tickFormatter={v => yScaleMode === "log" ? Number(v).toExponential(0) : String(v)}
                    />
                    <Tooltip
                      formatter={(v: number) => Number(v).toExponential(3)}
                      labelFormatter={v => `${activeCurveType === "idvd" ? "Vds" : activeCurveType === "bv" || activeCurveType === "cv" ? "Vds" : "Vgs"}=${(v as number).toFixed(3)}`}
                      contentStyle={{ fontSize: 11 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine x={vmin} stroke="var(--warning)" strokeDasharray="4 2" strokeWidth={2} />
                    <ReferenceLine x={vmax} stroke="var(--warning)" strokeDasharray="4 2" strokeWidth={2} />
                    <Line type="monotone" dataKey="meas" stroke="#9ca3af" strokeWidth={1.5} dot={false} name="Measured" isAnimationActive={false} />
                    <Line
                      type="monotone"
                      dataKey="sim"
                      stroke="#0d99ff"
                      strokeWidth={0}
                      dot={{ r: 2.5, fill: "#0d99ff", stroke: "#fff", strokeWidth: 0.8 }}
                      activeDot={{ r: 4, fill: "#0d99ff", stroke: "#fff", strokeWidth: 1 }}
                      name="Simulated"
                      isAnimationActive={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
                <div
                  onMouseDown={(e) => {
                    setDraggingSplit(true);
                    e.preventDefault();
                  }}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: -4,
                    height: 8,
                    cursor: "row-resize",
                    background: draggingSplit ? "rgba(13,153,255,0.16)" : "transparent",
                    zIndex: 5,
                  }}
                  title="拖动调整上下图区域比例"
                />
              </div>

              <div style={{ height: 1, background: "var(--border)", flexShrink: 0 }} />

              <div style={{ flex: 1, minHeight: 120, display: "grid", gridTemplateColumns: "minmax(260px, 2fr) minmax(220px, 1fr)", gap: 12, padding: "10px 12px 12px" }}>
                <div style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, flex: 1 }}>Convergence</div>
                    <span
                      title="R²(log)：先对 Id 取 log10 再计算 R²，更关注阈值区、低电流区和跨数量级趋势。"
                      style={{ fontSize: 10, color: "#0d99ff", border: "1px solid rgba(13,153,255,0.35)", borderRadius: "var(--radius-sm)", padding: "1px 4px", cursor: "help" }}
                    >
                      R²(log)
                    </span>
                    <span
                      title="R²(linear)：直接用原始 Id 计算 R²，更关注大电流区的绝对电流误差。"
                      style={{ fontSize: 10, color: "#059669", border: "1px solid rgba(16,185,129,0.35)", borderRadius: "var(--radius-sm)", padding: "1px 4px", cursor: "help" }}
                    >
                      R²(lin)
                    </span>
                  </div>
                  {convergenceData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={convergenceData} margin={{ top: 8, right: 42, bottom: 18, left: 36 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="step" tick={{ fontSize: 10 }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 10 }} domain={[0, 1]} />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{ fontSize: 10 }}
                          scale="log"
                          domain={convergenceRightDomain}
                          tickFormatter={v => Number(v).toExponential(0)}
                          width={42}
                        />
                        <Tooltip
                          formatter={(v: number, name: string) => {
                            const n = Number(v);
                            const value = String(name).startsWith("R²") ? n.toFixed(4) : n.toExponential(2);
                            return [value, name];
                          }}
                          labelFormatter={v => `step ${v}`}
                          contentStyle={{ fontSize: 11 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Line yAxisId="left" type="monotone" dataKey="r2_log" stroke="#0d99ff" strokeWidth={1.8} dot={false} name="R²(log)" isAnimationActive={false} />
                        <Line yAxisId="left" type="monotone" dataKey="r2_linear" stroke="#10b981" strokeWidth={1.2} dot={false} name="R²(linear)" isAnimationActive={false} />
                        <Line yAxisId="right" type="monotone" dataKey="ftol_metric" stroke="#f59e0b" strokeWidth={1} dot={false} name="Δcost(ftol)" isAnimationActive={false} connectNulls />
                        <Line yAxisId="right" type="monotone" dataKey="xtol_metric" stroke="#8b5cf6" strokeWidth={1} dot={false} name="Δx(xtol)" isAnimationActive={false} connectNulls />
                        <Line yAxisId="right" type="monotone" dataKey="gtol_metric" stroke="#ef4444" strokeWidth={1} dot={false} name="Δrms(gtol)" isAnimationActive={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ color: "var(--muted)", fontSize: 12, paddingTop: 24 }}>拟合开始后显示收敛曲线</div>
                  )}
                </div>
                <div style={{ minHeight: 0, overflow: "auto", borderLeft: "1px solid var(--border)", paddingLeft: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Fit Params</div>
                  <div style={{ display: "grid", gridTemplateColumns: "64px 1fr 38px", gap: 4, fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>
                    <span>Param</span><span>Value</span><span>Unit</span>
                  </div>
                  {fittedParamRows.map(row => (
                    <div key={row.name} style={{ display: "grid", gridTemplateColumns: "64px 1fr 38px", gap: 4, alignItems: "center", fontSize: 11, lineHeight: 1.6 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{row.name}</span>
                      <span style={{ fontFamily: "monospace", color: "var(--primary)" }}>{fmtParam(row.value)}</span>
                      <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{row.unit}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div
                onMouseDown={onOverlayMouseDown}
                onMouseMove={onOverlayMouseMove}
                style={{
                  position: "absolute",
                  top: 24,
                  left: 0,
                  right: 0,
                  height: `calc(${plotSplit * 100}% - 24px)`,
                  cursor: dragging ? "ew-resize" : hoverCursor,
                  userSelect: "none",
                  pointerEvents: "auto",
                }}
              />
            </>
          )}
    </div>
      </div>
      {hideFitTargetsPanel && (
        <div
          onPointerDown={beginConfigResize}
          title="拖动调整 Target Config 宽度"
          style={{
            order: 2,
            width: 7,
            flexShrink: 0,
            cursor: "col-resize",
            borderLeft: "1px solid var(--border)",
            borderRight: "1px solid var(--border)",
            background: WB.pageBg,
          }}
        />
      )}
      <div style={{
        order: hideFitTargetsPanel ? 1 : 2,
        width: hideFitTargetsPanel ? configPanelWidth : 390,
        minWidth: hideFitTargetsPanel ? CONFIG_PANEL_MIN_WIDTH : 340,
        borderLeft: hideFitTargetsPanel ? 0 : "1px solid var(--border)",
        borderRight: hideFitTargetsPanel ? "1px solid var(--border)" : 0,
        background: WB.panelBg,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {isExportPanelVisible ? (
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Export Model</div>
            <div style={{ fontSize: 11, color: WB.textXs, marginTop: 2 }}>Final step: write current BSIM parameters to SPICE .lib</div>
          </div>
        ) : (
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            {(["steps", "params"] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setSidePanelTab(tab)}
                style={{
                  flex: 1,
                  border: 0,
                  borderBottom: sidePanelTab === tab ? `2px solid ${WB.primary}` : "2px solid transparent",
                  background: sidePanelTab === tab ? WB.primaryLt : "transparent",
                  color: sidePanelTab === tab ? WB.primary : WB.textSm,
                  padding: "9px 8px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {tab === "steps" ? "Target Config" : "BSIM Params"}
              </button>
            ))}
          </div>
        )}
        {!isExportPanelVisible && sidePanelTab === "steps" ? (
          <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
            {/* 根据选中内容显示不同的配置 */}
            {externalSelectedStep?.id === "power_cell" ? (
              // 显示 Power Cell 配置 - 只有 Area 和 Pitch
              <>
                <section>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Power Cell</div>
                  <div style={{ fontSize: 11, color: WB.textXs, marginBottom: 10 }}>
                    器件级参数，应用于所有拟合步骤
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label style={{ fontSize: 12, color: WB.textSm }}>Area mm²<input type="number" value={activeAreaMm2} step={0.1} onChange={e => setActiveAreaMm2(Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                    <label style={{ fontSize: 12, color: WB.textSm }}>Pitch µm<input type="number" value={cellPitchUm} step={0.1} onChange={e => setCellPitchUm(Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                  </div>
                </section>
              </>
            ) : externalSelectedStep ? (
              // 显示选中 step 的配置
              <>
                <section>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Target: {externalSelectedStep.label}</div>
                  <div style={{ fontSize: 11, color: WB.textXs }}>
                    Type: {externalSelectedStep.type || "—"} · CSV: {externalSelectedStep.csvFile || "—"}
                  </div>
                </section>
                <section>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Data Source</div>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={onLoad}
                    disabled={!canLoadTargetCsv}
                    style={{ width: "100%", justifyContent: "center" }}
                    title={isTargetLoadSupported ? "为当前 step 加载 CSV" : "当前 step 类型暂未接入 CSV 加载"}
                  >
                    <Upload size={13} />{loading ? "Loading..." : "Load CSV"}
                  </Button>
                  <div
                    style={{
                      marginTop: 7,
                      minHeight: 18,
                      fontSize: 11,
                      color: targetConfigFileName ? WB.textMd : WB.textXs,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={targetConfigStep?.csvPath || "No CSV loaded"}
                  >
                    {targetConfigFileName || "No CSV loaded for this step"}
                  </div>
                </section>
                <section>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Circuit Condition</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label style={{ fontSize: 12, color: WB.textSm }}>
                      {externalSelectedStep.type === "BV" ? "BV kind" : externalSelectedStep.type === "CV" ? "Cap type" : externalSelectedStep.type === "IdVg" ? "Vds (V)" : "Vgs (V)"}
                      <input
                        type={externalSelectedStep.type === "BV" || externalSelectedStep.type === "CV" ? "text" : "number"}
                        value={externalSelectedStep.type === "BV" ? (targetConfigStep?.bvKind ?? "bvdss") : externalSelectedStep.type === "CV" ? (targetConfigStep?.capType ?? "ciss") : targetConfigStep?.curveType === "idvd" ? vgs : vds}
                        placeholder="?"
                        step={0.1}
                        readOnly={externalSelectedStep.type === "BV" || externalSelectedStep.type === "CV"}
                        onChange={e => {
                          if (externalSelectedStep.type === "BV" || externalSelectedStep.type === "CV") return;
                          const value = Number(e.target.value);
                          if (targetConfigStep?.curveType === "idvd") setVgs(value);
                          else setVds(value);
                        }}
                        style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px", backgroundColor: externalSelectedStep.type === "BV" || externalSelectedStep.type === "CV" ? WB.pageBg : "#fff" }}
                      />
                    </label>
                    <label style={{ fontSize: 12, color: WB.textSm }}>Range<input type="text" value={`${targetConfigStep?.curveType === "idvd" || targetConfigStep?.curveType === "cv" ? "Vds" : targetConfigStep?.curveType === "bv" ? "V" : "Vgs"} ${vmin}-${vmax}V`} readOnly style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px", backgroundColor: WB.pageBg }} /></label>
                  </div>
                </section>
                <section>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Fit Range</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label style={{ fontSize: 12, color: WB.textSm }}>Vmin<input type="number" value={vmin} step={0.05} onChange={e => setVmin(Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                    <label style={{ fontSize: 12, color: WB.textSm }}>Vmax<input type="number" value={vmax} step={0.05} onChange={e => setVmax(Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                    <label style={{ fontSize: 12, color: WB.textSm }}>Points<input readOnly value={inRange} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px", backgroundColor: WB.pageBg }} /></label>
                    <label style={{ fontSize: 12, color: WB.textSm }}>Weight<input type="number" value={externalSelectedStep.weight ?? 1.0} min={0} max={2} step={0.1} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                  </div>
                </section>
                <section>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Stop Criteria</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label style={{ fontSize: 12, color: WB.textSm }}>Preset<select value={stopPreset} onChange={e => {
                      const next = e.target.value as StopPreset;
                      setStopPreset(next);
                      if (next !== "custom") setFitStop(STOP_PRESETS[next]);
                    }} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }}>
                      <option value="fast">Fast</option><option value="balanced">Balanced</option><option value="precise">Precise</option><option value="custom">Custom</option>
                    </select></label>
                    <label style={{ fontSize: 12, color: WB.textSm }}>Max nfev<input type="number" value={fitStop.max_nfev} onChange={e => updateStopValue("max_nfev", Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                    <label style={{ fontSize: 12, color: WB.textSm }}>R² log<input type="number" value={fitStop.r2_log} step={0.001} onChange={e => updateStopValue("r2_log", Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                    <label style={{ fontSize: 12, color: WB.textSm }}>R² linear<input type="number" value={fitStop.r2_linear} step={0.001} onChange={e => updateStopValue("r2_linear", Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                  </div>
                </section>
              </>
            ) : (
              // 旧的默认显示（无外部选中时）
              <>
                <section>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Current Target</div>
                  <div style={{ fontSize: 12, color: WB.textSm, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {fileName || "No CSV loaded"} · {fitScopeSummary.mode}
                  </div>
                </section>
                <section>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={onLoad}
                    disabled={loading || workbenchIsRunning}
                    style={{ width: "100%", justifyContent: "center" }}
                    title="加载当前 step 的 CSV"
                  >
                    <Upload size={13} />{loading ? "Loading..." : "Load CSV"}
                  </Button>
                </section>
                <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {activeCurveType === "idvd" ? (
                    <label style={{ fontSize: 12, color: WB.textSm }}>Vgs (V)<input type="number" value={vgs} step={0.1} onChange={e => setVgs(Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                  ) : activeCurveType === "bv" ? (
                    <label style={{ fontSize: 12, color: WB.textSm }}>BV kind<input readOnly value={steps[activeStep]?.bvKind ?? "bvdss"} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px", backgroundColor: WB.pageBg }} /></label>
                  ) : activeCurveType === "cv" ? (
                    <label style={{ fontSize: 12, color: WB.textSm }}>Cap type<input readOnly value={steps[activeStep]?.capType ?? "ciss"} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px", backgroundColor: WB.pageBg }} /></label>
                  ) : (
                    <label style={{ fontSize: 12, color: WB.textSm }}>Vds (V)<input type="number" value={vds} step={0.1} onChange={e => setVds(Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                  )}
                  <label style={{ fontSize: 12, color: WB.textSm }}>Vmin<input type="number" value={vmin} step={0.05} onChange={e => setVmin(Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                  <label style={{ fontSize: 12, color: WB.textSm }}>Vmax<input type="number" value={vmax} step={0.05} onChange={e => setVmax(Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                  <label style={{ fontSize: 12, color: WB.textSm }}>Points<input readOnly value={inRange} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                </section>

                <section>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Stop Criteria</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label style={{ fontSize: 12, color: WB.textSm }}>Preset<select value={stopPreset} onChange={e => {
                      const next = e.target.value as StopPreset;
                      setStopPreset(next);
                      if (next !== "custom") setFitStop(STOP_PRESETS[next]);
                    }} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }}>
                      <option value="fast">Fast</option><option value="balanced">Balanced</option><option value="precise">Precise</option><option value="custom">Custom</option>
                    </select></label>
                    <label style={{ fontSize: 12, color: WB.textSm }}>Max nfev<input type="number" value={fitStop.max_nfev} onChange={e => updateStopValue("max_nfev", Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                    <label style={{ fontSize: 12, color: WB.textSm }}>R² log<input type="number" value={fitStop.r2_log} step={0.001} onChange={e => updateStopValue("r2_log", Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                    <label style={{ fontSize: 12, color: WB.textSm }}>R² linear<input type="number" value={fitStop.r2_linear} step={0.001} onChange={e => updateStopValue("r2_linear", Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                  </div>
                </section>

                <section>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Power Cell</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label style={{ fontSize: 12, color: WB.textSm }}>Area mm²<input type="number" value={activeAreaMm2} step={0.1} onChange={e => setActiveAreaMm2(Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                    <label style={{ fontSize: 12, color: WB.textSm }}>Pitch µm<input type="number" value={cellPitchUm} step={0.1} onChange={e => setCellPitchUm(Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 13, color: WB.textSm }}>
                    <input type="checkbox" checked={protectPrevious} onChange={e => setProtectPrevious(e.target.checked)} />
                    Protect previous fitted curves
                  </label>
                  <label style={{ fontSize: 12, color: WB.textSm, display: "block", marginTop: 8 }}>Protect weight<input type="number" value={protectWeight} min={0} max={1} step={0.05} onChange={e => setProtectWeight(Number(e.target.value))} style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }} /></label>
                </section>
              </>
            )}
          </div>
        ) : !isExportPanelVisible && sidePanelTab === "params" ? (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>BSIM Parameters</div>
                <div style={{ fontSize: 12, color: WB.textXs }}>{fitParamNames.length} selected · {lockedParams.size} locked</div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={onImportSpiceParams}
                disabled={importingParams}
                title="Import parameters from a SPICE .lib/.model file"
              >
                <Upload size={13} />{importingParams ? "Importing..." : "Import"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setLockedParams(new Set())}>Unlock</Button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: 10, display: "flex", flexDirection: "column" }}>
              <ParamSliders
                values={pvals}
                checked={checked}
                locked={lockedParams}
                onChange={onParamChange}
                onCheck={onCheck}
                onToggleLock={onToggleLock}
                onReset={onReset}
                onResetCat={onResetCat}
                bounds={customBounds}
                onBoundsChange={onBoundsChange}
                onResetBounds={onResetBounds}
                onResetCatBounds={onResetCatBounds}
              />
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
            <section>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Export SPICE Model</div>
              <div style={{ fontSize: 11, color: WB.textXs }}>
                Export the current BSIM parameter set shown in BSIM Params.
              </div>
            </section>

            <section>
              <div style={{ fontSize: 12, color: WB.textSm, marginBottom: 6 }}>Format</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <Button
                  size="sm"
                  variant={exportFormat === "subckt" ? "primary" : "outline"}
                  onClick={() => setExportFormat("subckt")}
                >
                  Subckt
                </Button>
                <Button
                  size="sm"
                  variant={exportFormat === "bsim3" ? "primary" : "outline"}
                  onClick={() => setExportFormat("bsim3")}
                >
                  BSIM3
                </Button>
              </div>
            </section>

            <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ fontSize: 12, color: WB.textSm }}>
                {exportFormat === "subckt" ? "Subckt Name" : "Model Name"}
                <input
                  value={exportSubcktName}
                  onChange={e => setExportSubcktName(e.target.value)}
                  style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }}
                />
              </label>
              <label style={{ fontSize: 12, color: WB.textSm }}>
                Rg (Ω)
                <input
                  type="number"
                  value={exportRgOhm}
                  min={0}
                  step={0.1}
                  onChange={e => setExportRgOhm(Number(e.target.value))}
                  style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }}
                />
              </label>
              <label style={{ fontSize: 12, color: WB.textSm }}>
                Area mm²
                <input
                  type="number"
                  value={activeAreaMm2}
                  step={0.1}
                  onChange={e => setActiveAreaMm2(Number(e.target.value))}
                  style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }}
                />
              </label>
              <label style={{ fontSize: 12, color: WB.textSm }}>
                Pitch µm
                <input
                  type="number"
                  value={cellPitchUm}
                  step={0.1}
                  onChange={e => setCellPitchUm(Number(e.target.value))}
                  style={{ width: "100%", marginTop: 4, fontSize: 13, padding: "3px 5px" }}
                />
              </label>
            </section>

            <section>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: WB.textSm }}>
                <input
                  type="checkbox"
                  checked={exportIncludeDiode}
                  onChange={e => setExportIncludeDiode(e.target.checked)}
                />
                Include body diode
              </label>
            </section>

            <section>
              <div style={{ fontSize: 12, color: WB.textSm, marginBottom: 4 }}>Output Path</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={exportOutputPath}
                  onChange={e => setExportOutputPath(e.target.value)}
                  placeholder="C:/models/MY_MOSFET.lib"
                  style={{ flex: 1, minWidth: 0, fontSize: 12, padding: "4px 6px" }}
                />
                <Button size="sm" variant="outline" onClick={pickExportPath}>Browse</Button>
              </div>
            </section>

            <Button
              size="sm"
              variant="primary"
              onClick={onExportModel}
              disabled={exporting || !exportOutputPath}
              style={{ width: "100%" }}
            >
              <Download size={13} />{exporting ? "Exporting..." : "Export .lib"}
            </Button>

            {exportResult && (
              <div style={{ border: `1px solid ${WB.border}`, background: "#ECFDF5", padding: 9, borderRadius: "var(--radius-sm)", fontSize: 11 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 800, color: "#047857" }}>
                  <CheckCircle2 size={13} />Exported
                </div>
                <div title={exportResult.path} style={{ marginTop: 4, color: WB.textMd, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {exportResult.path}
                </div>
                <div style={{ color: WB.textXs }}>{exportResult.nBytes.toLocaleString()} bytes</div>
              </div>
            )}
            {exportError && (
              <div style={{ border: "1px solid #FCA5A5", background: "#FEF2F2", padding: 9, borderRadius: "var(--radius-sm)", color: "#991B1B", fontSize: 11 }}>
                {exportError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
