import type { Database } from "better-sqlite3";
import { eventSchema, ruleInputSchema, type FactoryEvent, type RuleCondition, type RuleInput } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { EventHub } from "../events/hub.js";

export interface RuleDeps { raw: Database; hub: EventHub }
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
    action: JSON.parse(row.action_json) as RuleInput["action"], debounceSeconds: row.debounce_seconds,
    maxFiresPerHour: row.max_fires_per_hour, enabled: row.state === "active" };
}
export function validateRule(candidate: unknown): RuleInput {
  const parsed = ruleInputSchema.safeParse(candidate);
  if (!parsed.success) throw new CommandError("validation", "invalid rule input", "correct-input");
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
function facts(raw: Database, projectId: string, payload: FactoryEvent["payload"]): Record<string, string | undefined> {
  const fields: Record<string, string | undefined> = {};
  if (payload.type === "task.status-changed") {
    fields.to = payload.to;
    fields.taskCode = (raw.prepare("SELECT code FROM tasks WHERE project_id=? AND id=?").get(projectId, payload.taskId) as { code: string } | undefined)?.code;
  } else if (payload.type === "artifact.status-changed") {
    fields.to = payload.to;
    fields.artifactKind = (raw.prepare("SELECT kind FROM artifact_versions WHERE project_id=? AND artifact_id=? AND version=?")
      .get(projectId, payload.artifactId, payload.version) as { kind: string } | undefined)?.kind;
  } else if (payload.type === "monitor.changed") {
    fields.to = payload.to; fields.from = payload.from;
    const row = raw.prepare("SELECT name,kind FROM monitors WHERE project_id=? AND id=?").get(projectId, payload.monitorId) as { name: string; kind: string } | undefined;
    fields.monitorName = row?.name; fields.monitorKind = row?.kind;
  }
  return fields;
}
function fire(deps: RuleDeps, snapshot: RuleRow, sequence: number, now: Date): void {
  const { raw } = deps, at = now.toISOString();
  if (!raw.prepare(`INSERT INTO rule_fires (project_id,rule_id,event_sequence,status,depth,fired_at)
    VALUES (?,?,?,'skipped',?,?) ON CONFLICT(project_id,rule_id,event_sequence) DO NOTHING`)
    .run(snapshot.project_id, snapshot.id, sequence, 0, at).changes) return;
  const row = getRule(raw, snapshot.project_id, snapshot.id)!;
  const expired = row.window_start === null || now.getTime() - Date.parse(row.window_start) >= 3600000;
  const count = expired ? 0 : row.fires_in_window;
  const reason: string | null = JSON.parse(row.action_json).kind !== "observe" ? "retired action" : row.state !== "active" ? "rule inactive"
    : row.last_fired_at !== null && now.getTime() - Date.parse(row.last_fired_at) < row.debounce_seconds * 1000 ? "debounced"
    : count >= row.max_fires_per_hour ? "rate limit" : null;
  if (reason === "rate limit") raw.prepare("UPDATE automation_rules SET state='quarantined',revision=revision+1 WHERE project_id=? AND id=?").run(row.project_id, row.id);
  if (!reason) raw.prepare(`UPDATE automation_rules SET fires_in_window=?,window_start=?,last_fired_at=?,consecutive_failures=0
    WHERE project_id=? AND id=?`).run(count + 1, expired ? at : row.window_start, at, row.project_id, row.id);
  raw.prepare("UPDATE rule_fires SET status=?,reason=? WHERE project_id=? AND rule_id=? AND event_sequence=?")
    .run(reason ? "skipped" : "started", reason, row.project_id, row.id, sequence);
}
/** A project batch, its dedup records, commands, and watermark commit atomically. */
export function tickRules(deps: RuleDeps, now: Date): void {
  let reported = false;
  const report = (): void => { if (!reported) { reported = true; console.error("Rule tick failed"); } };
  try {
    const projects = deps.raw.prepare("SELECT DISTINCT r.project_id FROM automation_rules r JOIN projects p ON p.id=r.project_id WHERE r.state='active' AND p.disposition<>'archived' ORDER BY project_id").all() as { project_id: string }[];
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
              for (const rule of matching) if (matchesRule(JSON.parse(rule.condition_json) as RuleCondition, resolved))
                fire(deps, rule, event.sequence, now);
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
      return { id: row.id, revision: row.revision, name: row.name, eventType: row.event_type, condition: JSON.parse(row.condition_json) as RuleCondition,
        state: row.state, debounceSeconds: row.debounce_seconds, maxFiresPerHour: row.max_fires_per_hour, firesInWindow: row.fires_in_window,
        lastFiredAt: row.last_fired_at, consecutiveFailures: row.consecutive_failures,
        action: { kind: JSON.parse(row.action_json).kind === "observe" ? "observe" : "retired" } };
    });
}
export function listRuleFires(raw: Database, projectId: string, ruleId: string) {
  return raw.prepare(`SELECT event_sequence AS eventSequence,status,reason,instance_id AS instanceId,depth,fired_at AS firedAt
    FROM rule_fires WHERE project_id=? AND rule_id=? ORDER BY fired_at DESC,event_sequence DESC LIMIT 50`).all(projectId, ruleId);
}
