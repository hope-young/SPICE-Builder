/**
 * SpiceBuilder — Multi-Characteristic Fit Workbench
 * Professional BSIM3v3 parameter extraction workstation
 */
import { useState, useMemo, useRef, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import {
  ChevronRight, ChevronDown, Plus, Lock, Unlock,
  LayoutGrid, AlignJustify, AlignLeft,
  Upload, Play, Square, Download,
  CheckCircle2, Circle, Minus,
  MoreHorizontal, Pin, BarChart2,
  Settings2, FileText, Activity,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════
   DESIGN TOKENS
════════════════════════════════════════════════════════════════ */
const C = {
  pageBg:    "#F6F7F9",
  panelBg:   "#FFFFFF",
  border:    "#D7DDE5",
  borderMd:  "#BFC9D4",

  primary:   "#0D7F8F",
  primaryLt: "#DFF4F6",
  primaryDk: "#096574",

  text:      "#1A2633",
  textMd:    "#3D4F61",
  textSm:    "#6B7A8D",
  textXs:    "#8D9BAA",

  success:   "#2D8A4E",
  successLt: "#E5F3EA",
  warning:   "#B45309",
  warningLt: "#FEF0C7",
  error:     "#BF3A30",
  errorLt:   "#FCECEA",

  selectedBg: "#E5F3F6",
  selectedBdr:"#0D7F8F",

  menuBg:    "#EAECF0",
  dropShadow:"0 2px 8px rgba(0,0,0,0.12)",

  measured:  "#3B6FAF",
  simulated: "#2D8A4E",
};
const ff   = "'Inter','Segoe UI',system-ui,sans-serif";
const mono = "'JetBrains Mono','Consolas',monospace";

/* ═══════════════════════════════════════════════════════════════
   TYPES
════════════════════════════════════════════════════════════════ */
type FitStatus  = "done"|"queued"|"running"|"empty"|"error";
type LayoutMode = "grid"|"vertical"|"horizontal";
type StopPreset = "fast"|"standard"|"fine"|"custom";
type FitScope   = "none"|"single"|"joint";

interface TreeChild {
  id: string; label: string; status: FitStatus;
  r2: string|null; pts: number;
  bias?: string; csvFile?: string; range?: string; weight?: number; type?: string;
}
interface TreeFeature {
  id: string; label: string; tag: "live"|"next";
  canAdd: boolean; addLabel?: string; children: TreeChild[];
}
interface BsimParam {
  name: string; descShort: string; descFull: string;
  value: string; unit: string; active: boolean; locked: boolean;
}

/* ═══════════════════════════════════════════════════════════════
   STATIC DATA
════════════════════════════════════════════════════════════════ */
const TREE_DATA: TreeFeature[] = [
  {
    id:"idvg", label:"IdVg / Transfer", tag:"live", canAdd:true, addLabel:"Add Vds step",
    children:[
      { id:"idvg_05",  label:"IdVg @ Vds=0.5V", status:"done",   r2:"0.999", pts:52,  bias:"Vds=0.5V", csvFile:"SDH10N_IdVg_25C.csv", range:"Vgs 0–10V", weight:1.0, type:"IdVg" },
      { id:"idvg_5",   label:"IdVg @ Vds=5V",   status:"done",   r2:"0.997", pts:52,  bias:"Vds=5V",   csvFile:"SDH10N_IdVg_25C.csv", range:"Vgs 0–10V", weight:1.0, type:"IdVg" },
    ],
  },
  {
    id:"idvd", label:"IdVd / Output", tag:"live", canAdd:true, addLabel:"Add Vgs step",
    children:[
      { id:"idvd_5",   label:"IdVd @ Vgs=5V",   status:"done",   r2:"0.994", pts:128, bias:"Vgs=5V",   csvFile:"SDH10N_IdVd_25C.csv", range:"Vds 0–30V", weight:1.0, type:"IdVd" },
      { id:"idvd_6",   label:"IdVd @ Vgs=6V",   status:"queued", r2:null,    pts:128, bias:"Vgs=6V",   csvFile:"SDH10N_IdVd_25C.csv", range:"Vds 0–30V", weight:1.0, type:"IdVd" },
      { id:"idvd_10",  label:"IdVd @ Vgs=10V",  status:"queued", r2:null,    pts:128, bias:"Vgs=10V",  csvFile:"SDH10N_IdVd_25C.csv", range:"Vds 0–30V", weight:1.0, type:"IdVd" },
    ],
  },
  {
    id:"bv", label:"BV / Leakage", tag:"next", canAdd:false,
    children:[
      { id:"bvdss",   label:"BVDSS",  status:"empty", r2:null, pts:0, type:"BV" },
      { id:"idss",    label:"IDSS",   status:"empty", r2:null, pts:0, type:"BV" },
      { id:"igss_p",  label:"IGSS+",  status:"empty", r2:null, pts:0, type:"BV" },
      { id:"igss_n",  label:"IGSS−",  status:"empty", r2:null, pts:0, type:"BV" },
    ],
  },
  {
    id:"bodydiode", label:"Body Diode", tag:"next", canAdd:false,
    children:[
      { id:"isvsd",   label:"Is-Vsd", status:"empty", r2:null, pts:0, type:"BodyDiode" },
      { id:"qrr",     label:"Qrr",    status:"empty", r2:null, pts:0, type:"BodyDiode" },
    ],
  },
  {
    id:"cv", label:"CV / Capacitance", tag:"next", canAdd:false,
    children:[
      { id:"ciss", label:"Ciss", status:"empty", r2:null, pts:0, type:"CV" },
      { id:"coss", label:"Coss", status:"empty", r2:null, pts:0, type:"CV" },
      { id:"crss", label:"Crss", status:"empty", r2:null, pts:0, type:"CV" },
    ],
  },
  {
    id:"qg", label:"Qg / Gate Charge", tag:"next", canAdd:false,
    children:[
      { id:"qg_total", label:"Qg total", status:"empty", r2:null, pts:0, type:"Qg" },
      { id:"qgs",      label:"Qgs",      status:"empty", r2:null, pts:0, type:"Qg" },
      { id:"qgd",      label:"Qgd",      status:"empty", r2:null, pts:0, type:"Qg" },
    ],
  },
  {
    id:"dpt", label:"DPT / Switching", tag:"next", canAdd:false,
    children:[
      { id:"dpt_on",  label:"Turn-on",  status:"empty", r2:null, pts:0, type:"DPT" },
      { id:"dpt_off", label:"Turn-off", status:"empty", r2:null, pts:0, type:"DPT" },
    ],
  },
];

const INIT_PARAMS: BsimParam[] = [
  { name:"VTH0",    descShort:"零偏阈值电压",       descFull:"零栅-源偏压下的长沟道阈值电压，影响转移特性起始位置",            value:"2.100",    unit:"V",       active:true,  locked:true  },
  { name:"K1",      descShort:"一阶体效应系数",     descFull:"衬底偏置对阈值电压的一阶调制系数，越大体效应越强",              value:"0.530",    unit:"√V",      active:true,  locked:true  },
  { name:"K2",      descShort:"二阶体效应系数",     descFull:"衬底偏置对阈值电压的二阶非线性修正项",                         value:"-0.012",   unit:"—",        active:true,  locked:false },
  { name:"NFACTOR", descShort:"亚阈值摆幅因子",     descFull:"亚阈值区Id-Vg斜率相关的非理想因子，理想值为1，反映界面态",     value:"1.082",    unit:"—",        active:true,  locked:true  },
  { name:"DVT0",    descShort:"短沟道效应系数0",    descFull:"短沟道效应（SCE）对阈值的第一调制系数，决定SCE强度",           value:"2.200",    unit:"—",        active:false, locked:false },
  { name:"DVT1",    descShort:"短沟道效应系数1",    descFull:"短沟道效应的特征衰减长度系数",                                 value:"0.530",    unit:"—",        active:false, locked:false },
  { name:"DSUB",    descShort:"亚阈值衰减系数",     descFull:"亚阈值区短沟道效应的特征衰减长度参数",                         value:"0.560",    unit:"—",        active:false, locked:false },
  { name:"U0",      descShort:"低场载流子迁移率",   descFull:"低横向电场下载流子迁移率，温度和掺杂相关，影响线性区跨导",     value:"412.3",    unit:"cm²/Vs",  active:true,  locked:false },
  { name:"UA",      descShort:"迁移率退化系数1",    descFull:"栅极电场导致的纵向迁移率退化一阶系数（Coulomb散射）",          value:"1.82e-9",  unit:"m/V",     active:true,  locked:false },
  { name:"UB",      descShort:"迁移率退化系数2",    descFull:"纵向迁移率退化二阶系数（声子散射主导），UA²主导时才显著",      value:"4.6e-19",  unit:"m²/V²",   active:false, locked:false },
  { name:"UC",      descShort:"体效应迁移率系数",   descFull:"衬底偏置（Vbs）对载流子迁移率的调制系数",                     value:"3.2e-11",  unit:"/V",      active:false, locked:false },
  { name:"VSAT",    descShort:"载流子饱和速度",     descFull:"高电场下载流子速度饱和值，决定饱和区驱动电流上限",             value:"8.20e4",   unit:"m/s",     active:true,  locked:false },
  { name:"A0",      descShort:"体电荷效应系数",     descFull:"体电荷效应对饱和区Id的调制系数（Abulk相关）",                 value:"1.000",    unit:"—",        active:false, locked:false },
  { name:"KETA",    descShort:"体效应调制系数",     descFull:"体偏置对体电荷效应的附加调制项，通常为负值",                   value:"-0.047",   unit:"/V",      active:false, locked:false },
  { name:"PCLM",    descShort:"沟长调制系数",       descFull:"沟道长度调制（CLM）导致的输出电导效应系数，影响Ids-Vds斜率",  value:"0.518",    unit:"—",        active:true,  locked:false },
  { name:"PDIBLC1", descShort:"DIBL一阶系数",       descFull:"漏感应势垒降低（DIBL）效应的一阶系数，影响Vth随Vds的偏移",    value:"0.318",    unit:"—",        active:false, locked:false },
  { name:"PDIBLC2", descShort:"DIBL二阶系数",       descFull:"漏感应势垒降低（DIBL）效应的二阶修正系数",                    value:"0.044",    unit:"—",        active:false, locked:false },
  { name:"DROUT",   descShort:"DIBL长度系数",       descFull:"DIBL效应对沟道长度依赖关系的特征长度系数",                    value:"0.562",    unit:"—",        active:false, locked:false },
  { name:"PVAG",    descShort:"早效栅压系数",       descFull:"Early效应中栅极电压的附加调制系数",                           value:"0.840",    unit:"—",        active:false, locked:false },
  { name:"CGSO",    descShort:"栅源覆盖电容",       descFull:"栅极与源极重叠区域的单位宽度线性电容，Ciss主要组成",          value:"1.12e-10", unit:"F/m",     active:false, locked:false },
  { name:"CGDO",    descShort:"栅漏覆盖电容",       descFull:"栅极与漏极重叠区域的单位宽度线性电容，Crss主要组成",          value:"8.4e-11",  unit:"F/m",     active:false, locked:false },
  { name:"CJ",      descShort:"零偏体结电容",       descFull:"漏/源衬底pn结的零偏单位面积电容（底部结），影响Coss",         value:"9.42e-4",  unit:"F/m²",    active:false, locked:false },
  { name:"MJ",      descShort:"结梯度系数",         descFull:"底部结电容随反偏电压变化的指数因子，典型值0.3–0.5",           value:"0.482",    unit:"—",        active:false, locked:false },
  { name:"CJSW",    descShort:"侧壁结电容",         descFull:"漏/源衬底pn结侧壁的单位周长零偏电容",                        value:"2.5e-10",  unit:"F/m",     active:false, locked:false },
  { name:"TOXE",    descShort:"等效栅氧厚度",       descFull:"电学等效栅氧化层厚度，由C-V测量提取，影响所有电容和阈值",     value:"4.1e-9",   unit:"m",       active:false, locked:true  },
];

const QUEUE_ITEMS = [
  { id:"q1", label:"Transfer IdVg",   status:"done",    progress:100, metric:"R²=0.999" },
  { id:"q2", label:"Output IdVd",     status:"running", progress:42,  metric:"R²=0.941" },
  { id:"q3", label:"BV / Leakage",    status:"queued",  progress:0,   metric:null },
  { id:"q4", label:"CV / Capacitance",status:"queued",  progress:0,   metric:null },
  { id:"q5", label:"Qg / Gate Charge",status:"queued",  progress:0,   metric:null },
  { id:"q6", label:"DPT Switching",   status:"queued",  progress:0,   metric:null },
];

/* ═══════════════════════════════════════════════════════════════
   DATA GENERATORS (deterministic)
════════════════════════════════════════════════════════════════ */
function sRand(a: number, b: number) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function genIdVg(vds: number, hasSim: boolean, seed: number) {
  const vth = 2.1, beta = 1.2;
  return Array.from({length:21}, (_, i) => {
    const vgs = i * 0.5;
    let id: number;
    if (vgs <= vth) {
      id = Math.max(1e-10, 1e-8 * Math.exp((vgs - vth) / 0.072));
    } else {
      const vgseff = vgs - vth;
      const vdsat = vgseff * 0.68;
      if (vds < vdsat) {
        id = Math.max(1e-10, beta * (vgseff * vds - vds * vds / 2));
      } else {
        id = Math.max(1e-10, beta * vgseff * vgseff / 2 * (1 + 0.045 * vds));
      }
    }
    const noise = (sRand(seed + i * 3, 1) - 0.5) * 0.08;
    return {
      x: vgs,
      meas: id * (1 + noise),
      sim: hasSim ? id * (1 + noise * 0.18) : null,
    };
  });
}

function genIdVd(vgs: number, hasSim: boolean, seed: number) {
  const vth = 2.1, beta = 1.2;
  return Array.from({length:31}, (_, i) => {
    const vds = i * 1.0;
    const vgseff = Math.max(0, vgs - vth);
    let id = 0;
    if (vgseff > 0 && vds > 0) {
      const vdsat = vgseff * 0.68;
      if (vds < vdsat) {
        id = beta * (vgseff * vds - vds * vds / 2);
      } else {
        id = beta * vgseff * vgseff / 2 * (1 + 0.045 * vds);
      }
    }
    const noise = (sRand(seed + i * 5, 2 + vgs) - 0.5) * 0.05;
    return {
      x: vds,
      meas: Math.max(0, id * (1 + noise)),
      sim: hasSim ? Math.max(0, id * (1 + noise * 0.15)) : null,
    };
  });
}

function genConvergence(finalR2: number, iters: number, seed: number) {
  const pts = Math.min(iters, 55);
  return Array.from({length:pts}, (_, i) => {
    const t = i / (pts - 1);
    const jitter = (sRand(seed + i, 7) - 0.5) * 0.04;
    const r2log = Math.min(0.9999, finalR2 - (finalR2 - 0.3) * Math.exp(-5 * t) + jitter * Math.exp(-3 * t));
    const r2lin = Math.min(0.9999, finalR2 * 0.98 - (finalR2 * 0.98 - 0.15) * Math.exp(-4.5 * t));
    const deltaCost = Math.max(1e-8, 0.1 * Math.exp(-6 * t) * (1 + jitter));
    return { iter: Math.round(t * iters), r2log: Math.max(0, r2log), r2lin: Math.max(0, r2lin), deltaCost };
  });
}

/* ═══════════════════════════════════════════════════════════════
   STATUS ICON
════════════════════════════════════════════════════════════════ */
function StatusIcon({ status }: { status: FitStatus }) {
  if (status === "done")    return <CheckCircle2 size={12} color={C.success} />;
  if (status === "error")   return <Minus size={12} color={C.error} style={{ background: C.error, color:"#fff", borderRadius:"50%", padding:1 }} />;
  if (status === "queued")  return <Circle size={12} color={C.textXs} />;
  if (status === "running") return <Circle size={12} color={C.primary} style={{ animation:"pulse 1s infinite" }} />;
  return <Circle size={12} color={C.border} />;
}

/* ═══════════════════════════════════════════════════════════════
   MENU BAR
════════════════════════════════════════════════════════════════ */
const MENUS: Record<string, string[]> = {
  "文件": ["新建项目","打开项目","—","导入 CSV / Excel","—","保存模型","导出 SPICE .lib"],
  "编辑": ["撤销 Ctrl+Z","重做 Ctrl+Y","—","复制参数","粘贴参数","—","重置全部参数"],
  "视图": ["Grid 多图布局","Vertical 纵向布局","Horizontal 横向布局","—","显示/隐藏 Convergence","显示/隐藏 Fit Queue"],
  "拟合": ["仿真当前项 F5","拟合勾选项 F7","拟合全部队列 F8","—","停止拟合 Esc","重置停止条件"],
  "工具": ["LTspice 路径设置","网格提取工具","参数灵敏度分析","—","日志查看器"],
  "帮助": ["文档","快捷键","—","关于 SpiceBuilder v2.4.1"],
};

function MenuBar({ onViewLayout, onFitAction }: {
  onViewLayout: (l: LayoutMode) => void;
  onFitAction: (a: string) => void;
}) {
  const [open, setOpen] = useState<string|null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleItem = (menu: string, item: string) => {
    setOpen(null);
    if (item === "Grid 多图布局")      onViewLayout("grid");
    if (item === "Vertical 纵向布局")  onViewLayout("vertical");
    if (item === "Horizontal 横向布局") onViewLayout("horizontal");
    if (item.startsWith("仿真"))       onFitAction("simulate");
    if (item.startsWith("拟合勾选"))   onFitAction("fit-selected");
    if (item.startsWith("拟合全部"))   onFitAction("fit-all");
    if (item.startsWith("停止"))       onFitAction("stop");
  };

  return (
    <div ref={ref} style={{
      height:28, display:"flex", alignItems:"center",
      backgroundColor: C.menuBg,
      borderBottom:`1px solid ${C.border}`,
      paddingLeft:8, gap:0, flexShrink:0, userSelect:"none",
    }}>
      <span style={{ fontSize:12, fontWeight:600, color:C.primary, paddingRight:10, fontFamily:ff }}>SpiceBuilder</span>
      <div style={{ width:1, height:16, backgroundColor:C.border, marginRight:6 }} />
      {Object.keys(MENUS).map(menu => (
        <div key={menu} style={{ position:"relative" }}>
          <button
            onClick={() => setOpen(open === menu ? null : menu)}
            style={{
              height:28, padding:"0 10px", border:"none", cursor:"pointer",
              backgroundColor: open === menu ? C.primaryLt : "transparent",
              color: open === menu ? C.primary : C.text,
              fontSize:12, fontFamily:ff,
              transition:"background-color 0.08s",
            }}
            onMouseEnter={e => { if (!open) return; setOpen(menu); (e.currentTarget as HTMLElement).style.backgroundColor = C.primaryLt; }}
            onMouseLeave={e => { if (open !== menu) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
          >
            {menu}
          </button>
          {open === menu && (
            <div style={{
              position:"absolute", top:28, left:0, zIndex:1000,
              backgroundColor:C.panelBg, border:`1px solid ${C.border}`,
              borderRadius:4, boxShadow:C.dropShadow, minWidth:200,
              padding:"3px 0",
            }}>
              {MENUS[menu].map((item, idx) => item === "—" ? (
                <div key={idx} style={{ height:1, backgroundColor:C.border, margin:"3px 0" }} />
              ) : (
                <button
                  key={item}
                  onClick={() => handleItem(menu, item)}
                  style={{
                    display:"block", width:"100%", textAlign:"left",
                    padding:"5px 14px", border:"none", cursor:"pointer",
                    backgroundColor:"transparent", fontSize:12, fontFamily:ff, color:C.text,
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = C.primaryLt}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"}
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

/* ═══════════════════════════════════════════════════════════════
   TOOLBAR
════════════════════════════════════════════════════════════════ */
function Toolbar({
  layout, onLayout, isRunning, onAction,
}: {
  layout: LayoutMode;
  onLayout: (l: LayoutMode) => void;
  isRunning: boolean;
  onAction: (a: string) => void;
}) {
  return (
    <div style={{
      height:44, display:"flex", alignItems:"center", gap:10,
      padding:"0 14px", borderBottom:`1px solid ${C.border}`,
      backgroundColor:C.panelBg, flexShrink:0,
    }}>
      {/* Breadcrumb */}
      <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:C.textSm, fontFamily:ff }}>
        <span style={{ color:C.textXs }}>Project</span>
        <ChevronRight size={11} color={C.textXs} />
        <span style={{ color:C.textMd, fontWeight:500 }}>SDH10N2P1</span>
        <ChevronRight size={11} color={C.textXs} />
        <span style={{ color:C.text, fontWeight:600 }}>Multi-Characteristic Fit</span>
      </div>

      <div style={{ flex:1 }} />

      {/* Layout switch */}
      <div style={{
        display:"flex", border:`1px solid ${C.border}`, borderRadius:5, overflow:"hidden",
      }}>
        {([
          { id:"grid"       as LayoutMode, icon:<LayoutGrid size={13} />,   label:"Grid"       },
          { id:"vertical"   as LayoutMode, icon:<AlignLeft size={13} />,    label:"Vertical"   },
          { id:"horizontal" as LayoutMode, icon:<AlignJustify size={13} />, label:"Horizontal" },
        ]).map(o => (
          <button key={o.id} onClick={() => onLayout(o.id)} style={{
            display:"flex", alignItems:"center", gap:5,
            padding:"5px 11px", border:"none", cursor:"pointer", fontSize:12, fontFamily:ff,
            backgroundColor: layout === o.id ? C.primary : "transparent",
            color: layout === o.id ? "#fff" : C.textSm,
            transition:"all 0.1s",
          }}>
            {o.icon}{o.label}
          </button>
        ))}
      </div>

      <div style={{ width:1, height:24, backgroundColor:C.border }} />

      {/* Action buttons */}
      {[
        { id:"import",       icon:<Upload size={13} />,   label:"Import",       outline:true  },
        { id:"simulate",     icon:<Activity size={13} />, label:"Simulate",     outline:true  },
        { id:"fit-selected", icon:<Play size={13} />,     label:"Fit Selected", outline:false },
        { id:"stop",         icon:<Square size={13} />,   label:"Stop",         outline:true, disabled:!isRunning },
        { id:"export",       icon:<Download size={13} />, label:"Export",       outline:true  },
      ].map(b => (
        <button
          key={b.id}
          onClick={() => onAction(b.id)}
          disabled={b.disabled}
          style={{
            display:"flex", alignItems:"center", gap:5,
            padding:"5px 11px", borderRadius:4, cursor:b.disabled?"default":"pointer",
            fontSize:12, fontWeight:500, fontFamily:ff,
            border: b.outline ? `1px solid ${C.border}` : "none",
            backgroundColor: !b.outline && !b.disabled ? C.primary : b.disabled ? C.pageBg : C.panelBg,
            color: !b.outline && !b.disabled ? "#fff" : b.disabled ? C.textXs : C.text,
            opacity: b.disabled ? 0.5 : 1,
          }}
        >
          {b.icon}{b.label}
        </button>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FIT PROJECT TREE
════════════════════════════════════════════════════════════════ */
function FitProjectTree({
  treeData, checkedFeatures, checkedChildren, expandedFeatures,
  selectedId, onToggleFeature, onToggleChild, onToggleExpand, onSelect, onAddStep,
}: {
  treeData: TreeFeature[];
  checkedFeatures: Set<string>;
  checkedChildren: Set<string>;
  expandedFeatures: Set<string>;
  selectedId: string|null;
  onToggleFeature: (id: string) => void;
  onToggleChild: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onAddStep: (featureId: string) => void;
}) {
  return (
    <div style={{ flex:1, overflowY:"auto", fontSize:11, fontFamily:ff }}>
      <div style={{ padding:"7px 10px 4px", borderBottom:`1px solid ${C.border}`, fontSize:10, color:C.textXs, textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:600 }}>
        Fit Project
      </div>
      {treeData.map(feat => {
        const isNext = feat.tag === "next";
        const isExpanded = expandedFeatures.has(feat.id);
        const isFeatChecked = checkedFeatures.has(feat.id);

        return (
          <div key={feat.id}>
            {/* Feature row */}
            <div
              onClick={() => onSelect(feat.id)}
              style={{
                display:"flex", alignItems:"center", gap:5,
                padding:"5px 10px 5px 6px",
                backgroundColor: selectedId === feat.id ? C.selectedBg : "transparent",
                borderLeft: selectedId === feat.id ? `2px solid ${C.selectedBdr}` : "2px solid transparent",
                cursor:"pointer",
                userSelect:"none",
              }}
              onMouseEnter={e => { if (selectedId !== feat.id) (e.currentTarget as HTMLElement).style.backgroundColor = "#EFF1F4"; }}
              onMouseLeave={e => { if (selectedId !== feat.id) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
            >
              {/* Expand toggle */}
              <button
                onClick={e => { e.stopPropagation(); onToggleExpand(feat.id); }}
                style={{ border:"none", background:"transparent", cursor:"pointer", padding:0, display:"flex", color:C.textSm, flexShrink:0 }}
              >
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>

              {/* Checkbox */}
              <div
                onClick={e => { e.stopPropagation(); if (!isNext) onToggleFeature(feat.id); }}
                style={{
                  width:13, height:13, borderRadius:3, flexShrink:0,
                  border:`1.5px solid ${isFeatChecked && !isNext ? C.primary : C.borderMd}`,
                  backgroundColor: isFeatChecked && !isNext ? C.primary : isNext ? C.pageBg : "#fff",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  cursor: isNext ? "default" : "pointer",
                }}
              >
                {isFeatChecked && !isNext && (
                  <div style={{ width:7, height:7, backgroundColor:"#fff", borderRadius:1, clipPath:"polygon(14% 44%,0 65%,50% 100%,100% 16%,80% 0%,43% 62%)" }} />
                )}
              </div>

              <span style={{ flex:1, fontWeight:600, fontSize:11, color: isNext ? C.textXs : C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {feat.label}
              </span>

              {/* Tag */}
              <span style={{
                fontSize:9, padding:"1px 5px", borderRadius:2, fontWeight:600, letterSpacing:"0.04em",
                backgroundColor: isNext ? "#F0F1F3" : C.primaryLt,
                color: isNext ? C.textXs : C.primary,
              }}>
                {feat.tag.toUpperCase()}
              </span>
            </div>

            {/* Children */}
            {isExpanded && (
              <div>
                {feat.children.map(child => {
                  const isChildChecked = checkedChildren.has(child.id);
                  const isSelected = selectedId === child.id;
                  return (
                    <div
                      key={child.id}
                      onClick={() => onSelect(child.id)}
                      style={{
                        display:"flex", alignItems:"center", gap:5,
                        padding:"4px 10px 4px 28px",
                        backgroundColor: isSelected ? C.selectedBg : "transparent",
                        borderLeft: isSelected ? `2px solid ${C.selectedBdr}` : "2px solid transparent",
                        cursor:"pointer",
                      }}
                      onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = "#EFF1F4"; }}
                      onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                    >
                      {/* Child checkbox */}
                      <div
                        onClick={e => { e.stopPropagation(); if (!isNext) onToggleChild(child.id); }}
                        style={{
                          width:12, height:12, borderRadius:2, flexShrink:0,
                          border:`1.5px solid ${isChildChecked && !isNext ? C.primary : C.borderMd}`,
                          backgroundColor: isChildChecked && !isNext ? C.primary : isNext ? C.pageBg : "#fff",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          cursor: isNext ? "default" : "pointer",
                        }}
                      >
                        {isChildChecked && !isNext && (
                          <div style={{ width:6, height:6, backgroundColor:"#fff", borderRadius:1, clipPath:"polygon(14% 44%,0 65%,50% 100%,100% 16%,80% 0%,43% 62%)" }} />
                        )}
                      </div>

                      <StatusIcon status={child.status} />

                      <span style={{ flex:1, color: isNext ? C.textXs : C.textMd, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontSize:11 }}>
                        {child.label}
                      </span>

                      {child.r2 && (
                        <span style={{ fontSize:10, fontFamily:mono, color:C.success, flexShrink:0 }}>{child.r2}</span>
                      )}
                      {child.pts > 0 && (
                        <span style={{ fontSize:9, color:C.textXs, flexShrink:0 }}>{child.pts}pt</span>
                      )}
                    </div>
                  );
                })}

                {/* Add step button */}
                {feat.canAdd && !isNext && (
                  <button
                    onClick={() => onAddStep(feat.id)}
                    style={{
                      display:"flex", alignItems:"center", gap:5,
                      padding:"3px 10px 4px 32px", border:"none", cursor:"pointer",
                      backgroundColor:"transparent", fontFamily:ff, width:"100%",
                      color:C.primary, fontSize:10,
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "#EFF1F4"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"}
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

/* ═══════════════════════════════════════════════════════════════
   SELECTED ITEM PANEL
════════════════════════════════════════════════════════════════ */
function SelectedItemPanel({ selectedId, treeData }: {
  selectedId: string|null; treeData: TreeFeature[];
}) {
  const info = useMemo(() => {
    if (!selectedId) return null;
    for (const feat of treeData) {
      if (feat.id === selectedId) return { type:"feature", feat, child:null };
      for (const child of feat.children) {
        if (child.id === selectedId) return { type:"child", feat, child };
      }
    }
    return null;
  }, [selectedId, treeData]);

  return (
    <div style={{ borderTop:`1px solid ${C.border}`, backgroundColor:C.panelBg, padding:"8px 10px", flexShrink:0 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
        <span style={{ fontSize:10, fontWeight:600, color:C.textSm, textTransform:"uppercase", letterSpacing:"0.05em" }}>Selected</span>
        {info && (
          <button style={{ fontSize:10, padding:"2px 7px", borderRadius:3, border:`1px solid ${C.border}`, backgroundColor:C.panelBg, cursor:"pointer", color:C.textMd, fontFamily:ff }}>
            Edit
          </button>
        )}
      </div>
      {info?.child ? (
        <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
          {[
            ["Type",   info.child.type || "—"],
            ["Bias",   info.child.bias || "—"],
            ["Range",  info.child.range || "—"],
            ["CSV",    info.child.csvFile || "—"],
            ["Weight", info.child.weight != null ? String(info.child.weight) : "—"],
            ["Status", info.child.status],
          ].map(([k, v]) => (
            <div key={k} style={{ display:"flex", gap:6, fontSize:10 }}>
              <span style={{ color:C.textXs, width:44, flexShrink:0 }}>{k}</span>
              <span style={{ color:C.text, fontFamily: k==="CSV" ? mono : ff, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{v}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize:10, color:C.textXs, fontStyle:"italic" }}>
          {selectedId ? "Select a step for details" : "No item selected"}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CONTROL PANEL (middle)
════════════════════════════════════════════════════════════════ */
function SectionTitle({ label }: { label: string }) {
  return (
    <div style={{ fontSize:10, fontWeight:700, color:C.textSm, textTransform:"uppercase", letterSpacing:"0.06em", padding:"9px 12px 5px", borderBottom:`1px solid ${C.border}`, backgroundColor:C.pageBg }}>
      {label}
    </div>
  );
}

function FitScopePanel({ scope, activeFeatureIds, treeData }: {
  scope: FitScope; activeFeatureIds: string[]; treeData: TreeFeature[];
}) {
  const scopeLabel = scope === "none" ? "No Fit Target" : scope === "single" ? "Auto Single Fit" : "Auto Joint Fit";
  const scopeColor = scope === "none" ? C.textXs : scope === "single" ? C.primary : C.warning;
  const scopeBg    = scope === "none" ? C.pageBg : scope === "single" ? C.primaryLt : C.warningLt;

  return (
    <div>
      <SectionTitle label="Fit Scope" />
      <div style={{ padding:"8px 12px", display:"flex", flexDirection:"column", gap:7 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:12, fontWeight:700, color:scopeColor }}>{scopeLabel}</span>
          <span style={{ fontSize:10, padding:"2px 7px", borderRadius:3, backgroundColor:scopeBg, color:scopeColor, fontWeight:600 }}>
            {activeFeatureIds.length} characteristics
          </span>
        </div>
        <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
          {activeFeatureIds.map(fid => {
            const feat = treeData.find(f => f.id === fid);
            return feat ? (
              <span key={fid} style={{ fontSize:10, padding:"2px 7px", borderRadius:3, backgroundColor:C.primaryLt, color:C.primary, fontWeight:600, border:`1px solid ${C.primary}30` }}>
                {feat.label.split(" / ")[0]}
              </span>
            ) : null;
          })}
        </div>
        <div style={{ fontSize:10, color:C.textSm, lineHeight:1.6 }}>
          勾选的特性共同进入 residual，共享同一组 BSIM 模型参数。
        </div>
      </div>
    </div>
  );
}

function StopConditionsPanel({ preset, onPreset }: {
  preset: StopPreset; onPreset: (p: StopPreset) => void;
}) {
  const vals: Record<StopPreset, Record<string,string>> = {
    fast:     { r2log:"0.97", r2lin:"0.96", ftol:"1e-5", xtol:"1e-5", gtol:"1e-5", maxEvals:"500"  },
    standard: { r2log:"0.99", r2lin:"0.99", ftol:"1e-7", xtol:"1e-7", gtol:"1e-7", maxEvals:"2000" },
    fine:     { r2log:"0.999",r2lin:"0.999",ftol:"1e-9", xtol:"1e-9", gtol:"1e-9", maxEvals:"10000"},
    custom:   { r2log:"0.99", r2lin:"0.99", ftol:"1e-7", xtol:"1e-7", gtol:"1e-7", maxEvals:"5000" },
  };
  const v = vals[preset];
  return (
    <div>
      <SectionTitle label="Stop Conditions" />
      <div style={{ padding:"8px 12px", display:"flex", flexDirection:"column", gap:6 }}>
        {/* Presets */}
        <div style={{ display:"flex", gap:4, marginBottom:2 }}>
          {(["fast","standard","fine","custom"] as StopPreset[]).map(p => (
            <button key={p} onClick={() => onPreset(p)} style={{
              flex:1, padding:"3px 0", borderRadius:3, border:`1px solid ${preset===p ? C.primary : C.border}`,
              backgroundColor: preset===p ? C.primaryLt : "transparent",
              color: preset===p ? C.primary : C.textSm,
              fontSize:9.5, fontWeight:600, cursor:"pointer", fontFamily:ff, textTransform:"capitalize",
            }}>
              {p==="fast"?"快速":p==="standard"?"标准":p==="fine"?"精细":"自定义"}
            </button>
          ))}
        </div>
        {[
          ["R² log",    "r2log",   v.r2log  ],
          ["R² linear", "r2lin",   v.r2lin  ],
          ["ftol",      "ftol",    v.ftol   ],
          ["xtol",      "xtol",    v.xtol   ],
          ["gtol",      "gtol",    v.gtol   ],
          ["max evals", "maxEvals",v.maxEvals],
        ].map(([label, , val]) => (
          <div key={label} style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:10, color:C.textSm, width:62, flexShrink:0 }}>{label}</span>
            <input
              defaultValue={val}
              style={{
                flex:1, padding:"2px 6px", borderRadius:3, border:`1px solid ${C.border}`,
                fontSize:10, fontFamily:mono, color:C.text, backgroundColor:C.pageBg, outline:"none",
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function PowerMosPanel() {
  return (
    <div>
      <SectionTitle label="Power MOS Parameters" />
      <div style={{ padding:"7px 12px", display:"flex", flexDirection:"column", gap:5 }}>
        {[
          ["AA",        "10.0", "mm²"],
          ["CellPitch", "2.0",  "µm" ],
        ].map(([name, val, unit]) => (
          <div key={name} style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:10, color:C.textSm, width:62, flexShrink:0, fontFamily:mono }}>{name}</span>
            <input
              defaultValue={val}
              style={{ width:60, padding:"2px 6px", borderRadius:3, border:`1px solid ${C.border}`, fontSize:10, fontFamily:mono, color:C.text, backgroundColor:C.pageBg, outline:"none" }}
            />
            <span style={{ fontSize:10, color:C.textXs }}>{unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BsimParamsPanel({ params, onToggleActive, onToggleLock }: {
  params: BsimParam[];
  onToggleActive: (name: string) => void;
  onToggleLock: (name: string) => void;
}) {
  const [hoveredDesc, setHoveredDesc] = useState<string|null>(null);

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", minHeight:0 }}>
      <SectionTitle label="BSIM Parameters" />
      {hoveredDesc && (
        <div style={{ padding:"5px 10px", backgroundColor:C.primaryLt, fontSize:10, color:C.primaryDk, lineHeight:1.5, borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
          {hoveredDesc}
        </div>
      )}
      <div style={{ flex:1, overflowY:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
          <thead style={{ position:"sticky", top:0, backgroundColor:"#F0F3F6", zIndex:1 }}>
            <tr>
              <th style={thStyle}></th>
              <th style={thStyle}></th>
              <th style={{ ...thStyle, textAlign:"left" }}>参数</th>
              <th style={{ ...thStyle, textAlign:"left", color:C.textXs }}>说明</th>
              <th style={{ ...thStyle, textAlign:"right" }}>值</th>
              <th style={{ ...thStyle, textAlign:"left" }}>单位</th>
            </tr>
          </thead>
          <tbody>
            {params.map(p => (
              <tr
                key={p.name}
                style={{ borderBottom:`1px solid ${C.border}`, opacity: p.locked ? 0.55 : 1 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#EFF2F5"; setHoveredDesc(p.descFull); }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; setHoveredDesc(null); }}
              >
                {/* Active checkbox */}
                <td style={tdStyle}>
                  <div
                    onClick={() => onToggleActive(p.name)}
                    style={{
                      width:11, height:11, borderRadius:2,
                      border:`1.5px solid ${p.active ? C.primary : C.borderMd}`,
                      backgroundColor: p.active ? C.primary : "transparent",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      cursor:"pointer", flexShrink:0,
                    }}
                  >
                    {p.active && <div style={{ width:5, height:5, backgroundColor:"#fff", borderRadius:1, clipPath:"polygon(14% 44%,0 65%,50% 100%,100% 16%,80% 0%,43% 62%)" }} />}
                  </div>
                </td>
                {/* Lock */}
                <td style={tdStyle}>
                  <button
                    onClick={() => onToggleLock(p.name)}
                    style={{ border:"none", background:"transparent", cursor:"pointer", padding:0, display:"flex", color: p.locked ? C.warning : C.textXs }}
                  >
                    {p.locked ? <Lock size={10} /> : <Unlock size={10} />}
                  </button>
                </td>
                {/* Name */}
                <td style={{ ...tdStyle, fontFamily:mono, fontWeight:600, color: p.locked ? C.textXs : C.primary, cursor:"default" }}>
                  {p.name}
                </td>
                {/* Desc */}
                <td style={{ ...tdStyle, color:C.textXs, maxWidth:90, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {p.descShort}
                </td>
                {/* Value */}
                <td style={{ ...tdStyle, textAlign:"right", fontFamily:mono, color: p.locked ? C.textXs : C.text }}>
                  {p.value}
                </td>
                {/* Unit */}
                <td style={{ ...tdStyle, color:C.textXs, whiteSpace:"nowrap" }}>
                  {p.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding:"4px 5px", borderBottom:`1px solid ${C.border}`, color:C.textXs, fontWeight:600,
  fontSize:9.5, textAlign:"center", whiteSpace:"nowrap",
};
const tdStyle: React.CSSProperties = {
  padding:"4px 5px",
};

/* ═══════════════════════════════════════════════════════════════
   PLOT CARD
════════════════════════════════════════════════════════════════ */
interface PlotCardProps {
  id: string;
  title: string;
  status: FitStatus;
  r2log: number|null;
  r2lin: number|null;
  rms: string|null;
  weight: number;
  xLabel: string;
  yLabel: string;
  measData: { x: number; meas: number; sim: number|null }[];
  isActive: boolean;
  onSelect: () => void;
}

function PlotCard({ id, title, status, r2log, r2lin, rms, weight, xLabel, yLabel, measData, isActive, onSelect }: PlotCardProps) {
  const [isLog, setIsLog] = useState(yLabel.includes("Id") && xLabel.includes("Vgs"));
  const hasSim = measData.some(d => d.sim !== null);

  const statusMeta: Record<FitStatus,{label:string;color:string;bg:string}> = {
    done:    { label:"fitted",  color:C.success, bg:C.successLt },
    queued:  { label:"queued",  color:C.textXs,  bg:"#EAECF0"   },
    running: { label:"running", color:C.primary, bg:C.primaryLt },
    empty:   { label:"idle",    color:C.textXs,  bg:"#EAECF0"   },
    error:   { label:"error",   color:C.error,   bg:C.errorLt   },
  };
  const sm = statusMeta[status];

  const measPoints = measData.map(d => ({ x: d.x, y: d.meas }));
  const simPoints  = hasSim ? measData.filter(d => d.sim !== null).map(d => ({ x: d.x, y: d.sim as number })) : [];

  // For recharts LineChart: use a combined data array
  const chartData = measData.map(d => ({
    x: d.x,
    measured: Math.max(d.meas, isLog ? 1e-11 : 0),
    simulated: d.sim !== null ? Math.max(d.sim, isLog ? 1e-11 : 0) : undefined,
  }));

  return (
    <div
      onClick={onSelect}
      style={{
        backgroundColor:C.panelBg, borderRadius:5,
        border:`1.5px solid ${isActive ? C.primary : C.border}`,
        display:"flex", flexDirection:"column", cursor:"pointer", overflow:"hidden",
        boxShadow: isActive ? `0 0 0 1px ${C.primaryLt}` : "none",
        transition:"border-color 0.1s",
      }}
    >
      {/* Card header */}
      <div style={{ display:"flex", alignItems:"center", padding:"5px 8px 5px", borderBottom:`1px solid ${C.border}`, gap:7, flexShrink:0 }}>
        <span style={{ fontSize:11, fontWeight:600, color:C.text, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{title}</span>
        <span style={{ fontSize:9.5, padding:"1px 6px", borderRadius:3, backgroundColor:sm.bg, color:sm.color, fontWeight:600 }}>{sm.label}</span>
        <button
          onClick={e => { e.stopPropagation(); setIsLog(v => !v); }}
          style={{ border:`1px solid ${C.border}`, borderRadius:3, backgroundColor:isLog?C.primaryLt:"transparent", color:isLog?C.primary:C.textXs, fontSize:9, padding:"1px 5px", cursor:"pointer", fontFamily:mono }}
        >
          {isLog ? "log" : "lin"}
        </button>
        <button style={{ border:"none", background:"transparent", cursor:"pointer", color:C.textXs, padding:2, display:"flex" }}><Pin size={11} /></button>
        <button style={{ border:"none", background:"transparent", cursor:"pointer", color:C.textXs, padding:2, display:"flex" }}><MoreHorizontal size={11} /></button>
      </div>

      {/* Chart */}
      <div style={{ flex:1, minHeight:0, padding:"4px 0 0" }}>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top:4, right:14, bottom:18, left:10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="x" tick={{ fontSize:9, fontFamily:mono, fill:C.textXs }}
                label={{ value:xLabel, position:"insideBottom", offset:-10, style:{ fontSize:9, fill:C.textXs } }} />
              <YAxis scale={isLog ? "log" : "auto"} domain={isLog ? [1e-11,"auto"] : ["auto","auto"]}
                tick={{ fontSize:9, fontFamily:mono, fill:C.textXs }}
                tickFormatter={v => v < 0.001 ? v.toExponential(0) : v.toFixed(2)}
                label={{ value:yLabel, angle:-90, position:"insideLeft", offset:8, style:{ fontSize:9, fill:C.textXs } }} />
              <Tooltip
                formatter={(v:number) => [v < 0.001 ? v.toExponential(3) : v.toFixed(4), ""]}
                contentStyle={{ fontSize:9, fontFamily:mono, border:`1px solid ${C.border}`, borderRadius:3 }} />
              {/* Measured: dots only (strokeWidth=0) */}
              <Line type="monotone" dataKey="measured" name="Measured"
                stroke={C.measured} strokeWidth={0}
                dot={{ r:2.5, fill:C.measured, stroke:C.measured }} isAnimationActive={false} connectNulls />
              {/* Simulated: dots only */}
              {hasSim && (
                <Line type="monotone" dataKey="simulated" name="Simulated"
                  stroke={C.simulated} strokeWidth={0}
                  dot={{ r:2, fill:C.simulated, stroke:C.simulated }} isAnimationActive={false} connectNulls />
              )}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", color:C.textXs, fontSize:10 }}>
            <BarChart2 size={20} color={C.border} />
          </div>
        )}
      </div>

      {/* Metrics footer */}
      <div style={{ display:"flex", borderTop:`1px solid ${C.border}`, padding:"4px 8px", gap:12, flexShrink:0 }}>
        {[
          { label:"R²log",  val:r2log != null ? r2log.toFixed(4) : "—" },
          { label:"R²lin",  val:r2lin != null ? r2lin.toFixed(4) : "—" },
          { label:"RMS",    val:rms ?? "—" },
          { label:"Weight", val:String(weight) },
        ].map(m => (
          <div key={m.label} style={{ display:"flex", gap:4, alignItems:"baseline" }}>
            <span style={{ fontSize:9, color:C.textXs }}>{m.label}</span>
            <span style={{ fontSize:9.5, fontFamily:mono, color: m.val !== "—" ? C.text : C.textXs, fontWeight: m.val !== "—" ? 600 : 400 }}>{m.val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PLOT BOARD
════════════════════════════════════════════════════════════════ */
interface PlotBoardProps {
  layout: LayoutMode;
  activePlotId: string|null;
  onSelectPlot: (id: string) => void;
  checkedFeatures: Set<string>;
  treeData: TreeFeature[];
}

const PLOT_META: Record<string,{ title:string; xLabel:string; yLabel:string; r2log:number|null; r2lin:number|null; rms:string|null; weight:number; iters:number|null; vParam:number; isIdVg:boolean }> = {
  "idvg_05":  { title:"IdVg @ Vds=0.5V", xLabel:"Vgs (V)", yLabel:"Id (A)", r2log:0.9991, r2lin:0.9987, rms:"2.1 mA",  weight:1.0, iters:54,  vParam:0.5, isIdVg:true  },
  "idvg_5":   { title:"IdVg @ Vds=5V",   xLabel:"Vgs (V)", yLabel:"Id (A)", r2log:0.9973, r2lin:0.9965, rms:"8.3 mA",  weight:1.0, iters:97,  vParam:5.0, isIdVg:true  },
  "idvd_5":   { title:"IdVd @ Vgs=5V",   xLabel:"Vds (V)", yLabel:"Id (A)", r2log:0.9942, r2lin:0.9938, rms:"31 mA",   weight:1.0, iters:134, vParam:5.0, isIdVg:false },
  "idvd_6":   { title:"IdVd @ Vgs=6V",   xLabel:"Vds (V)", yLabel:"Id (A)", r2log:null,   r2lin:null,   rms:null,      weight:1.0, iters:null, vParam:6.0, isIdVg:false },
  "idvd_10":  { title:"IdVd @ Vgs=10V",  xLabel:"Vds (V)", yLabel:"Id (A)", r2log:null,   r2lin:null,   rms:null,      weight:1.0, iters:null, vParam:10.0,isIdVg:false },
};

function PlotBoard({ layout, activePlotId, onSelectPlot, checkedFeatures, treeData }: PlotBoardProps) {
  const visiblePlots = useMemo(() => {
    const ids: string[] = [];
    for (const feat of treeData) {
      if (!checkedFeatures.has(feat.id)) continue;
      for (const child of feat.children) {
        if (PLOT_META[child.id] && child.status !== "empty") ids.push(child.id);
      }
    }
    return ids;
  }, [checkedFeatures, treeData]);

  const gridStyle: React.CSSProperties = layout === "grid"
    ? { display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, padding:12 }
    : layout === "vertical"
    ? { display:"flex", flexDirection:"column", gap:10, padding:12 }
    : { display:"flex", flexDirection:"row", gap:10, padding:12, alignItems:"stretch" };

  const cardHeightStyle: React.CSSProperties = layout === "horizontal"
    ? { width:280, flexShrink:0, height:"100%" }
    : layout === "vertical"
    ? { height:220 }
    : { height:220 };

  return (
    <div style={{ flex:1, overflowY: layout === "horizontal" ? "hidden" : "auto", overflowX: layout === "horizontal" ? "auto" : "hidden" }}>
      <div style={gridStyle}>
        {visiblePlots.map(plotId => {
          const meta = PLOT_META[plotId];
          if (!meta) return null;
          const child = treeData.flatMap(f => f.children).find(c => c.id === plotId);
          if (!child) return null;
          const status = child.status;
          const hasSim = status === "done" || status === "running";
          const data = meta.isIdVg
            ? genIdVg(meta.vParam, hasSim, plotId.length * 7 + meta.vParam * 13)
            : genIdVd(meta.vParam, hasSim, plotId.length * 11 + meta.vParam * 17);

          return (
            <div key={plotId} style={cardHeightStyle}>
              <PlotCard
                id={plotId}
                title={meta.title}
                status={status}
                r2log={meta.r2log}
                r2lin={meta.r2lin}
                rms={meta.rms}
                weight={meta.weight}
                xLabel={meta.xLabel}
                yLabel={meta.yLabel}
                measData={data}
                isActive={activePlotId === plotId}
                onSelect={() => onSelectPlot(plotId)}
              />
            </div>
          );
        })}
        {visiblePlots.length === 0 && (
          <div style={{ gridColumn:"1/-1", padding:40, textAlign:"center", color:C.textXs, fontSize:12 }}>
            <BarChart2 size={28} color={C.border} style={{ margin:"0 auto 8px" }} />
            <div>勾选左侧特性以显示曲线图</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   BOTTOM PANEL (Convergence + Fit Queue)
════════════════════════════════════════════════════════════════ */
function BottomPanel({ activePlotId, treeData }: {
  activePlotId: string|null; treeData: TreeFeature[];
}) {
  const plotMeta = activePlotId ? PLOT_META[activePlotId] : null;
  const child = activePlotId ? treeData.flatMap(f => f.children).find(c => c.id === activePlotId) : null;
  const hasData = child?.status === "done" && plotMeta?.iters != null && plotMeta.r2log != null;

  const convData = hasData
    ? genConvergence(plotMeta!.r2log!, plotMeta!.iters!, activePlotId!.length * 13 + 7)
    : [];

  return (
    <div style={{
      height:162, borderTop:`1px solid ${C.border}`, display:"flex", flexShrink:0,
      backgroundColor:C.panelBg,
    }}>
      {/* Convergence */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", borderRight:`1px solid ${C.border}` }}>
        <div style={{ padding:"5px 12px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          <span style={{ fontSize:10, fontWeight:600, color:C.textSm, textTransform:"uppercase", letterSpacing:"0.05em" }}>Convergence</span>
          {plotMeta && <span style={{ fontSize:10, color:C.textXs }}>— {plotMeta.title}</span>}
          <div style={{ flex:1 }} />
          {hasData && [
            ["R²log",  plotMeta!.r2log?.toFixed(4)],
            ["R²lin",  plotMeta!.r2lin?.toFixed(4)],
            ["iters",  String(plotMeta!.iters)],
          ].map(([k,v]) => (
            <span key={k} style={{ fontSize:9.5, color:C.textXs }}>
              <span style={{ color:C.textXs }}>{k} </span>
              <span style={{ fontFamily:mono, fontWeight:700, color:C.text }}>{v}</span>
            </span>
          ))}
        </div>
        <div style={{ flex:1 }}>
          {hasData && convData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={convData} margin={{ top:4, right:14, bottom:18, left:10 }}>
                <CartesianGrid strokeDasharray="2 2" stroke={C.border} />
                <XAxis dataKey="iter" tick={{ fontSize:9, fontFamily:mono, fill:C.textXs }}
                  label={{ value:"Iteration", position:"insideBottom", offset:-10, style:{ fontSize:9, fill:C.textXs } }} />
                <YAxis domain={[0.5,1]} tick={{ fontSize:9, fontFamily:mono, fill:C.textXs }} tickFormatter={v => v.toFixed(2)} />
                <Tooltip contentStyle={{ fontSize:9, fontFamily:mono, border:`1px solid ${C.border}`, borderRadius:3 }} />
                <Legend wrapperStyle={{ fontSize:9, paddingTop:2 }} />
                <Line type="monotone" dataKey="r2log" name="R²log" stroke={C.primary} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="r2lin" name="R²lin" stroke={C.success} strokeWidth={1.5} dot={false} strokeDasharray="4 2" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", color:C.textXs, fontSize:10, gap:6 }}>
              <Activity size={14} color={C.border} />
              {activePlotId ? "No convergence data — run Fit first" : "Select a plot card to view convergence"}
            </div>
          )}
        </div>
      </div>

      {/* Fit Queue */}
      <div style={{ width:340, display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"5px 12px", borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
          <span style={{ fontSize:10, fontWeight:600, color:C.textSm, textTransform:"uppercase", letterSpacing:"0.05em" }}>Fit Queue</span>
        </div>
        <div style={{ flex:1, overflowY:"auto" }}>
          {QUEUE_ITEMS.map(q => {
            const statusColor = q.status === "done" ? C.success : q.status === "running" ? C.primary : C.textXs;
            const statusBg    = q.status === "done" ? C.successLt : q.status === "running" ? C.primaryLt : C.pageBg;
            return (
              <div key={q.id} style={{ padding:"6px 12px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:8 }}>
                <StatusIcon status={q.status === "done" ? "done" : q.status === "running" ? "running" : "queued"} />
                <span style={{ fontSize:11, color:C.textMd, flex:1 }}>{q.label}</span>
                {/* Progress bar */}
                <div style={{ width:60, height:4, backgroundColor:C.border, borderRadius:2, overflow:"hidden" }}>
                  <div style={{ width:`${q.progress}%`, height:"100%", backgroundColor:statusColor, borderRadius:2, transition:"width 0.3s" }} />
                </div>
                <span style={{ fontSize:9, fontFamily:mono, minWidth:28, textAlign:"right", color:statusColor }}>{q.progress}%</span>
                {q.metric && (
                  <span style={{ fontSize:9, fontFamily:mono, color:C.text, backgroundColor:statusBg, padding:"1px 5px", borderRadius:3 }}>{q.metric}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN WORKBENCH COMPONENT
════════════════════════════════════════════════════════════════ */
export function Workbench() {
  /* ── tree state ─────────────────────────────────────────── */
  const [checkedFeatures, setCheckedFeatures] = useState<Set<string>>(
    () => new Set(TREE_DATA.map(f => f.id))
  );
  const [checkedChildren, setCheckedChildren] = useState<Set<string>>(
    () => new Set(TREE_DATA.flatMap(f => f.children.map(c => c.id)))
  );
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(
    () => new Set(["idvg","idvd"])
  );
  const [selectedId, setSelectedId] = useState<string|null>("idvg_05");
  const [treeData, setTreeData] = useState<TreeFeature[]>(TREE_DATA);

  /* ── layout / plot ─────────────────────────────────────── */
  const [layout, setLayout] = useState<LayoutMode>("grid");
  const [activePlotId, setActivePlotId] = useState<string|null>("idvg_05");

  /* ── stop conditions ────────────────────────────────────── */
  const [stopPreset, setStopPreset] = useState<StopPreset>("standard");

  /* ── BSIM params ────────────────────────────────────────── */
  const [bsimParams, setBsimParams] = useState<BsimParam[]>(INIT_PARAMS);
  const toggleActive = (name: string) =>
    setBsimParams(prev => prev.map(p => p.name === name ? { ...p, active: !p.active } : p));
  const toggleLock = (name: string) =>
    setBsimParams(prev => prev.map(p => p.name === name ? { ...p, locked: !p.locked } : p));

  /* ── fit scope derived ──────────────────────────────────── */
  const activeFeatureIds = useMemo(
    () => TREE_DATA.filter(f => f.tag === "live" && checkedFeatures.has(f.id)).map(f => f.id),
    [checkedFeatures]
  );
  const fitScope: FitScope = activeFeatureIds.length === 0 ? "none" : activeFeatureIds.length === 1 ? "single" : "joint";

  /* ── handlers ───────────────────────────────────────────── */
  const toggleFeature = (id: string) =>
    setCheckedFeatures(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleChild = (id: string) =>
    setCheckedChildren(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleExpand = (id: string) =>
    setExpandedFeatures(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const handleAddStep = (featureId: string) => {
    setTreeData(prev => prev.map(feat => {
      if (feat.id !== featureId) return feat;
      const lastChild = feat.children[feat.children.length - 1];
      const newId = `${featureId}_custom${feat.children.length + 1}`;
      return {
        ...feat,
        children: [...feat.children, {
          id: newId,
          label: `${feat.id === "idvg" ? "IdVg @ Vds" : "IdVd @ Vgs"}=custom V`,
          status: "empty" as FitStatus, r2: null, pts: 0,
          bias: "custom", csvFile: "", range: "", weight: 1.0, type: feat.id,
        }],
      };
    }));
  };

  return (
    <div style={{
      display:"flex", flexDirection:"column", height:"100%",
      backgroundColor:C.pageBg, fontFamily:ff,
      fontSize:12, overflow:"hidden",
    }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        ::-webkit-scrollbar { width:5px; height:5px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:${C.borderMd}; border-radius:3px; }
      `}</style>

      {/* 1. Menu bar */}
      <MenuBar
        onViewLayout={l => setLayout(l)}
        onFitAction={a => console.log("fit action:", a)}
      />

      {/* 2. Toolbar */}
      <Toolbar
        layout={layout}
        onLayout={setLayout}
        isRunning={false}
        onAction={a => console.log("toolbar action:", a)}
      />

      {/* 3. Main area */}
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>

        {/* Left: Fit Project Tree */}
        <div style={{
          width:280, minWidth:280, display:"flex", flexDirection:"column",
          borderRight:`1px solid ${C.border}`, backgroundColor:C.panelBg, overflow:"hidden",
        }}>
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
          />
          <SelectedItemPanel selectedId={selectedId} treeData={treeData} />
        </div>

        {/* Middle: Control Panel */}
        <div style={{
          width:320, minWidth:320, display:"flex", flexDirection:"column",
          borderRight:`1px solid ${C.border}`, backgroundColor:C.panelBg, overflow:"hidden",
        }}>
          <FitScopePanel scope={fitScope} activeFeatureIds={activeFeatureIds} treeData={treeData} />
          <div style={{ height:1, backgroundColor:C.border }} />
          <div style={{ overflowY:"auto", flex:"0 0 auto" }}>
            <StopConditionsPanel preset={stopPreset} onPreset={setStopPreset} />
            <div style={{ height:1, backgroundColor:C.border }} />
            <PowerMosPanel />
            <div style={{ height:1, backgroundColor:C.border }} />
          </div>
          <BsimParamsPanel
            params={bsimParams}
            onToggleActive={toggleActive}
            onToggleLock={toggleLock}
          />
        </div>

        {/* Right: Plot Board */}
        <PlotBoard
          layout={layout}
          activePlotId={activePlotId}
          onSelectPlot={setActivePlotId}
          checkedFeatures={checkedFeatures}
          treeData={treeData}
        />
      </div>

      {/* 4. Bottom Panel */}
      <BottomPanel activePlotId={activePlotId} treeData={treeData} />
    </div>
  );
}
