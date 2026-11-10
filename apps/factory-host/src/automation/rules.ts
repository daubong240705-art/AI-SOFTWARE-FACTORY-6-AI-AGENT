import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import { eventSchema, ruleInputSchema, type FactoryEvent, type RuleAction, type RuleCondition, type RuleInput } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import { resolveScheduleAction } from "../schedule/service.js";
import type { SchedulerDeps } from "../schedule/scheduler.js";

export type RuleDeps = SchedulerDeps;
export interface RuleRow {
  project_id: string; id: string; revision: number; name: string; event_type: RuleInput["eventType"];
  condition_json: string; action_json: string; debounce_seconds: number; max_fires_per_hour: number;
  state: "active" | "paused" | "quarantined"; fires_in_window: number; window_start: string | null;
  last_fired_at: string | null; consecutive_failures: number; created_at: string;
}
export function getRule(raw: Database, projectId: string, id: string): RuleRow | undefined {
  return raw.prepare("SELECT * FROM automation_rules WHERE project_id=? AND id=?").get(projectId, id) as RuleRow | undefined;
}
export function ruleInput(row: RuleRow): RuleInput {
  return { name: row.name, eventType: row.event_type, condition: JSON.parse(row.condition_json) as RuleCondition,
    action: JSON.parse(row.action_json) as RuleAction, debounceSeconds: row.debounce_seconds,
    maxFiresPerHour: row.max_fires_per_hour, enabled: row.state === "active" };
}
export function validateRule(candidate: unknown, packs: RuleDeps["packs"]): RuleInput {
  const parsed = ruleInputSchema.safeParse(candidate);
  if (!parsed.success) throw new CommandError("validation", "invalid rule input", "correct-input");
  resolveScheduleAction(packs, { ...parsed.data.action, autoStart: true });
  return parsed.data;
}
export function matchesRule(condition: RuleCondition, fields: Readonly<Record<string, string | undefined>>): boolean {
  if ("all" in condition) return condition.all.every((c) => matchesRule(c, fields));
  if ("any" in condition) return condition.any.some((c) => matchesRule(c, fields));
  if ("not" in condition) return !matchesRule(condition.not, fields);
  const actual = fields[condition.field];
  if (actual === undefined) return false;
  return condition.op === "in" ? condition.value.includes(actual) : condition.op === "eq" ? actual === condition.value : actual !== condition.value;
}
/** Purpose separation keeps command receipts distinct while the create id identifies the instance. */
export function ruleFireId(projectId: string, ruleId: string, sequence: number, purpose = "create"): string {
  const identity = `${projectId}|${ruleId}|${sequence}`;
  const hex = createHash("sha256").update(purpose === "create" ? identity : `${identity}|${purpose}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function facts(raw: Database, projectId: string, payload: FactoryEvent["payload"]): { fields: Record<string, string | undefined>; depth: number } {
  let instanceId: string | undefined;
  const fields: Record<string, string | undefined> = {};
  if (payload.type === "task.status-changed") {
    fields.to = payload.to;
    fields.taskCode = (raw.prepare("SELECT code FROM tasks WHERE project_id=? AND id=?").get(projectId, payload.taskId) as { code: string } | undefined)?.code;
    instanceId = (raw.prepare("SELECT instance_id FROM workflow_stage_tasks WHERE project_id=? AND task_id=? ORDER BY instance_id LIMIT 1")
      .get(projectId, payload.taskId) as { instance_id: string } | undefined)?.instance_id;
  } else if (payload.type === "artifact.status-changed") {
    fields.to = payload.to;
    fields.artifactKind = (raw.prepare("SELECT kind FROM artifact_versions WHERE project_id=? AND artifact_id=? AND version=?")
      .get(projectId, payload.artifactId, payload.version) as { kind: string } | undefined)?.kind;
    instanceId = (raw.prepare(`SELECT l.instance_id FROM artifact_versions v JOIN attempts a
      ON a.project_id=v.project_id AND a.id=v.produced_by_attempt_id JOIN workflow_stage_tasks l
      ON l.project_id=a.project_id AND l.task_id=a.task_id WHERE v.project_id=? AND v.artifact_id=? AND v.version=?
      ORDER BY l.instance_id LIMIT 1`).get(projectId, payload.artifactId, payload.version) as { instance_id: string } | undefined)?.instance_id;
  } else if (payload.type === "workflow.state-changed") {
    fields.to = payload.to; instanceId = payload.instanceId;
    fields.workflowKey = (raw.prepare("SELECT key FROM workflow_instances WHERE project_id=? AND id=?")
      .get(projectId, instanceId) as { key: string } | undefined)?.key;
  } else if (payload.type === "monitor.changed") {
    fields.to = payload.to; fields.from = payload.from;
    const row = raw.prepare("SELECT name,kind FROM monitors WHERE project_id=? AND id=?").get(projectId, payload.monitorId) as { name: string; kind: string } | undefined;
    fields.monitorName = row?.name; fields.monitorKind = row?.kind;
  }
  const parent = instanceId === undefined ? undefined : raw.prepare(`SELECT MAX(depth) AS depth FROM rule_fires
    WHERE project_id=? AND instance_id=? AND status='started'`).get(projectId, instanceId) as { depth: number | null };
  return { fields, depth: parent?.depth === null || parent?.depth === undefined ? 0 : parent.depth + 1 };
}
function fire(deps: RuleDeps, snapshot: RuleRow, sequence: number, depth: number, now: Date): void {
  const { raw } = deps, at = now.toISOString();
  if (!raw.prepare(`INSERT INTO rule_fires (project_id,rule_id,event_sequence,status,depth,fired_at)
    VALUES (?,?,?,'skipped',?,?) ON CONFLICT(project_id,rule_id,event_sequence) DO NOTHING`)
    .run(snapshot.project_id, snapshot.id, sequence, Math.min(10, depth), at).changes) return;
  const row = getRule(raw, snapshot.project_id, snapshot.id)!;
  const expired = row.window_start === null || now.getTime() - Date.parse(row.window_start) >= 3600000;
  const count = expired ? 0 : row.fires_in_window;
  let reason: string | null = depth > 3 ? "hop limit" : row.state !== "active" ? "rule inactive"
    : row.last_fired_at !== null && now.getTime() - Date.parse(row.last_fired_at) < row.debounce_seconds * 1000 ? "debounced"
    : count >= row.max_fires_per_hour ? "rate limit" : null;
  if (reason === "rate limit") raw.prepare("UPDATE automation_rules SET state='quarantined',revision=revision+1 WHERE project_id=? AND id=?").run(row.project_id, row.id);
  if (!reason && raw.prepare(`SELECT 1 FROM rule_fires f JOIN workflow_instances w ON w.project_id=f.project_id AND w.id=f.instance_id
    WHERE f.project_id=? AND f.rule_id=? AND w.state NOT IN ('completed','failed','cancelled','superseded') LIMIT 1`).get(row.project_id, row.id)) reason = "previous still running";
  let status = "skipped", instanceId: string | null = null;
  if (!reason) {
    try {
      const action = JSON.parse(row.action_json) as RuleAction;
      const definition = resolveScheduleAction(deps.packs, { ...action, autoStart: true });
      const id = ruleFireId(row.project_id, row.id, sequence);
      const command = (type: string, payload: unknown, purpose: string): void => {
        const result = deps.pipeline.execute({ apiVersion: 1, projectId: row.project_id,
          commandId: ruleFireId(row.project_id, row.id, sequence, purpose), type, payload }, "rule-evaluator");
        if (!result.body.ok) throw new Error("Workflow command rejected");
      };
      raw.transaction(() => {
        command("workflows.create", { instanceId: id, definitionKey: action.definitionKey,
          ...(action.packKey === undefined ? {} : { packKey: action.packKey }),
          ...(action.params === undefined ? {} : { params: action.params }),
          title: action.title ?? `${definition.title} (rule ${row.name})`.slice(0, 160) }, "create");
        command("workflows.start", { instanceId: id, expectedRevision: 1 }, "start");
      })();
      status = "started"; instanceId = id;
      raw.prepare(`UPDATE automation_rules SET fires_in_window=?,window_start=?,last_fired_at=?,consecutive_failures=0
        WHERE project_id=? AND id=?`).run(count + 1, expired ? at : row.window_start, at, row.project_id, row.id);
    } catch {
      status = "failed"; reason = "workflow start failed";
      const failures = Math.min(10, row.consecutive_failures + 1);
      raw.prepare(`UPDATE automation_rules SET consecutive_failures=?,state=?,revision=revision+? WHERE project_id=? AND id=?`)
        .run(failures, failures >= 3 ? "quarantined" : row.state, failures >= 3 ? 1 : 0, row.project_id, row.id);
    }
  }
  raw.prepare("UPDATE rule_fires SET status=?,reason=?,instance_id=? WHERE project_id=? AND rule_id=? AND event_sequence=?")
    .run(status, reason, instanceId, row.project_id, row.id, sequence);
}
/** A project batch, its dedup records, commands, and watermark commit atomically. */
export function tickRules(deps: RuleDeps, now: Date): void {
  let reported = false;
  const report = (): void => { if (!reported) { reported = true; console.error("Rule tick failed"); } };
  try {
    const projects = deps.raw.prepare("SELECT DISTINCT project_id FROM automation_rules WHERE state='active' ORDER BY project_id").all() as { project_id: string }[];
    for (const project of projects) try {
      deps.hub.transaction(() => {
        const projectId = project.project_id;
        const stream = deps.hub.currentCursor(projectId);
        if (!stream) return;
        const rules = deps.raw.prepare("SELECT * FROM automation_rules WHERE project_id=? AND state='active' ORDER BY created_at,id").all(projectId) as RuleRow[];
        const cursor = deps.raw.prepare("SELECT last_sequence FROM automation_cursors WHERE project_id=?").get(projectId) as { last_sequence: number } | undefined;
        const events = deps.raw.prepare(`SELECT sequence,body_json FROM event_log WHERE project_id=? AND epoch=? AND sequence>?
          ORDER BY sequence LIMIT 200`).all(projectId, stream.epoch, cursor?.last_sequence ?? 0) as { sequence: number; body_json: string }[];
        for (const event of events) {
          const parsed = eventSchema.safeParse(JSON.parse(event.body_json) as unknown);
          if (parsed.success && parsed.data.projectId === projectId) {
            const matching = rules.filter((r) => r.event_type === parsed.data.payload.type);
            if (matching.length) {
              const resolved = facts(deps.raw, projectId, parsed.data.payload);
              for (const rule of matching) if (matchesRule(JSON.parse(rule.condition_json) as RuleCondition, resolved.fields))
                fire(deps, rule, event.sequence, resolved.depth, now);
            }
          }
          deps.raw.prepare(`INSERT INTO automation_cursors VALUES (?,?) ON CONFLICT(project_id)
            DO UPDATE SET last_sequence=excluded.last_sequence`).run(projectId, event.sequence);
        }
      });
    } catch { report(); }
  } catch { report(); }
}
export function listRules(raw: Database, projectId: string) {
  return (raw.prepare("SELECT * FROM automation_rules WHERE project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100").all(projectId) as RuleRow[])
    .map((row) => {
      const action = JSON.parse(row.action_json) as RuleAction;
      return { id: row.id, revision: row.revision, name: row.name, eventType: row.event_type, condition: JSON.parse(row.condition_json) as RuleCondition,
        state: row.state, debounceSeconds: row.debounce_seconds, maxFiresPerHour: row.max_fires_per_hour, firesInWindow: row.fires_in_window,
        lastFiredAt: row.last_fired_at, consecutiveFailures: row.consecutive_failures,
        action: { definitionKey: action.definitionKey, packKey: action.packKey ?? null, paramKeys: Object.keys(action.params ?? {}).sort() } };
    });
}
export function listRuleFires(raw: Database, projectId: string, ruleId: string) {
  return raw.prepare(`SELECT event_sequence AS eventSequence,status,reason,instance_id AS instanceId,depth,fired_at AS firedAt
    FROM rule_fires WHERE project_id=? AND rule_id=? ORDER BY fired_at DESC,event_sequence DESC LIMIT 50`).all(projectId, ruleId);
}
