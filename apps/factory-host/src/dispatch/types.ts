import type { Attempt, AttemptState } from "@factory/contracts";

export type RuntimeKind = Attempt["runtime"];
export type ReasoningEffort = NonNullable<Attempt["effort"]>;

export interface AttemptRow {
  project_id: string; id: string; task_id: string; revision: number; epoch: number;
  state: AttemptState; outcome: "known" | "unknown"; node_id: string | null; seat_id: string | null;
  runtime: RuntimeKind; provider: string; model: string; effort: ReasoningEffort;
  lease_id: string | null; lease_expires_at: string | null; started_at: string | null; ended_at: string | null;
}

export interface AttemptRecord {
  projectId: string; id: string; taskId: string; revision: number; epoch: number;
  state: AttemptState; outcome: "known" | "unknown"; nodeId: string | null; seatId: string | null;
  runtime: RuntimeKind; provider: string; model: string; effort: ReasoningEffort;
  leaseId: string | null; leaseExpiresAt: string | null; startedAt: string | null; endedAt: string | null;
}

export interface AttemptRef { projectId: string; attemptId: string; epoch: number; leaseId: string }
