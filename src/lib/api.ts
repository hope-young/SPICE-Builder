// api.ts - Tauri invoke 封装 (真实 FastAPI + Tauri backend)

import { invoke } from "@tauri-apps/api/core";
import type {
  SpiceDataSet, BSIM3Model, FittingResult, LogEntry,
} from "./types";

// ============================================================
//  Tauri Command Wrappers
// ============================================================

/** Tauri invoke 包装：失败时 throw（不再走 mock） */
async function cmd<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  return await invoke<T>(name, args);
}

/** 检查 Python backend 是否在跑 */
export async function checkBackend(): Promise<boolean> {
  try {
    const r = await cmd<{ running: boolean; url?: string; error?: string | null }>("check_backend");
    return !r.error;
  } catch (e) {
    console.error("checkBackend failed:", e);
    return false;
  }
}

/** 启动 Python backend sidecar */
export async function startBackend(): Promise<boolean> {
  try {
    const r = await cmd<string | { ok?: boolean; url?: string; error?: string }>("start_python_backend");
    if (typeof r === "string") return !/failed|error/i.test(r);
    return r.ok !== false && !r.error;
  } catch (e) {
    console.error("startBackend failed:", e);
    return false;
  }
}

/** 停止 Python backend */
export async function stopBackend(): Promise<void> {
  try {
    await cmd("stop_python_backend");
  } catch (e) {
    console.warn("stopBackend:", e);
  }
}

/** 加载项目（从 Excel） */
export async function loadData(filepath: string): Promise<SpiceDataSet> {
  const resp = await cmd<{
    status: number;
    ok: boolean;
    body: {
      project_id: string;
      name: string;
      device_info: any;
      key_params: any;
      curve_counts: Record<string, number>;
    };
    error?: string;
  }>("api_load_project", { excel_path: filepath });

  if (!resp.ok) {
    throw new Error(`Load failed (status ${resp.status}): ${resp.error || "unknown"}`);
  }

  // 映射到前端类型
  const body = resp.body;
  return {
    device_info: body.device_info,
    key_params: body.key_params,
    idvg_vds5: [],
    idvg_vds05: [],
    idvd: [],
    cv_vds: [],
    body_diode: [],
    project_id: body.project_id,  // 新增：传给后续 API
  } as SpiceDataSet & { project_id: string };
}

/** 列出所有项目 */
export async function listProjects(): Promise<Array<{
  project_id: string;
  name: string;
  n_points: number;
}>> {
  const resp = await cmd<{
    status: number; ok: boolean;
    body: { projects: Array<{ project_id: string; name: string; n_curves: number }> };
  }>("call_api", { method: "GET", endpoint: "/api/projects" });
  if (!resp.ok) return [];
  return (resp.body.projects || []).map((p) => ({
    project_id: p.project_id ?? (p as any).id,
    name: p.name,
    n_points: p.n_curves ?? (p as any).n_points ?? 0,
  }));
}

/** 获取 BSIM3 model (含初始参数 + 拟合结果) */
export async function getDataset(
  projectId: string,
): Promise<any> {
  const resp = await cmd<{ status: number; ok: boolean; body: any; error?: string }>(
    "call_api", { method: "GET", endpoint: `/api/projects/${projectId}/dataset` },
  );
  if (!resp.ok) {
    throw new Error(`getDataset failed: ${resp.status} ${resp.error || ""}`);
  }
  return resp.body;
}
export async function getModel(projectId: string): Promise<BSIM3Model> {
  const resp = await cmd<{
    status: number; ok: boolean;
    body: any;
  }>("call_api", {
    method: "GET",
    endpoint: `/api/projects/${projectId}/model`,
  });
  if (!resp.ok) throw new Error(`getModel failed: ${resp.status}`);
  return resp.body.model;
}

/** 获取曲线数据 (idvg, idvd, cv, diode) */
export async function getCurve(projectId: string, curveType: string): Promise<{
  ivar: number[];
  dvar: number[];
  metadata: Record<string, unknown>;
}> {
  const resp = await cmd<{
    status: number; ok: boolean;
    body: {
      name: string;
      curve_type: string;
      data: { ivar: number[]; dvar: number[] };
      metadata: any;
    };
  }>("call_api", {
    method: "GET",
    endpoint: `/api/projects/${projectId}/curves/${curveType}`,
  });
  if (!resp.ok) throw new Error(`getCurve failed: ${resp.status}`);
  return {
    ivar: resp.body.data?.ivar || [],
    dvar: resp.body.data?.dvar || [],
    metadata: resp.body.metadata || {},
  };
}

