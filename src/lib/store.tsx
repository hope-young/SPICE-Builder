// store.tsx - 全局项目状态 (Context)

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";
import type { SpiceDataSet, BSIM3Model, FittingResult } from "./types";
import * as api from "./api";

// ============================================================
//  Fit task polling helpers
// ============================================================

export interface FitHandle {
  promise: Promise<FittingResult>;
  cancel: () => Promise<void>;
  /** Synchronous read of the in-flight taskId (null until start resolves). */
  getTaskId: () => string | null;
}

/** Start a fit task and poll task progress until completed/failed/cancelled.
 *  Returns a FitHandle so callers can cancel the task from the UI. */
function runFitWithPolling(
  projectId: string,
  useLtspice: boolean,
  maxLoops: number,
  onProgress: (frac: number, status: string, stage?: string, loop?: number) => void,
  intervalMs: number = 500,
  timeoutMs: number = 600_000,
): FitHandle {
  let taskId: string | null = null;
  const promise = new Promise<FittingResult>(async (resolve, reject) => {
    let timer: number | null = null;
    let pollStopped = false;
    const MAX_POLL_ERRORS = 5;
    let pollErrors = 0;
    const deadline = Date.now() + timeoutMs;

    const cleanup = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    try {
      const start = await api.startFitting(projectId, useLtspice, maxLoops);
      taskId = start.task_id;
      onProgress(0.0, "queued");

      const tick = async () => {
        if (pollStopped) return;
        if (Date.now() > deadline) {
          cleanup();
          pollStopped = true;
          reject(new Error(`fit polling timed out after ${timeoutMs / 1000}s`));
          return;
        }
        try {
          const info = await api.pollFitTask(taskId!);
          onProgress(info.progress, info.status, info.current_stage, info.current_loop);
          if (info.status === "completed") {
            cleanup();
            pollStopped = true;
            resolve(info.result);
          } else if (info.status === "failed") {
            cleanup();
            pollStopped = true;
            reject(new Error(info.error || "fit task failed"));
          } else if (info.status === "cancelled") {
            cleanup();
            pollStopped = true;
            reject(new Error("fit cancelled by user"));
          }
        } catch (e: any) {
          pollErrors++;
          if (pollErrors >= MAX_POLL_ERRORS) {
            cleanup();
            pollStopped = true;
            reject(new Error(`fit polling failed ${pollErrors} times in a row; aborting`));
            return;
          }
          console.warn("pollFitTask transient error:", e?.message);
        }
      };
      timer = window.setInterval(tick, intervalMs);
      void tick();
    } catch (e: any) {
      cleanup();
      pollStopped = true;
      reject(e);
    }
  });

  const cancel = async () => {
    if (taskId !== null) {
      try {
        await api.cancelFitTask(taskId);
      } catch (e: any) {
        console.warn("cancelFitTask failed:", e?.message);
      }
    }
  };
  return { promise, cancel, getTaskId: () => taskId };
}

export interface AppState {
  projectId: string | null;
  dataset: (SpiceDataSet & { project_id?: string }) | null;
  model: BSIM3Model | null;
  fitResult: FittingResult | null;
  fitProgress: number | null;
  fitProgressStatus: string;
  // Most recently reported stage name + 1-based loop index.
  currentStage: string;
  currentLoop: number;
  backendRunning: boolean;
  logs: Array<{ ts: string; level: string; msg: string }>;
}

export interface AppActions {
  loadProject: (filepath: string) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  runFit: (useLtspice?: boolean, maxLoops?: number) => Promise<void>;
  cancelFit: () => Promise<void>;
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
  const [currentStage, setCurrentStage] = useState<string>("");
  const [currentLoop, setCurrentLoop] = useState<number>(0);
  const [backendRunning, setBackendRunning] = useState(false);
  const [logs, setLogs] = useState<Array<{ ts: string; level: string; msg: string }>>([]);

