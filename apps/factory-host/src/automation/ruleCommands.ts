import type { RuleInput } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap } from "../commands/pipeline.js";
import { getRule, ruleInput, validateRule, type RuleDeps, type RuleRow } from "./rules.js";

export const RULE_COMMANDS = ["rules.create", "rules.update", "rules.pause", "rules.resume", "rules.delete"] as const;
function project(ctx: HandlerContext, projectId: string): void {
  if (!ctx.raw.prepare("SELECT id FROM projects WHERE id=?").get(projectId)) throw new CommandError("not-found", "project not found", "correct-input");
}
function requireRule(ctx: HandlerContext, projectId: string, id: string, revision: number): RuleRow {
  project(ctx, projectId);
  const row = getRule(ctx.raw, projectId, id);
  if (!row) throw new CommandError("not-found", "rule not found", "correct-input");
  if (row.revision !== revision) throw new CommandError("conflict", "revision changed", "refresh", { currentRevision: row.revision });
  return row;
}
function unique(ctx: HandlerContext, projectId: string, id: string, name: string): void {
  if (ctx.raw.prepare("SELECT id FROM automation_rules WHERE project_id=? AND name=? AND id<>?").get(projectId, name, id))
    throw new CommandError("conflict", "rule name already exists", "correct-input");
}
const effect = (id: string, revision: number) => ({ effects: [{ kind: "rule" as const, id, revision }] });
function persist(ctx: HandlerContext, row: RuleRow, input: RuleInput, state: RuleRow["state"]) {
  unique(ctx, row.project_id, row.id, input.name);
  ctx.raw.prepare(`UPDATE automation_rules SET revision=revision+1,name=?,condition_json=?,action_json=?,debounce_seconds=?,
    max_fires_per_hour=?,state=? WHERE project_id=? AND id=?`).run(input.name, JSON.stringify(input.condition), JSON.stringify(input.action),
    input.debounceSeconds, input.maxFiresPerHour, state, row.project_id, row.id);
  return effect(row.id, row.revision + 1);
}
export function createRuleHandlers(deps: Pick<RuleDeps, "packs">): Partial<HandlerMap> {
  return {
    "rules.create": (ctx, { projectId, payload }) => {
      project(ctx, projectId);
      const { ruleId, ...candidate } = payload;
      if (getRule(ctx.raw, projectId, ruleId)) throw new CommandError("conflict", "rule id already exists", "correct-input");
      const input = validateRule(candidate, deps.packs);
      unique(ctx, projectId, ruleId, input.name);
      const count = ctx.raw.prepare("SELECT count(*) AS n FROM automation_rules WHERE project_id=?").get(projectId) as { n: number };
      if (count.n >= 30) throw new CommandError("resource-exhausted", "rule limit reached", "correct-input");
      ctx.raw.prepare(`INSERT INTO automation_rules (project_id,id,revision,name,event_type,condition_json,action_json,debounce_seconds,
        max_fires_per_hour,state,created_at) VALUES (?,?,1,?,?,?,?,?,?,?,?)`).run(projectId, ruleId, input.name, input.eventType,
        JSON.stringify(input.condition), JSON.stringify(input.action), input.debounceSeconds, input.maxFiresPerHour, input.enabled ? "active" : "paused", ctx.clock().toISOString());
      return effect(ruleId, 1);
    },
    "rules.update": (ctx, { projectId, payload }) => {
      const row = requireRule(ctx, projectId, payload.ruleId, payload.expectedRevision);
      const input = validateRule({ ...ruleInput(row), ...payload.patch }, deps.packs);
      // Only resume explicitly clears quarantine.
      return persist(ctx, row, input, row.state === "quarantined" ? "quarantined" : input.enabled ? "active" : "paused");
    },
    "rules.pause": (ctx, { projectId, payload }) => {
      const row = requireRule(ctx, projectId, payload.ruleId, payload.expectedRevision);
      return persist(ctx, row, ruleInput(row), "paused");
    },
    "rules.resume": (ctx, { projectId, payload }) => {
      const row = requireRule(ctx, projectId, payload.ruleId, payload.expectedRevision);
      validateRule(ruleInput(row), deps.packs);
      ctx.raw.prepare("UPDATE automation_rules SET fires_in_window=0,window_start=NULL,consecutive_failures=0 WHERE project_id=? AND id=?").run(projectId, row.id);
      return persist(ctx, row, ruleInput(row), "active");
    },
    "rules.delete": (ctx, { projectId, payload }) => {
      const row = requireRule(ctx, projectId, payload.ruleId, payload.expectedRevision);
      ctx.raw.prepare("DELETE FROM rule_fires WHERE project_id=? AND rule_id=?").run(projectId, row.id);
      ctx.raw.prepare("DELETE FROM automation_rules WHERE project_id=? AND id=?").run(projectId, row.id);
      return effect(row.id, row.revision + 1);
    },
  };
}
