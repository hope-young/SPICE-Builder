// constants.ts - 应用常量

import type { BSIM3ParamSpec } from "./types";

// 颜色 (与 theme.css 的 CSS 变量对应，便于在 TS 中使用)
export const C = {
  bg: "var(--bg)",
  surface: "var(--surface)",
  border: "var(--border)",
  text: "var(--text)",
  muted: "var(--muted)",
  primary: "var(--primary)",
  primaryFg: "var(--primary-fg)",
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--error)",
  accent: "var(--accent)",
  hover: "var(--hover)",
  selected: "var(--selected)",
} as const;

// 字体
export const FF = "'Inter', 'Segoe UI', system-ui, sans-serif";
export const MONO = "'JetBrains Mono', 'Consolas', monospace";

// 字号
export const FONT = {
  xs: 10,
  sm: 11,
  base: 12,
  md: 13,
  lg: 14,
  xl: 15,
  xxl: 18,
  display: 22,
};

// 6 阶段 SGT 拟合定义
export const SGT_STAGES = [
  {
    id: 1, name: "Threshold Voltage", short: "Vth",
    description: "Extract VTH0, K1, K2 from subthreshold Id-Vg (Vds=0.5V)",
    optimizer: "Trust-Region",
    params: [
      { name: "VTH0",  init: "3.0",    fitted: "—",      bounds: "[0.5, 6.0]" },
      { name: "K1",    init: "0.5",    fitted: "—",      bounds: "[-1.0, 2.0]" },
      { name: "K2",    init: "0",      fitted: "—",      bounds: "[-1.0, 1.0]" },
      { name: "DVT0",  init: "2.2",    fitted: "—",      bounds: "[0, 10]" },
      { name: "DVT1",  init: "0.53",   fitted: "—",      bounds: "[0, 5]" },
      { name: "NFACTOR", init: "1.0", fitted: "—",      bounds: "[0.1, 5.0]" },
      { name: "CDSC",  init: "2.4e-4", fitted: "—",      bounds: "[0, 1e-2]" },
    ],
    rmse: "—", iters: 0, duration: "—",
  },
  {
    id: 2, name: "Subthreshold Slope", short: "SS",
    description: "Refine NFACTOR, CDSC from subthreshold region",
    optimizer: "Trust-Region",
    params: [
      { name: "NFACTOR", init: "1.0", fitted: "—", bounds: "[0.1, 5.0]" },
      { name: "CDSCD",   init: "0",   fitted: "—", bounds: "[0, 1e-2]" },
      { name: "CDSCB",   init: "0",   fitted: "—", bounds: "[0, 1e-2]" },
    ],
    rmse: "—", iters: 0, duration: "—",
  },
  {
    id: 3, name: "Linear Mobility", short: "μeff",
    description: "Extract U0, UA, UB, UC from Id-Vg (Vds=0.5V)",
    optimizer: "Trust-Region",
    params: [
      { name: "U0", init: "100",  fitted: "—", bounds: "[10, 1500]" },
      { name: "UA", init: "2e-9", fitted: "—", bounds: "[-1e-8, 1e-8]" },
      { name: "UB", init: "5e-17", fitted: "—", bounds: "[-1e-16, 1e-16]" },
      { name: "UC", init: "1e-10", fitted: "—", bounds: "[-1e-9, 1e-9]" },
    ],
    rmse: "—", iters: 0, duration: "—",
  },
  {
    id: 4, name: "Saturation Velocity", short: "VSAT",
    description: "Extract VSAT, A0, AGS, KETA, RD, RS from Id-Vd",
    optimizer: "Trust-Region",
    params: [
      { name: "VSAT",  init: "1e5",  fitted: "—", bounds: "[1e3, 2e6]" },
      { name: "A0",    init: "1.0",  fitted: "—", bounds: "[0, 10]" },
      { name: "AGS",   init: "0",    fitted: "—", bounds: "[-1, 1]" },
      { name: "KETA",  init: "0",    fitted: "—", bounds: "[-1, 1]" },
      { name: "RD",    init: "1e-4", fitted: "—", bounds: "[0, 1]" },
      { name: "RS",    init: "1e-4", fitted: "—", bounds: "[0, 1]" },
    ],
    rmse: "—", iters: 0, duration: "—",
  },
  {
    id: 5, name: "Output Resistance", short: "Rout",
    description: "Extract PCLM, PDIBLC, DROUT, PVAG from saturation",
    optimizer: "Trust-Region",
    params: [
      { name: "PCLM",  init: "0.5",  fitted: "—", bounds: "[0, 5]" },
      { name: "PDIBLC1", init: "0.3", fitted: "—", bounds: "[0, 1]" },
      { name: "PDIBLC2", init: "0.05", fitted: "—", bounds: "[0, 0.5]" },
      { name: "DROUT", init: "0.5",  fitted: "—", bounds: "[0, 5]" },
      { name: "PVAG",  init: "1.0",  fitted: "—", bounds: "[-1, 5]" },
    ],
    rmse: "—", iters: 0, duration: "—",
  },
  {
    id: 6, name: "Capacitance Model", short: "C-V",
    description: "Extract CGSO, CGDO, MJ, MJSW, PB from C-V measurements",
    optimizer: "Differential Evolution",
    params: [
      { name: "CGSO",  init: "1e-9", fitted: "—", bounds: "[0, 5e-9]" },
      { name: "CGDO",  init: "1e-9", fitted: "—", bounds: "[0, 5e-9]" },
      { name: "CGBO",  init: "1e-10", fitted: "—", bounds: "[0, 1e-9]" },
      { name: "MJ",    init: "0.5", fitted: "—", bounds: "[0.1, 1.0]" },
      { name: "MJSW",  init: "0.33", fitted: "—", bounds: "[0.05, 0.8]" },
      { name: "PB",    init: "0.8", fitted: "—", bounds: "[0.3, 1.5]" },
      { name: "PBSW",  init: "0.8", fitted: "—", bounds: "[0.3, 1.5]" },
    ],
    rmse: "—", iters: 0, duration: "—",
  },
] as const;

