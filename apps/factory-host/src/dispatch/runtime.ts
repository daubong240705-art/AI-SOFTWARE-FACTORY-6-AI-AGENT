import type { Task } from "@factory/contracts";
import type { AttemptRef, RuntimeKind } from "./types.js";

export interface AttemptContext {
  ref: AttemptRef;
  task: Task;
  seat: { id: string; name: string; role: string };
  handoff: string | null;
  contextPack?: string | null;
  instructions?: { profile: string; skills: { name: string; description: string }[] } | null;
  signal: AbortSignal;
  model?: { baseUrl: string; token: string; models: string[]; socketPath?: string; mcpBaseUrl?: string };
  workspace?: { path: string; branch: string; baseSha: string };
  agent?: { cli?: "codex" | "claude"; model?: string | null; effort?: "low" | "medium" | "high" | "xhigh" | null; permission?: "autonomous" | "workspace-write" };
  /** Reference inputs the Host copied into the worktree (workspace-relative paths under .factory/inputs). */
  inputs?: Array<{ path: string; title: string; mediaType: string; note: string | null }>;
  /** CLI-native MCP servers assigned to the seat; isolated CLIs ignore the operator's own MCP configuration. */
  mcp?: { isolated: boolean; servers: CliMcpServer[] };
}

export interface CliMcpServer {
  name: string; command: string; args: string[]; envNames: string[]; clis: Array<"codex" | "claude">;
}

export type RuntimeEvent =
  // Counts are deltas; NULL means a field was not reported, including in one of several turns.
  | { type: "usage"; usage: { inputTokens: number | null; cachedInputTokens: number | null;
      outputTokens: number | null; reasoningOutputTokens: number | null } }
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