/** 跑拟合 */
export async function runFitting(
  projectId: string,
  useLtspice: boolean = false,
  maxLoops: number = 1,
): Promise<FittingResult> {
  const resp = await cmd<{
    status: number; ok: boolean;
    body: FittingResult;
  }>("api_run_fit", {
    projectId,
    opts: { use_ltspice: useLtspice, max_loops: maxLoops },
  });
  if (!resp.ok) {
    throw new Error(`runFitting failed: ${resp.status} ${JSON.stringify(resp.body)}`);
  }
  return resp.body;
}

/** Fire a fit task and immediately return its task_id.

    Add this to the front of a polling loop instead of awaiting the full
    fit.  Returns: { task_id, status: "queued" }.
*/
export async function startFitting(
  projectId: string,
  useLtspice: boolean = false,
  maxLoops: number = 1,
): Promise<{ task_id: string; status: string; message?: string }> {
  const resp = await cmd<{
    status: number; ok: boolean;
    body: { task_id: string; status: string; message?: string };
    error?: string;
  }>("call_api", {
    method: "POST",
    endpoint: `/api/projects/${projectId}/fit`,
    body: JSON.stringify({
      stages: ["S1", "S2", "S3", "S4", "S5", "S6"],
      max_loops: maxLoops,
      error_threshold: 1.0,
      optimizer: {
        method: "trf", eps1: 1e-3, eps2: 1e-3, eps3: 1e-3,
        max_iter: 30, parallel_jobs: 1,
      },
    }),
  });
  if (!resp.ok) {
    throw new Error(`startFitting failed: ${resp.status} ${resp.error || ""}`);
  }
  return resp.body;
}

/** Poll task status. Returns TaskInfo with progress (0..1) + status. */
export async function pollFitTask(
  taskId: string,
): Promise<{
  id: string;
  status: string;
  progress: number;
  result: FittingResult;
  error: string;
  created_at: string;
  current_stage: string;
  current_loop: number;
}> {
  const resp = await cmd<{
    status: number; ok: boolean;
    body: any;
    error?: string;
  }>("call_api", {
    method: "GET",
    endpoint: `/api/tasks/${taskId}`,
  });
  if (!resp.ok) {
    throw new Error(`pollFitTask failed: ${resp.status} ${resp.error || ""}`);
  }
  return resp.body;
}

/** 实时仿真：给定参数覆盖，跑 LTspice 得到 Id-Vg/Id-Vd 曲线 */

/** Request cancellation of a running fit task.  The task transitions to
    "cancelled" state on the server and the polling loop on the caller
    side will see it on the next poll.  No-op if the task is already
    finished.
*/
export async function cancelFitTask(
  taskId: string,
): Promise<{ task_id: string; status: string; cancelled: boolean; reason?: string }> {
  const resp = await cmd<{
    status: number; ok: boolean;
    body: { task_id: string; status: string; cancelled: boolean; reason?: string };
    error?: string;
  }>("call_api", {
    method: "POST",
    endpoint: `/api/tasks/${taskId}/cancel`,
  });
  if (!resp.ok) {
    throw new Error(`cancelFitTask failed: ${resp.status} ${resp.error || ""}`);
  }
  return resp.body;
}/* =========================================================================
   Stateless CSV API (无 project_id)
   优先用 Tauri IPC (call_api), 浏览器模式下直接 fetch 后端
   ========================================================================= */

const PYTHON_BACKEND = "http://127.0.0.1:8765";

export type PowerMOSSubcktParams = {
  include_diode?: boolean;
  rg_ohm?: number;
  rd_ext_ohm?: number | null;
  rs_ext_ohm?: number | null;
  rdrift_ohm?: number;
  rjfet_ohm?: number;
  cell_count?: number;
  cell_w_m?: number;
  active_area_mm2?: number;
  cell_pitch_um?: number;
};

