import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import { flowDefinitionSchema, type EntityRef, type FlowDefinition, type FlowNodeRunState, type FlowRunState } from "@factory/contracts";
import type { EventHub } from "../events/hub.js";
import { CommandError } from "../commands/errors.js";

export interface FlowRow {
  project_id: string; id: string; revision: number; key: string; title: string;
  draft_json: string; archived: number; source: string | null; updated_at: string;
}
export interface VersionRow { version: number; definition_json: string; sha256: string; actor_id: string; published_at: string }
export interface RunRow {
  project_id: string; id: string; revision: number; flow_id: string; version: number | null; test: number;
  definition_json: string; inputs_json: string; pinned_json: string; mock_agents: number; state: FlowRunState;
  state_reason: string | null; trigger: string; parent_run_id: string | null; parent_node_id: string | null;
  depth: number; created_at: string; started_at: string | null; ended_at: string | null;
}
export interface NodeRow {
  node_id: string; iteration: number; attempt_no: number; state: FlowNodeRunState; port: string | null;
  input_json: string | null; output_json: string | null; error: string | null; task_id: string | null; approval_id: string | null;
  child_run_id: string | null; pinned: number; started_at: string | null; ended_at: string | null;
}
export const decode = <Value = unknown>(json: string): Value => JSON.parse(json) as Value;
export const definitionOf = (json: string): FlowDefinition => flowDefinitionSchema.parse(decode(json));
export const hash = (json: string): string => createHash("sha256").update(json).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function boundedJson(value: unknown, limit = 524288): string {
  const json = canonical(value);
  if (Buffer.byteLength(json) > limit) throw new CommandError("validation", "JSON exceeds the size limit", "correct-input");
  return json;
}
export const getFlow = (raw: Database, projectId: string, flowId: string) =>
  raw.prepare("SELECT * FROM flows WHERE project_id=? AND id=?").get(projectId, flowId) as FlowRow | undefined;
export const listFlows = (raw: Database, projectId: string) =>
  raw.prepare("SELECT * FROM flows WHERE project_id=? ORDER BY id").all(projectId) as FlowRow[];
export const flowByKey = (raw: Database, projectId: string, key: string) =>
  raw.prepare("SELECT * FROM flows WHERE project_id=? AND key=? AND archived=0").get(projectId, key) as FlowRow | undefined;
export const getVersion = (raw: Database, projectId: string, flowId: string, version?: number) =>
  raw.prepare("SELECT * FROM flow_versions WHERE project_id=? AND flow_id=? AND (? IS NULL OR version=?) ORDER BY version DESC LIMIT 1")
    .get(projectId, flowId, version ?? null, version ?? null) as VersionRow | undefined;
export const getRun = (raw: Database, projectId: string, runId: string) =>
  raw.prepare("SELECT * FROM flow_runs WHERE project_id=? AND id=?").get(projectId, runId) as RunRow | undefined;
export function latestNodes(raw: Database, run: RunRow): Map<string, NodeRow> {
  const rows = raw.prepare(`SELECT * FROM (SELECT *, row_number() OVER
    (PARTITION BY node_id ORDER BY iteration DESC,attempt_no DESC) AS rank FROM flow_node_runs WHERE project_id=? AND run_id=?) WHERE rank=1`)
    .all(run.project_id, run.id) as NodeRow[];
  return new Map(rows.map((row) => [row.node_id, row]));
}
export function emit(hub: EventHub, projectId: string, cause: string, entity: EntityRef): void {
  if (hub.currentCursor(projectId)) hub.append({ projectId, causationId: cause, payload: { type: "entity.changed", entity } });
}
export const runRef = (run: RunRow): EntityRef => ({ kind: "flow-run", id: run.id, revision: run.revision });
export const flowRef = (flow: FlowRow): EntityRef => ({ kind: "flow", id: flow.id, revision: flow.revision });
export function flowSummary(raw: Database, flow: FlowRow) {
  const version = getVersion(raw, flow.project_id, flow.id);
  return { id: flow.id, projectId: flow.project_id, key: flow.key, title: flow.title, revision: flow.revision,
    publishedVersion: version?.version ?? null, draftChanged: version?.sha256 !== hash(flow.draft_json),
    archived: Boolean(flow.archived), updatedAt: flow.updated_at, source: flow.source };
}
export function runSummary(run: RunRow) {
  return { id: run.id, projectId: run.project_id, flowId: run.flow_id, flowTitle: definitionOf(run.definition_json).title,
    version: run.version, test: Boolean(run.test), state: run.state, stateReason: run.state_reason, revision: run.revision,
    trigger: run.trigger, createdAt: run.created_at, startedAt: run.started_at, endedAt: run.ended_at };
}
export function nodeHistory(raw: Database, projectId: string, runId: string) {
  const rows = raw.prepare(`SELECT * FROM (SELECT * FROM flow_node_runs WHERE project_id=? AND run_id=?
    ORDER BY rowid DESC LIMIT 2000) ORDER BY iteration,node_id,attempt_no`).all(projectId, runId) as NodeRow[];
  return rows.map((row) => ({ nodeId: row.node_id, iteration: row.iteration, attemptNo: row.attempt_no, state: row.state,
    port: row.port, startedAt: row.started_at, endedAt: row.ended_at, error: row.error, taskId: row.task_id,
    approvalId: row.approval_id, childRunId: row.child_run_id, output: row.output_json === null ? null : decode(row.output_json), pinned: Boolean(row.pinned) }));
}
