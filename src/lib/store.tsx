// store.ts - 全局项目状态 (Context)

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import type { SpiceDataSet, BSIM3Model, FittingResult } from "./types";
import * as api from "./api";

// ============================================================
//  Fit task polling helpers
// ============================================================

/** Start a fit task and poll task progress until completed/failed.
 *  Calls `onProgress(progress)` (0..1) at every poll interval and finally
 *  resolves with the fit result on success.  Throws on failure or timeout.
 */
function runFitWithPolling(
  projectId: string,
  useLtspice: boolean,
  maxLoops: number,
  onProgress: (frac: number, status: string) => void,
  intervalMs: number = 500,
  timeoutMs: number = 600_000,
): Promise<FittingResult> {
  return new Promise(async (resolve, reject) => {
    let timer: number | null = null;
    let cancelled = false;
    const deadline = Date.now() + timeoutMs;

    const cleanup = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    try {
      const start = await api.startFitting(projectId, useLtspice, maxLoops);
      const taskId = start.task_id;
      onProgress(0.0, "queued");

      const tick = async () => {
        if (cancelled) return;
        if (Date.now() > deadline) {
          cleanup();
          reject(new Error(`fit polling timed out after ${timeoutMs / 1000}s`));
          return;
        }
        try {
          const info = await api.pollFitTask(taskId);
          onProgress(info.progress, info.status);
          if (info.status === "completed") {
            cleanup();
            resolve(info.result);
          } else if (info.status === "failed") {
            cleanup();
            reject(new Error(info.error || "fit task failed"));
          }
        } catch (e: any) {
          // a transient poll error shouldn't kill the task; just retry next tick
          console.warn("pollFitTask transient error:", e?.message);
        }
      };
      timer = window.setInterval(tick, intervalMs);
      // Fire first tick immediately so UI gets to "running" quickly
      void tick();
    } catch (e: any) {
      cleanup();
      reject(e);
    }
  });
}

export interface AppState {
  // 项目
  projectId: string | null;
  dataset: (SpiceDataSet & { project_id?: string }) | null;
  model: BSIM3Model | null;
  fitResult: FittingResult | null;
  // Fit task progress (0..1). null when no fit is running.
  fitProgress: number | null;
  fitProgressStatus: string;
  // Backend
  backendRunning: boolean;
  logs: Array<{ ts: string; level: string; msg: string }>;
}

export interface AppActions {
  loadProject: (filepath: string) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  runFit: (useLtspice?: boolean) => Promise<void>;
  exportLib: (outputPath: string, format?: string) => Promise<string>;
  refreshBackend: () => Promise<void>;
  startBackend: () => Promise<void>;
  setLog: (level: string, msg: string) => void;
}

const AppContext = createContext<(AppState & AppActions) | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dataset, setDataset] = useState<SpiceDataSet | null>(null);
  const [model, setModel] = useState<BSIM3Model | null>(null);
  const [fitResult, setFitResult] = useState<FittingResult | null>(null);
  const [fitProgress, setFitProgress] = useState<number | null>(null);
  const [fitProgressStatus, setFitProgressStatus] = useState<string>("");
  const [backendRunning, setBackendRunning] = useState(false);
  const [logs, setLogs] = useState<Array<{ ts: string; level: string; msg: string }>>([]);

  const setLog = useCallback((level: string, msg: string) => {
    const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
    setLogs((prev) => [...prev.slice(-200), { ts, level, msg }]);
  }, []);

  const refreshBackend = useCallback(async () => {
    const running = await api.checkBackend();
    setBackendRunning(running);
    if (running) setLog("info", "Python backend connected");
    else setLog("warn", "Python backend NOT running");
  }, [setLog]);

  const startBackend = useCallback(async () => {
    setLog("info", "Starting Python backend...");
    const ok = await api.startBackend();
    setBackendRunning(ok);
    setLog(ok ? "success" : "error", ok ? "Python backend started" : "Backend start failed");
  }, [setLog]);

  const loadProject = useCallback(async (filepath: string) => {
    setLog("info", `Loading ${filepath}...`);
    try {
      const ds = await api.loadData(filepath);
      const pid = (ds as any).project_id;
      setProjectId(pid);
      setDataset(ds);
      setLog("success", `Loaded project ${pid?.slice(0, 8)}: ${ds.device_info.part_number}`);
      // 拉取初始 model
      if (pid) {
        const m = await api.getModel(pid);
        setModel(m);
        setLog("info", `Initialized ${Object.keys(m.params || {}).length} BSIM3 params`);
      }
    } catch (e: any) {
      setLog("error", `Load failed: ${e.message}`);
      throw e;
    }
  }, [setLog]);

  const selectProject = useCallback(async (pid: string) => {
    setLog("info", `Switching to project ${pid.slice(0, 8)}...`);
    try {
      setProjectId(pid);
      const m = await api.getModel(pid);
      setModel(m);
      setFitResult(null);
      // dataset 只有 device_info 需要重建（轻量）
      const ds: any = {
        device_info: (m as any).device_info || {},
        key_params: (m as any).key_params || {},
        idvg_vds5: [], idvg_vds05: [], idvd: [], cv_vds: [], body_diode: [],
        project_id: pid,
        curve_counts: (m as any).curve_counts || {},
      };
      setDataset(ds);
      setLog("success", `Project ${pid.slice(0, 8)} selected`);
    } catch (e: any) {
      setLog("error", `Select failed: ${e.message}`);
    }
  }, [setLog]);

  const runFit = useCallback(async (useLtspice: boolean = false, maxLoops: number = 1) => {
    if (!projectId) {
      setLog("error", "No project loaded");
      return;
    }
    setLog("info", `Starting fit (ltspice=${useLtspice}, max_loops=${maxLoops})...`);
    setFitProgress(0.0);
    setFitProgressStatus("queued");
    try {
      const r = await runFitWithPolling(
        projectId, useLtspice, maxLoops,
        (frac, status) => {
          setFitProgress(frac);
          setFitProgressStatus(status);
          // Surface stage-boundary events into the log panel
          const pct = Math.round(frac * 100);
          // Only log every 10% to avoid spam
          if (Math.round(frac * 10) !== Math.round(((fitProgress ?? 0) * 10))) {
            setLog("info", `fit ${status} ${pct}%`);
          }
        },
      );
      setFitResult(r);
      setLog(r.success ? "success" : "error",
              `Fit ${r.success ? "done" : "failed"}: total RMS = ${r.total_rms.toFixed(3)}`);
      // 拉取更新后的 model
      const m = await api.getModel(projectId);
      setModel(m);
    } catch (e: any) {
      setLog("error", `Fit failed: ${e.message}`);
      throw e;
    } finally {
      setFitProgress(null);
      setFitProgressStatus("");
    }
  }, [projectId, setLog, fitProgress]);

  const exportLib = useCallback(async (outputPath: string, format: string = "subckt") => {
    if (!projectId) throw new Error("No project loaded");
    setLog("info", `Exporting .lib to ${outputPath}...`);
    const path = await api.exportLib(projectId, outputPath, format);
    setLog("success", `Exported .lib: ${path}`);
    return path;
  }, [projectId, setLog]);

  return (
    <AppContext.Provider value={{
      projectId, dataset, model, fitResult, fitProgress, fitProgressStatus,
      backendRunning, logs,
      loadProject, selectProject, runFit, exportLib, refreshBackend, startBackend, setLog,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be inside AppProvider");
  return ctx;
}