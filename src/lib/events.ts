// events.ts - 全局事件总线的类型安全包装

export const WORKBENCH_ACTION_EVENT = "spicebuilder-workbench-action";

export type WorkbenchAction = "import" | "simulate" | "fit-selected" | "stop";

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
