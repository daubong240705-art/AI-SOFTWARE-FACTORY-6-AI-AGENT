import type { Database } from "better-sqlite3";

const listeners = new WeakMap<Database, Set<(projectId: string) => void>>();
const busy = new WeakSet<Database>();
/** Bulk cancellation must not dispatch fresh work while individual tasks are being closed. */
export function withoutWorkflowAdvancement<T>(raw: Database, fn: () => T): T {
  if (busy.has(raw)) return fn();
  busy.add(raw);
  try { return fn(); } finally { busy.delete(raw); }
}
export function registerWorkflowLifecycle(raw: Database, listener: (projectId: string) => void): void {
  const registered = listeners.get(raw) ?? new Set();
  registered.add(listener);
  listeners.set(raw, registered);
}
/** Synchronous listeners share the caller's transaction. Nested task changes never recurse. */
export function workflowChanged(raw: Database, projectId: string): void {
  if (busy.has(raw)) return;
  busy.add(raw);
  try { for (const listener of listeners.get(raw) ?? []) listener(projectId); } finally { busy.delete(raw); }
}