export type CsvFitStopConfig = {
  r2_log: number;
  r2_linear: number;
  ftol: number;
  xtol: number;
  gtol: number;
  max_nfev: number;
};

export type CsvExportModelResponse = {
  success: boolean;
  file_path: string;
  n_bytes: number;
};

export class ApiRequestError extends Error {
  status: number;
  endpoint: string;
  backendError?: string;
  body?: unknown;

  constructor(message: string, opts: { status: number; endpoint: string; backendError?: string; body?: unknown }) {
    super(message);
    this.name = "ApiRequestError";
    this.status = opts.status;
    this.endpoint = opts.endpoint;
    this.backendError = opts.backendError;
    this.body = opts.body;
    Object.setPrototypeOf(this, ApiRequestError.prototype);
  }
}

function stringifyBackendBody(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    return typeof detail === "string" ? detail : JSON.stringify(detail);
  }
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

export function isApiEndpointNotFound(error: unknown, endpoint: string): boolean {
  if (error instanceof ApiRequestError) {
    const backendText = `${error.backendError ?? ""} ${stringifyBackendBody(error.body)}`;
    return error.status === 404 && error.endpoint === endpoint && /not found/i.test(backendText);
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(endpoint) && /\b404\b/.test(message) && /not found/i.test(message);
}

function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

async function webFetch<T>(path: string, body: any, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${PYTHON_BACKEND}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`fetch ${path} failed: ${res.status} ${txt}`);
  }
  return res.json();
}

/** 读一个 CSV，解析为 ivar/dvar, 不需要 project state */
export async function csvLoad(
  csvPath: string,
  opts: { curveType?: "idvg" | "idvd" | "cv" | "qg" | "body_diode" } = {}
): Promise<{ curve_type: string; ivar: number[]; dvar: number[]; metadata: Record<string, unknown> }> {
  if (!isTauri()) {
    return webFetch("/api/csv/load", { csv_path: csvPath, curve_type: opts.curveType ?? "idvg" });
  }
  const resp = await cmd<{
    status: number; ok: boolean; body: {
      curve_type: string; ivar: number[]; dvar: number[]; metadata: Record<string, unknown>;
    };
  }>("call_api", {
    method: "POST",
    endpoint: `/api/csv/load`,
    body: JSON.stringify({ csv_path: csvPath, curve_type: opts.curveType ?? "idvg" }),
  });
  if (!resp.ok) throw new Error(`csvLoad failed: ${resp.status}`);
  return resp.body;
}

