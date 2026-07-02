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
    const r = await cmd<{ running: boolean; url?: string }>("check_backend");
    return r.running;
  } catch (e) {
    console.error("checkBackend failed:", e);
    return false;
  }
}

/** 启动 Python backend sidecar */
export async function startBackend(): Promise<boolean> {
  try {
    const r = await cmd<{ ok: boolean; url?: string; error?: string }>(
      "start_python_backend"
    );
    return r.ok;
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
}export async function simulateCurve(
  projectId: string,
  opts: {
    curveType: "idvg" | "idvd";
    paramOverrides: Record<string, number>;
    vds?: number;
    vgs_v?: number;
    vds_max?: number;
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
  }
): Promise<{
  fitted_params: Record<string, number>;
  ivar: number[];
  sim: number[];
  meas: number[];
  rms: number;
  r_squared: number;
  iterations: number;
  success: boolean;
}> {
  const resp = await cmd<{
    status: number; ok: boolean; body: {
      fitted_params: Record<string, number>;
      ivar: number[];
      sim: number[];
      meas: number[];
      rms: number;
      r_squared: number;
      iterations: number;
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
