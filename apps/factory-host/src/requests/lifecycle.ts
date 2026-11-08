import type { Database } from "better-sqlite3";
import type { TaskState } from "@factory/contracts";

type Listener = (projectId: string, taskId: string, state: TaskState) => void;
const listeners = new WeakMap<Database, Listener>();
export function registerRequestLifecycle(raw: Database, listener: Listener): void { listeners.set(raw, listener); }
export function requestTaskTransition(raw: Database, projectId: string, taskId: string, state: TaskState): void {
  listeners.get(raw)?.(projectId, taskId, state);
}