/** Export current Workbench BSIM params as a SPICE .lib without project state */
export async function csvExportModel(opts: {
  outputPath: string;
  format: "subckt" | "bsim3";
  subcktName: string;
  modelName?: string;
  params: Record<string, number>;
  powerParams?: PowerMOSSubcktParams;
  includeDiode?: boolean;
  rgOhm?: number;
}): Promise<CsvExportModelResponse> {
  const endpoint = "/api/csv/export_model";
  const body = {
    output_path: opts.outputPath,
    format: opts.format,
    subckt_name: opts.subcktName,
    model_name: opts.modelName ?? "BSIM3_core",
    params: opts.params,
    power_params: opts.powerParams,
    include_diode: opts.includeDiode ?? true,
    rg_ohm: opts.rgOhm ?? 1.6,
  };
  if (!isTauri()) {
    try {
      return await webFetch(endpoint, body);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const status = Number(message.match(/\bfailed:\s+(\d+)/)?.[1] ?? 0);
      throw new ApiRequestError(message, { status, endpoint, backendError: message });
    }
  }
  const resp = await cmd<{
    status: number; ok: boolean; body: CsvExportModelResponse; error?: string;
  }>("call_api", {
    method: "POST",
    endpoint,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const backendText = resp.error || stringifyBackendBody(resp.body);
    throw new ApiRequestError(`csvExportModel failed: ${resp.status} ${backendText}`, {
      status: resp.status,
      endpoint,
      backendError: resp.error,
      body: resp.body,
    });
  }
  return resp.body;
}

/** 给定 CSV + 参数, 跑 LTspice 返回 sim+meas */
export async function csvSimulate(
  csvPath: string,
  opts: {
    curveType: "idvg" | "idvd";
    paramOverrides: Record<string, number>;
    vds?: number;
    vgs_v?: number;
    vds_max?: number;
    powerParams?: PowerMOSSubcktParams;
    signal?: AbortSignal;
  }
): Promise<{ curve_type: string; ivar: number[]; sim: number[]; meas: number[]; metadata: Record<string, unknown> }> {
  const body = {
    csv_path: csvPath,
    curve_type: opts.curveType,
    param_overrides: opts.paramOverrides,
    vds: opts.vds ?? 0.5,
    vgs_v: opts.vgs_v ?? 10.0,
    vds_max: opts.vds_max ?? 12.0,
    power_params: opts.powerParams,
  };
  if (!isTauri()) {
    return webFetch("/api/csv/simulate", body, opts.signal);
  }
  const resp = await cmd<{
    status: number; ok: boolean; body: {
      curve_type: string; ivar: number[]; sim: number[]; meas: number[]; metadata: Record<string, unknown>;
    };
  }>("call_api", {
    method: "POST",
    endpoint: `/api/csv/simulate`,
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`csvSimulate failed: ${resp.status}`);
  return resp.body;
}

/** 给定 CSV + 区间, 拟合最优参数 */
export async function csvFit(
  csvPath: string,
  opts: {
    paramNames: string[];
    paramBounds?: Record<string, [number, number]>;
    initialParams?: Record<string, number>;
    vmin: number;
    vmax: number;
    vds?: number;
    historyInterval?: number;  // 每 N 步记录一次 history, 0=不记录
    signal?: AbortSignal;       // 用于取消拟合
    powerParams?: PowerMOSSubcktParams;
    stop?: CsvFitStopConfig;
  }
): Promise<{
  fitted_params: Record<string, number>;
  ivar: number[];
  sim: number[];
  meas: number[];
  rms: number;
  r_squared: number;          // 对数域 R²
  r_squared_linear: number;   // 线性域 R²
  iterations: number;
  nfev: number;
  optimizer_message: string;
  success: boolean;
  history: Array<{            // 拟合收敛轨迹 (空数组=不记录)
    step: number;
    params: Record<string, number>;
    sim: number[];
    r2_linear: number;
    r2_log?: number;
    ftol_metric?: number;
    xtol_metric?: number;
    gtol_metric?: number;
    fit_rms?: number;
    bound_events?: Array<Record<string, unknown>>;
  }>;
}> {
  const body = {
    csv_path: csvPath,
    curve_type: "idvg",
    param_names: opts.paramNames,
    param_bounds: opts.paramBounds ?? {},
    initial_params: opts.initialParams ?? {},
    vmin: opts.vmin,
    vmax: opts.vmax,
    vds: opts.vds ?? 0.5,
    history_interval: opts.historyInterval ?? 0,
    power_params: opts.powerParams,
    stop: opts.stop,
  };
  if (!isTauri()) {
    return webFetch("/api/csv/fit", body, opts.signal);
  }
  const resp = await cmd<{
    status: number; ok: boolean; body: {
      fitted_params: Record<string, number>;
      ivar: number[]; sim: number[]; meas: number[];
      rms: number; r_squared: number; r_squared_linear: number;
      iterations: number; nfev: number; optimizer_message: string; success: boolean;
      history: Array<{
        step: number;
        params: Record<string, number>;
        sim: number[];
        r2_linear: number;
        r2_log?: number;
        ftol_metric?: number;
        xtol_metric?: number;
        gtol_metric?: number;
        fit_rms?: number;
        bound_events?: Array<Record<string, unknown>>;
      }>;
    };
  }>("call_api", {
    method: "POST",
    endpoint: `/api/csv/fit`,
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`csvFit failed: ${resp.status}`);
  return resp.body;
}

/** 联合拟合: 多条 Id-Vg 曲线 (不同 Vds) 共享参数 */
export async function csvDualFit(
  opts: {
    curves: Array<{ csvPath: string; vds: number; vmin: number; vmax: number; weight?: number }>;
    paramNames: string[];
    paramBounds?: Record<string, [number, number]>;
    initialParams?: Record<string, number>;
    historyInterval?: number;
    signal?: AbortSignal;
    powerParams?: PowerMOSSubcktParams;
    stop?: CsvFitStopConfig;
  }
): Promise<{
  fitted_params: Record<string, number>;
  curves: Array<{
    csv_path: string;
    vds: number;
    vmin: number;
    vmax: number;
    weight?: number;
    ivar: number[];
    sim: number[];
    meas: number[];
    r2_log: number;
    r2_linear: number;
  }>;
  rms: number;
  r_squared: number;
  r_squared_linear: number;
  iterations: number;
  nfev: number;
  optimizer_message: string;
  success: boolean;
  history: Array<{ step: number; params: Record<string, number>; r2_log: Record<string, number>; r2_linear: Record<string, number> }>;
}> {
  const body = {
    curves: opts.curves.map(c => ({
      csv_path: c.csvPath,
      vds: c.vds,
      vmin: c.vmin,
      vmax: c.vmax,
      weight: c.weight ?? 1,
    })),
    param_names: opts.paramNames,
    param_bounds: opts.paramBounds ?? {},
    initial_params: opts.initialParams ?? {},
    history_interval: opts.historyInterval ?? 0,
    power_params: opts.powerParams,
    stop: opts.stop,
  };
  if (!isTauri()) {
    return webFetch("/api/csv/dual_fit", body, opts.signal);
  }
  const resp = await cmd<{
    status: number; ok: boolean; body: any;
  }>("call_api", {
    method: "POST",
    endpoint: `/api/csv/dual_fit`,
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`csvDualFit failed: ${resp.status} ${JSON.stringify(resp.body).slice(0, 300)}`);
  return resp.body;
}

/** 流式联合拟合: 多条 Id-Vg 曲线共享参数, 每步返回所有曲线当前 sim/R² */
export async function* csvDualFitStream(
  opts: {
    curves: Array<{ csvPath: string; vds: number; vmin: number; vmax: number; weight?: number }>;
    paramNames: string[];
    paramBounds?: Record<string, [number, number]>;
    initialParams?: Record<string, number>;
    historyInterval?: number;
    signal?: AbortSignal;
    powerParams?: PowerMOSSubcktParams;
    stop?: CsvFitStopConfig;
  }
): AsyncGenerator<{
  step: number;
  kind?: "step" | "final" | "error";
  params?: Record<string, number>;
  fitted_params?: Record<string, number>;
  curves?: Array<{
    index: number;
    csv_path: string;
    vds: number;
    vmin: number;
    vmax: number;
    weight?: number;
    ivar: number[];
    sim: number[];
    meas: number[];
    r2_log: number;
    r2_linear: number;
  }>;
  rms?: number;
  r_squared?: number;
  r_squared_linear?: number;
  iterations?: number;
  nfev?: number;
  success?: boolean;
  optimizer_message?: string;
  ftol_metric?: number;
  xtol_metric?: number;
  gtol_metric?: number;
  fit_rms?: number;
  error?: string;
  bound_events?: Array<Record<string, unknown>>;
}> {
  const body = {
    curves: opts.curves.map(c => ({
      csv_path: c.csvPath,
      vds: c.vds,
      vmin: c.vmin,
      vmax: c.vmax,
      weight: c.weight ?? 1,
    })),
    param_names: opts.paramNames,
    param_bounds: opts.paramBounds ?? {},
    initial_params: opts.initialParams ?? {},
    history_interval: opts.historyInterval ?? 1,
    power_params: opts.powerParams,
    stop: opts.stop,
  };

  const res = await fetch(`${PYTHON_BACKEND}/api/csv/dual_fit/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (res.status === 404) {
    const fallback = await csvDualFit(opts);
    yield {
      kind: "final",
      step: -1,
      fitted_params: fallback.fitted_params,
      curves: fallback.curves.map((curve, index) => ({ ...curve, index })),
      rms: fallback.rms,
      r_squared: fallback.r_squared,
      r_squared_linear: fallback.r_squared_linear,
      iterations: fallback.iterations,
      nfev: fallback.nfev,
      success: fallback.success,
      optimizer_message: (
        fallback.optimizer_message ||
        "当前 Python backend 是旧进程，已回退到非流式联合拟合。重启 backend 后可显示实时迭代曲线。"
      ),
      fit_rms: fallback.rms,
    };
    return;
  }
  if (!res.ok) throw new Error(`csvDualFitStream failed: ${res.status}`);
  if (!res.body) throw new Error("csvDualFitStream failed: response body is not readable");

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) yield JSON.parse(line);
    }
  }
  if (buf.trim()) yield JSON.parse(buf);
}

/** 流式拟合: 边拟合边返回 step, 用于实时动画
 *  返回 AsyncIterable<{step, params, sim, r2} | final | error> */
export async function* csvFitStream(
  opts: {
    csvPath: string;
    paramNames: string[];
    paramBounds?: Record<string, [number, number]>;
    initialParams?: Record<string, number>;
    protectCurves?: Array<{ csvPath: string; vds: number; vmin: number; vmax: number; weight: number }>;
    vmin: number;
    vmax: number;
    vds?: number;
    historyInterval?: number;
    signal?: AbortSignal;
    powerParams?: PowerMOSSubcktParams;
    stop?: CsvFitStopConfig;
  }
): AsyncGenerator<{
  step: number;
  kind?: "step" | "final" | "error";
  params?: Record<string, number>;
  sim?: number[];
  r2?: number;
  fitted_params?: Record<string, number>;
  ivar?: number[];
  meas?: number[];
  r2_linear?: number;
  r2_log?: number;
  ftol_metric?: number;
  xtol_metric?: number;
  gtol_metric?: number;
  fit_rms?: number;
  rms?: number;
  iterations?: number;
  nfev?: number;
  success?: boolean;
  optimizer_message?: string;
  error?: string;
  bound_events?: Array<Record<string, unknown>>;
}> {
  const body = {
    csv_path: opts.csvPath,
    curve_type: "idvg",
    param_names: opts.paramNames,
    param_bounds: opts.paramBounds ?? {},
    initial_params: opts.initialParams ?? {},
    protect_curves: opts.protectCurves ?? [],
    vmin: opts.vmin,
    vmax: opts.vmax,
    vds: opts.vds ?? 0.5,
    history_interval: opts.historyInterval ?? 1,
    power_params: opts.powerParams,
    stop: opts.stop,
  };
  try {
    // Web 和 Tauri 都优先直连本地 FastAPI，以保留 NDJSON streaming。
    const res = await fetch(`${PYTHON_BACKEND}/api/csv/fit/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`csvFitStream failed: ${res.status}`);
    if (!res.body) throw new Error("csvFitStream failed: response body is not readable");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim()) yield JSON.parse(line);
      }
    }
    if (buf.trim()) yield JSON.parse(buf);
    return;
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    if (!isTauri()) throw e;

    // Tauri fallback: IPC 不能稳定传递流式 body，失败时至少返回最终曲线。
    const resp = await cmd<{ status: number; ok: boolean; body: any; error?: string }>("call_api", {
      method: "POST",
      endpoint: `/api/csv/fit`,
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`csvFitStream fallback failed: ${resp.status} ${resp.error || ""}`);
    if (resp.body) {
      yield {
        kind: "final",
        step: -1,
        fitted_params: resp.body.fitted_params,
        sim: resp.body.sim,
        meas: resp.body.meas,
        ivar: resp.body.ivar,
        r2_linear: resp.body.r_squared_linear,
        r2_log: resp.body.r_squared,
        rms: resp.body.rms,
        iterations: resp.body.iterations,
        nfev: resp.body.nfev,
        success: resp.body.success,
        optimizer_message: resp.body.optimizer_message,
        bound_events: resp.body.bound_events ?? [],
      };
    }
  }
}

/* =========================================================================
   旧的 project_id API (弃用但保留兼容)
   ========================================================================= */

export async function simulateCurve(
  projectId: string,
  opts: {
    curveType: "idvg" | "idvd";
    paramOverrides: Record<string, number>;
    vds?: number;
    vgs_v?: number;
    vds_max?: number;
    powerParams?: PowerMOSSubcktParams;
  }
): Promise<{
  curve_type: string;
  ivar: number[];
  sim: number[];
  meas: number[];
  metadata: Record<string, unknown>;
}> {
  const resp = await cmd<{
    status: number; ok: boolean; body: {
      curve_type: string;
      ivar: number[];
      sim: number[];
      meas: number[];
      metadata: Record<string, unknown>;
    };
  }>("call_api", {
    method: "POST",
    endpoint: `/api/projects/${projectId}/simulate`,
    body: JSON.stringify({
      curve_type: opts.curveType,
      param_overrides: opts.paramOverrides,
      vds: opts.vds ?? 5.0,
      vgs_v: opts.vgs_v ?? 10.0,
      vds_max: opts.vds_max ?? 12.0,
      power_params: opts.powerParams,
    }),
  });
  if (!resp.ok) throw new Error(`simulateCurve failed: ${resp.status}`);
  return resp.body;
}

/** 加载 CSV 单条曲线 */
export async function loadCsvCurve(
  projectId: string,
  opts: { csvPath: string; curveType: "idvg" | "idvd" | "cv" | "qg" | "body_diode" }
): Promise<{ curve_type: string; ivar: number[]; dvar: number[]; metadata: Record<string, unknown> }> {
  const resp = await cmd<{
    status: number; ok: boolean; body: {
      curve_type: string;
      ivar: number[];
      dvar: number[];
      metadata: Record<string, unknown>;
    };
  }>("call_api", {
    method: "POST",
    endpoint: `/api/projects/${projectId}/load_csv`,
    body: JSON.stringify({ csv_path: opts.csvPath, curve_type: opts.curveType }),
  });
  if (!resp.ok) throw new Error(`loadCsvCurve failed: ${resp.status}`);
  return resp.body;
}

/** 区间拟合单条曲线 */
export async function fitSingleCurve(
  projectId: string,
  opts: {
    curveType: "idvg" | "idvd";
    paramNames: string[];
    vmin: number;
    vmax: number;
    vds?: number;
    vgs_v?: number;
    powerParams?: PowerMOSSubcktParams;
  }
): Promise<{
  fitted_params: Record<string, number>;
  ivar: number[];
  sim: number[];
  meas: number[];
  rms: number;
  r_squared: number;
  r_squared_linear: number;
  iterations: number;
  nfev: number;
  optimizer_message: string;
  success: boolean;
  history?: Array<{
    step: number;
    params: Record<string, number>;
    sim: number[];
    r2_linear: number;
  }>;
}> {
  const resp = await cmd<{
    status: number; ok: boolean; body: {
      fitted_params: Record<string, number>;
      ivar: number[];
      sim: number[];
      meas: number[];
      rms: number;
      r_squared: number;
      r_squared_linear: number;
      iterations: number;
      nfev: number;
      optimizer_message: string;
      success: boolean;
    };
  }>("call_api", {
    method: "POST",
    endpoint: `/api/projects/${projectId}/fit_single`,
    body: JSON.stringify({
      curve_type: opts.curveType,
      param_names: opts.paramNames,
      vmin: opts.vmin,
      vmax: opts.vmax,
      vds: opts.vds ?? 5.0,
      vgs_v: opts.vgs_v ?? 10.0,
      power_params: opts.powerParams,
    }),
  });
  if (!resp.ok) throw new Error(`fitSingleCurve failed: ${resp.status}`);
  return resp.body;
}

/** 导出 .lib */
export async function exportLib(
  projectId: string,
  outputPath: string,
  format: string = "subckt",
): Promise<string> {
  const resp = await cmd<{
    status: number; ok: boolean;
    body: { output_path: string; file_size: number };
  }>("api_export_lib", {
    projectId,
    outputPath,
    format,
  });
  if (!resp.ok) throw new Error(`exportLib failed: ${resp.status}`);
  return resp.body.output_path;
}

/** 读取日志 (Tauri 端) */
export async function getLogs(): Promise<LogEntry[]> {
  try {
    return await cmd<LogEntry[]>("get_logs");
  } catch (e) {
    return [];
  }
}

/** 健康检查 */
export async function healthCheck(): Promise<{ backend: boolean; ltspice: boolean }> {
  const backendOk = await checkBackend();
  return { backend: backendOk, ltspice: backendOk };  // 简化: 同一状态
}
