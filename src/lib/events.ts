// events.ts - 全局事件总线的类型安全包装

export const WORKBENCH_ACTION_EVENT = "spicebuilder-workbench-action";
export const WORKBENCH_STATE_EVENT = "spicebuilder-workbench-state";

export type WorkbenchAction = "import" | "simulate" | "fit-selected" | "stop" | "export";

export interface WorkbenchRuntimeState {
  hasCsv: boolean;
  canFit: boolean;
  canSimulate: boolean;
  fitting: boolean;
  simulating: boolean;
  loading: boolean;
  isRunning: boolean;
  loadedStepCount: number;
  activeStepName: string;
}

export function dispatchWorkbenchAction(action: WorkbenchAction): void {
  window.dispatchEvent(new CustomEvent<WorkbenchAction>(WORKBENCH_ACTION_EVENT, { detail: action }));
}

export function addWorkbenchActionListener(
  handler: (action: WorkbenchAction) => void
): () => void {
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<WorkbenchAction>;
    if (customEvent.detail) {
      handler(customEvent.detail);
    }
  };
  window.addEventListener(WORKBENCH_ACTION_EVENT, listener);
  return () => window.removeEventListener(WORKBENCH_ACTION_EVENT, listener);
}

export function dispatchWorkbenchState(state: WorkbenchRuntimeState): void {
  window.dispatchEvent(new CustomEvent<WorkbenchRuntimeState>(WORKBENCH_STATE_EVENT, { detail: state }));
}

export function addWorkbenchStateListener(
  handler: (state: WorkbenchRuntimeState) => void
): () => void {
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<WorkbenchRuntimeState>;
    if (customEvent.detail) {
      handler(customEvent.detail);
    }
  };
  window.addEventListener(WORKBENCH_STATE_EVENT, listener);
  return () => window.removeEventListener(WORKBENCH_STATE_EVENT, listener);
}