// 49 个 BSIM3 参数
export const BSIM3_PARAMS: BSIM3ParamSpec[] = [
  // Threshold
  { name: "VTH0", default: 3.0, lower: 0.1, upper: 6.0, unit: "V", category: "Threshold", stage: "S1", description: "Threshold voltage @ Vbs=0" },
  { name: "K1", default: 0.5, lower: -1, upper: 2, unit: "V^0.5", category: "Threshold", stage: "S1", description: "Body effect coefficient 1" },
  { name: "K2", default: 0, lower: -1, upper: 1, unit: "V^-1", category: "Threshold", stage: "S1", description: "Body effect coefficient 2" },
  { name: "DVT0", default: 2.2, lower: 0, upper: 10, unit: "", category: "Threshold", stage: "S1", description: "Short channel Vth correction 0" },
  { name: "DVT1", default: 0.53, lower: 0, upper: 5, unit: "", category: "Threshold", stage: "S1", description: "Short channel Vth correction 1" },
  { name: "NFACTOR", default: 1.0, lower: 0.1, upper: 5, unit: "", category: "Threshold", stage: "S1", description: "Subthreshold swing factor" },
  { name: "CDSC", default: 2.4e-4, lower: 0, upper: 1e-2, unit: "F/m^2", category: "Threshold", stage: "S1", description: "Drain/source to channel coupling" },
  { name: "CDSCD", default: 0, lower: 0, upper: 1e-2, unit: "F/m^2", category: "Threshold", stage: "S2", description: "Drain-bias sensitive CDS" },
  { name: "CDSCB", default: 0, lower: 0, upper: 1e-2, unit: "F/m^2", category: "Threshold", stage: "S2", description: "Body-bias sensitive CDS" },
  // Mobility
  { name: "U0", default: 100, lower: 10, upper: 1500, unit: "cm^2/Vs", category: "Mobility", stage: "S3", description: "Low-field mobility" },
  { name: "UA", default: 2e-9, lower: -1e-8, upper: 1e-8, unit: "m/V", category: "Mobility", stage: "S3", description: "Linear Vgs mobility degradation 1" },
  { name: "UB", default: 5e-17, lower: -1e-16, upper: 1e-16, unit: "(m/V)^2", category: "Mobility", stage: "S3", description: "Linear Vgs mobility degradation 2" },
  { name: "UC", default: 1e-10, lower: -1e-9, upper: 1e-9, unit: "m/V^2", category: "Mobility", stage: "S3", description: "Vbs mobility degradation" },
  // Saturation
  { name: "VSAT", default: 1e5, lower: 1e3, upper: 2e6, unit: "m/s", category: "Saturation", stage: "S4", description: "Saturation velocity" },
  { name: "A0", default: 1, lower: 0, upper: 10, unit: "", category: "Saturation", stage: "S4", description: "Bulk charge effect coefficient" },
  { name: "AGS", default: 0, lower: -1, upper: 1, unit: "V^-1", category: "Saturation", stage: "S4", description: "Gate-bias dependent A0" },
  { name: "KETA", default: 0, lower: -1, upper: 1, unit: "V^-1", category: "Saturation", stage: "S4", description: "Body-bias dependent VSAT" },
  { name: "RD", default: 1e-4, lower: 0, upper: 1, unit: "ohm", category: "Parasitic", stage: "S4", description: "Drain series resistance" },
  { name: "RS", default: 1e-4, lower: 0, upper: 1, unit: "ohm", category: "Parasitic", stage: "S4", description: "Source series resistance" },
  // Output Resistance
  { name: "PCLM", default: 0.5, lower: 0, upper: 5, unit: "", category: "OutputRes", stage: "S5", description: "Channel length modulation" },
  { name: "PDIBLC1", default: 0.3, lower: 0, upper: 1, unit: "", category: "OutputRes", stage: "S5", description: "DIBL parameter 1" },
  { name: "PDIBLC2", default: 0.05, lower: 0, upper: 0.5, unit: "V^-1", category: "OutputRes", stage: "S5", description: "DIBL parameter 2" },
  { name: "DROUT", default: 0.5, lower: 0, upper: 5, unit: "", category: "OutputRes", stage: "S5", description: "DIBL length dependence" },
  { name: "PVAG", default: 1.0, lower: -1, upper: 5, unit: "", category: "OutputRes", stage: "S5", description: "VSAT body-bias dependence" },
  // Capacitance
  { name: "CGSO", default: 1e-9, lower: 0, upper: 5e-9, unit: "F/m", category: "Capacitance", stage: "S6", description: "Gate-source overlap cap" },
  { name: "CGDO", default: 1e-9, lower: 0, upper: 5e-9, unit: "F/m", category: "Capacitance", stage: "S6", description: "Gate-drain overlap cap" },
  { name: "CGBO", default: 1e-10, lower: 0, upper: 1e-9, unit: "F/m", category: "Capacitance", stage: "S6", description: "Gate-bulk overlap cap" },
  // Junction
  { name: "MJ", default: 0.5, lower: 0.1, upper: 1, unit: "", category: "Junction", stage: "S6", description: "Bulk junction grading" },
  { name: "MJSW", default: 0.33, lower: 0.05, upper: 0.8, unit: "", category: "Junction", stage: "S6", description: "Sidewall junction grading" },
  { name: "PB", default: 0.8, lower: 0.3, upper: 1.5, unit: "V", category: "Junction", stage: "S6", description: "Bulk junction potential" },
  { name: "PBSW", default: 0.8, lower: 0.3, upper: 1.5, unit: "V", category: "Junction", stage: "S6", description: "Sidewall junction potential" },
  { name: "TT", default: 1e-12, lower: 1e-14, upper: 1e-9, unit: "s", category: "Junction", stage: "S6", description: "Transit time" },
  // Temperature
  { name: "KT1", default: -0.11, lower: -1, upper: 1, unit: "V", category: "Temperature", stage: "S5", description: "Vth temperature coefficient 1" },
  { name: "KT2", default: 0.022, lower: -0.1, upper: 0.1, unit: "", category: "Temperature", stage: "S5", description: "Vth temperature coefficient 2" },
  { name: "UTE", default: -1.5, lower: -3, upper: 0, unit: "", category: "Temperature", stage: "S5", description: "Mobility temperature exponent" },
  { name: "UA1", default: 1e-9, lower: -1e-8, upper: 1e-8, unit: "m/V", category: "Temperature", stage: "S5", description: "UA temperature coefficient" },
  { name: "UB1", default: -1e-18, lower: -1e-17, upper: 1e-17, unit: "(m/V)^2", category: "Temperature", stage: "S5", description: "UB temperature coefficient" },
  { name: "UC1", default: -5.6e-11, lower: -1e-9, upper: 1e-9, unit: "m/V^2", category: "Temperature", stage: "S5", description: "UC temperature coefficient" },
  { name: "PRT", default: 0, lower: -10, upper: 10, unit: "ohm", category: "Temperature", stage: "S5", description: "Rds(on) temperature coefficient" },
  { name: "TNOM", default: 25, lower: -50, upper: 100, unit: "C", category: "Temperature", stage: "S5", description: "Nominal temperature" },
  // Diode (body)
  { name: "IS", default: 1e-12, lower: 1e-20, upper: 1e-3, unit: "A", category: "Diode", stage: "S6", description: "Body diode saturation current" },
  { name: "N", default: 1.5, lower: 1, upper: 5, unit: "", category: "Diode", stage: "S6", description: "Body diode ideality factor" },
  { name: "BV", default: 100, lower: 50, upper: 200, unit: "V", category: "Diode", stage: "S6", description: "Body diode breakdown voltage" },
  { name: "IBV", default: 1e-3, lower: 1e-6, upper: 1, unit: "A", category: "Diode", stage: "S6", description: "Body diode breakdown current" },
  // Gate leakage / BVGSS wrapper
  { name: "IGS0", default: 1e-12, lower: 1e-18, upper: 1e-3, unit: "A", category: "GateLeakage", stage: "S6", description: "Gate-source breakdown reference current" },
  { name: "VGSLP", default: 0.5, lower: 0.02, upper: 5, unit: "V", category: "GateLeakage", stage: "S6", description: "Gate-source breakdown soft slope" },
  { name: "BVGSP", default: 30, lower: 1, upper: 100, unit: "V", category: "GateLeakage", stage: "S6", description: "Positive gate-source breakdown voltage" },
  { name: "BVGSN", default: 30, lower: 1, upper: 100, unit: "V", category: "GateLeakage", stage: "S6", description: "Negative gate-source breakdown voltage" },
  // Process
  { name: "TOX", default: 5e-8, lower: 1e-9, upper: 1e-7, unit: "m", category: "Process", stage: "S5", description: "Gate oxide thickness" },
  { name: "XL", default: 0, lower: -1e-7, upper: 1e-7, unit: "m", category: "Process", stage: "S5", description: "L offset for mask" },
  { name: "XW", default: 0, lower: -1e-7, upper: 1e-7, unit: "m", category: "Process", stage: "S5", description: "W offset for mask" },
  { name: "DELTA", default: 0.01, lower: 0, upper: 1, unit: "", category: "Process", stage: "S5", description: "Effective Vds parameter" },
  // Doping
  { name: "NSUB", default: 1e17, lower: 1e15, upper: 1e19, unit: "cm^-3", category: "Doping", stage: "S5", description: "Substrate doping" },
];

