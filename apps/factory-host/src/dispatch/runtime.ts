import type { Task } from "@factory/contracts";
import type { AttemptRef, RuntimeKind } from "./types.js";

export interface AttemptContext {
  ref: AttemptRef;
  task: Task;
  seat: { id: string; name: string; role: string };
  handoff: string | null;
  signal: AbortSignal;
  model?: { baseUrl: string; token: string; models: string[] };
  workspace?: { path: string; branch: string; baseSha: string };
}

export type RuntimeEvent =
  | { type: "progress"; message: string; percent?: number }
  | { type: "output"; text: string }
  | { type: "evidence"; name: string; detail: string }
  | { type: "completed"; summary: string }
  | { type: "failed"; kind: "runtime" | "timeout" | "model" | "config"; message: string };

export interface RuntimeSession {
  events(): AsyncIterable<RuntimeEvent>;
  /** Resolves ONLY when the execution has really ended. */
  stop(): Promise<void>;
}

export interface RuntimeAdapter {
  readonly kind: RuntimeKind;
  start(context: AttemptContext): Promise<RuntimeSession>;
}

export class RuntimeRegistry {
  private readonly adapters = new Map<RuntimeKind, RuntimeAdapter>();

  constructor(adapters: Iterable<RuntimeAdapter> = []) {
    for (const adapter of adapters) this.adapters.set(adapter.kind, adapter);
  }

  get(kind: RuntimeKind): RuntimeAdapter | undefined { return this.adapters.get(kind); }
}
