// types.ts - 与 Python API 对应的 TypeScript 类型

export type NavSection = "workbench" | "explore" | "settings";

export interface DeviceInfo {
  part_number: string;
  package: string;
  bvdss_v: number;
  rdson_max_mohm: number;
  id_rated_a: number;
  vth_typ_v: number;
}

export interface SpiceKeyParams {
  vth_25c_v: number;
  dvth_dt_mv_per_c: number;
  rdson_25c_10v_ohm: number;
  rdson_25c_6v_ohm: number;
  rdson_150c_10v_ohm: number;
  rdson_temp_coeff: number;
  gfs_25c_s: number;
  qg_on_20v_nc: number;
  qg_on_50v_nc: number;
  qgs_nc: number;
  qgd_nc: number;
  vgs_plateau_v: number;
  ciss_25v_pf: number;
  coss_25v_pf: number;
  crss_25v_pf: number;
  vsd_25c_v: number;
  vsd_150c_v: number;
  rg_internal_ohm: number;
}

export interface SpiceDataSet {
  device_info: DeviceInfo;
  key_params: SpiceKeyParams;
  idvg_vds5: IdVgPoint[];
  idvg_vds05: IdVgPoint[];
  idvd: IdVdPoint[];
  cv_vds: CvPoint[];
  body_diode: BodyDiodePoint[];
}

export interface IdVgPoint {
  vgs_v: number;
  id_a: number;
  vds_v: number;
  temperature_c: number;
}

export interface IdVdPoint {
  vds_v: number;
  id_a: number;
  vgs_v: number;
  temperature_c: number;
}

export interface CvPoint {
  vds_v: number;
  ciss_pf: number | null;
  coss_pf: number | null;
  crss_pf: number | null;
}

export interface BodyDiodePoint {
  vsd_v: number;
  is_a: number;
  temperature_c: number;
  vgs_v: number;
}

// BSIM3 参数定义
export type ParamCategory =
  | "Threshold" | "Mobility" | "Saturation" | "OutputRes"
  | "Capacitance" | "Junction" | "Temperature" | "Diode"
  | "Process" | "Doping";

export interface BSIM3ParamSpec {
  name: string;
  default: number;
  lower: number;
  upper: number;
  unit: string;
  category: ParamCategory;
  stage: string;
  description: string;
}

export interface BSIM3Model {
  name: string;
  params: Record<string, number>;
  fitted: Record<string, boolean>;
}

// 拟合阶段
export type StageStatus = "pending" | "running" | "done" | "error";

export interface Stage {
  id: number;
  name: string;
  short: string;
  description: string;
  optimizer: string;
  params: { name: string; init: string; fitted: string; bounds: string }[];
  rmse: string;
  iters: number;
  duration: string;
  status: StageStatus;
}

export interface FittingResult {
  success: boolean;
  total_rms: number;
  /** Log-domain R² (coefficient of determination) in [0, 1]; 1 is perfect. */
  r_squared: number;
  iterations: number;
  stage_results: {
    stage_name: string;
    success: boolean;
    rms: number;
    iterations: number;
    fitted_params: Record<string, number>;
    message: string;
  }[];
  message: string;
}

// 拟合日志
export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
}