  // Refs survive re-renders.  fitHandleRef lets onStop cancel the
  // currently-running task.  lastLoggedDecile fixes the stale-closure
  // bug in the old 10% progress log dedup.
  const fitHandleRef = useRef<FitHandle | null>(null);
  const lastLoggedDecile = useRef<number>(-1);
  // Tracks an in-flight loadProject so a double-click on the Data
  // Browser upload button does not enqueue duplicate loads.
  const loadInFlightRef = useRef<string | null>(null);

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
    if (loadInFlightRef.current === filepath) {
      setLog("warn", `Already loading ${filepath}; ignoring duplicate`);
      return;
    }
    loadInFlightRef.current = filepath;
    setLog("info", `Loading ${filepath}...`);
    try {
      const ds = await api.loadData(filepath);
      const pid = (ds as any).project_id;
      setProjectId(pid);
      setDataset(ds);
      setFitResult(null);
      setLog("success", `Loaded project ${pid?.slice(0, 8)}: ${ds.device_info.part_number}`);
      if (pid) {
        const m = await api.getModel(pid);
        setModel(m);
        setLog("info", `Initialized ${Object.keys(m.params || {}).length} BSIM3 params`);
      }
    } catch (e: any) {
      setLog("error", `Load failed: ${e.message}`);
      throw e;
    } finally {
      loadInFlightRef.current = null;
    }
  }, [setLog]);

  // selectProject pulls both model and dataset so the UI stays in sync
  // with the server-side state.  Without getDataset the projectId would
  // change but the in-memory dataset would still point at the old
  // project, breaking subsequent /curves calls.
  const selectProject = useCallback(async (pid: string) => {
    setLog("info", `Switching to project ${pid.slice(0, 8)}...`);
    try {
      const m = await api.getModel(pid);
      const ds = await api.getDataset(pid);
      setProjectId(pid);
      setDataset(ds);
      setModel(m);
      setFitResult(null);
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
    if (fitHandleRef.current) {
      setLog("warn", "A fit is already running; ignoring new request");
      return;
    }
    setLog("info", `Starting fit (ltspice=${useLtspice}, max_loops=${maxLoops})...`);
    setFitProgress(0.0);
    setFitProgressStatus("queued");
    lastLoggedDecile.current = 0;
    const handle = runFitWithPolling(
      projectId, useLtspice, maxLoops,
      (frac, status, stage, loop) => {
        setFitProgress(frac);
        setFitProgressStatus(status);
        if (stage !== undefined) setCurrentStage(stage);
        if (loop !== undefined) setCurrentLoop(loop);
        const decile = Math.round(frac * 10);
        if (decile !== lastLoggedDecile.current && decile >= 0 && decile <= 10) {
          lastLoggedDecile.current = decile;
          setLog("info", `fit ${status} ${decile * 10}%`);
        }
      },
    );
    fitHandleRef.current = handle;
    try {
      const r = await handle.promise;
      setFitResult(r);
      setLog(r.success ? "success" : "error",
              `Fit ${r.success ? "done" : "failed"}: total RMS = ${r.total_rms.toFixed(3)}`);
      const m = await api.getModel(projectId);
      setModel(m);
    } catch (e: any) {
      setLog("error", `Fit failed: ${e.message}`);
      throw e;
    } finally {
      fitHandleRef.current = null;
      setFitProgress(null);
      setFitProgressStatus("");
      setCurrentStage("");
      setCurrentLoop(0);
    }
  }, [projectId, setLog]);

  const cancelFit = useCallback(async () => {
    const h = fitHandleRef.current;
    if (!h) {
      setLog("warn", "No fit in progress to stop");
      return;
    }
    setLog("info", "Requesting fit cancellation...");
    await h.cancel();
  }, [setLog]);

  const exportLib = useCallback(async (outputPath: string, format: string = "subckt") => {
    if (!projectId) throw new Error("No project loaded");
    setLog("info", `Exporting .lib to ${outputPath}...`);
    const path = await api.exportLib(projectId, outputPath, format);
    setLog("success", `Exported .lib: ${path}`);
    return path;
  }, [projectId, setLog]);

  return (
    <AppContext.Provider value={{
      projectId, dataset, model, fitResult, fitProgress, fitProgressStatus, currentStage, currentLoop,
      backendRunning, logs,
      loadProject, selectProject, runFit, cancelFit, exportLib, refreshBackend, startBackend, setLog,
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