import type { Database } from "better-sqlite3";

const listeners = new WeakMap<Database, (projectId: string) => void>();
const busy = new WeakSet<Database>();
export function registerWorkflowLifecycle(raw: Database, listener: (projectId: string) => void): void {
  listeners.set(raw, listener);
}
/** Synchronous listeners share the caller's transaction. Nested task changes never recurse. */
export function workflowChanged(raw: Database, projectId: string): void {
  if (busy.has(raw)) return;
  busy.add(raw);
  try { listeners.get(raw)?.(projectId); } finally { busy.delete(raw); }
}
