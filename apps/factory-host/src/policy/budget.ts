import type { Database } from "better-sqlite3";
import {
  billableTokens, budgetSchema, canReserve, evaluateBudget, type Budget, type BudgetVerdict, type Usage,
} from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerMap } from "../commands/pipeline.js";
import type { ReasoningEffort } from "../models/gateway.js";

export interface BudgetConfig {
  defaultTaskTokens: number; defaultDayTokens: number; warnAtPercent: number; utcOffsetMinutes: number;
}
export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  defaultTaskTokens: 200_000, defaultDayTokens: 1_000_000, warnAtPercent: 80, utcOffsetMinutes: 420,
};
type Scope = Budget["scope"];
interface UsageRow {
  input_tokens: number | null; cached_input_tokens: number | null;
  output_tokens: number | null; reasoning_output_tokens: number | null;
  estimated_tokens: number | null; recorded_at: string;
}
interface BudgetRow {
  project_id: string; id: string; revision: number; scope: Scope; scope_ref: string;
  limit_tokens: number; warn_at_percent: number;
}
interface EffectiveBudget { limitTokens: number; warnAtPercent: number; source: "explicit" | "default" }

export function dayKey(now: Date, utcOffsetMinutes: number): string {
  return new Date(now.getTime() + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function recordUsage(raw: Database, input: {
  id: string; projectId: string; taskId: string | null; attemptId: string | null; conversationId: string | null;
  provider: string; model: string; effort: ReasoningEffort | null; usage: Usage | null;
  estimatedTokens: number | null; recordedAt: string;
}): void {
  if (input.attemptId === null && input.conversationId === null)
    throw new Error("Usage must name an attempt or a conversation");
  if (input.attemptId !== null && input.taskId === null)
    throw new Error("Attempt usage must name its task");
  // An unreported call must carry its reservation, otherwise budgets would count it as zero.
  if (input.usage === null && input.estimatedTokens === null)
    throw new Error("Usage without reported tokens needs an estimate");
  raw.prepare(`INSERT INTO usage_records (project_id, id, task_id, attempt_id, conversation_id, provider, model, effort,
    input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, estimated_tokens,
    cost_kind, cost_amount, cost_currency, cost_unknown_reason, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(input.projectId, input.id, input.taskId, input.attemptId, input.conversationId, input.provider, input.model, input.effort,
      input.usage?.inputTokens ?? null, input.usage?.cachedInputTokens ?? null,
      input.usage?.outputTokens ?? null, input.usage?.reasoningOutputTokens ?? null, input.estimatedTokens,
      "unknown", null, null, "no price list", input.recordedAt);
}

export function countedTokens(row: Omit<UsageRow, "recorded_at">): number {
  if (row.input_tokens === null || row.output_tokens === null) return row.estimated_tokens ?? 0;
  return billableTokens({ inputTokens: row.input_tokens, outputTokens: row.output_tokens,
    cachedInputTokens: row.cached_input_tokens ?? 0, reasoningOutputTokens: row.reasoning_output_tokens ?? 0 });
}

export function usedTokens(raw: Database, projectId: string, scope: Scope, ref: string, config: BudgetConfig): number {
  const rows = (scope === "task"
    ? raw.prepare("SELECT * FROM usage_records WHERE project_id = ? AND task_id = ?").all(projectId, ref)
    : raw.prepare("SELECT * FROM usage_records WHERE project_id = ?").all(projectId)) as UsageRow[];
  return rows.reduce((sum, row) => sum + (scope === "task" || dayKey(new Date(row.recorded_at), config.utcOffsetMinutes) === ref
    ? countedTokens(row) : 0), 0);
}

export function effectiveBudget(raw: Database, projectId: string, scope: Scope, ref: string, config: BudgetConfig): EffectiveBudget {
  const row = raw.prepare("SELECT * FROM budgets WHERE project_id = ? AND scope = ? AND scope_ref = ?")
    .get(projectId, scope, ref) as BudgetRow | undefined;
  return row ? { limitTokens: row.limit_tokens, warnAtPercent: row.warn_at_percent, source: "explicit" }
    : { limitTokens: scope === "day" ? config.defaultDayTokens : config.defaultTaskTokens,
      warnAtPercent: config.warnAtPercent, source: "default" };
}

export function checkAndReserve(raw: Database, input: {
  projectId: string; taskId: string | null; now: Date; estimateTokens: number; config: BudgetConfig;
}): { ok: true; warnings: Array<{ scope: Scope; verdict: "warn" }> }
  | { ok: false; scope: Scope; verdict: "exceeded" | "would-exceed"; used: number; limit: number } {
  if (!Number.isSafeInteger(input.estimateTokens) || input.estimateTokens < 0)
    throw new Error("estimateTokens must be a nonnegative safe integer");
  const { projectId, taskId, now, config } = input;
  const scopes: Array<{ scope: Scope; ref: string }> = [{ scope: "day", ref: dayKey(now, config.utcOffsetMinutes) }];
  if (taskId !== null) scopes.push({ scope: "task", ref: taskId });
  const warnings: Array<{ scope: Scope; verdict: "warn" }> = [];
  for (const { scope, ref } of scopes) {
    const budget = effectiveBudget(raw, projectId, scope, ref, config);
    const used = usedTokens(raw, projectId, scope, ref, config);
    const verdict = evaluateBudget(budget, used);
    if (verdict === "exceeded" || !canReserve(budget, used, input.estimateTokens))
      return { ok: false, scope, verdict: verdict === "exceeded" ? verdict : "would-exceed", used, limit: budget.limitTokens };
    if (verdict === "warn") warnings.push({ scope, verdict });
  }
  return { ok: true, warnings };
}

export function budgetStatus(raw: Database, projectId: string, now: Date, config: BudgetConfig): {
  day: { date: string; used: number; limit: number; verdict: BudgetVerdict; source: EffectiveBudget["source"] };
  tasks: Array<{ taskId: string; code: string; used: number; limit: number; verdict: BudgetVerdict; source: EffectiveBudget["source"] }>;
} {
  const status = (scope: Scope, ref: string) => {
    const budget = effectiveBudget(raw, projectId, scope, ref, config);
    const used = usedTokens(raw, projectId, scope, ref, config);
    return { used, limit: budget.limitTokens, verdict: evaluateBudget(budget, used), source: budget.source };
  };
  const date = dayKey(now, config.utcOffsetMinutes);
  const tasks = raw.prepare(`SELECT id, code FROM tasks WHERE project_id = ? AND
    (id IN (SELECT task_id FROM usage_records WHERE project_id = ?)
      OR id IN (SELECT scope_ref FROM budgets WHERE project_id = ? AND scope = ?)) ORDER BY code, id`)
    .all(projectId, projectId, projectId, "task") as { id: string; code: string }[];
  return { day: { date, ...status("day", date) },
    tasks: tasks.map((task) => ({ taskId: task.id, code: task.code, ...status("task", task.id) })) };
}

export const budgetsSetHandler: HandlerMap["budgets.set"] = ({ raw }, { projectId, payload }) => {
  if (!raw.prepare("SELECT id FROM projects WHERE id = ?").get(projectId))
    throw new CommandError("not-found", "project not found", "correct-input");
  if (payload.scope === "task" && !raw.prepare("SELECT id FROM tasks WHERE project_id = ? AND id = ?").get(projectId, payload.scopeRef))
    throw new CommandError("not-found", "task not found in project", "correct-input");
  const parsed = budgetSchema.safeParse({ id: payload.budgetId, projectId, scope: payload.scope,
    scopeRef: payload.scopeRef, limitTokens: payload.limitTokens, warnAtPercent: payload.warnAtPercent });
  if (!parsed.success) throw new CommandError("validation", "invalid budget", "correct-input");
  if (payload.scope === "day") {
    const date = new Date(`${payload.scopeRef}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== payload.scopeRef)
      throw new CommandError("validation", "day budget must use a real calendar date YYYY-MM-DD", "correct-input");
  }
  const identities = raw.prepare("SELECT * FROM budgets WHERE id = ?").all(payload.budgetId) as BudgetRow[];
  if (identities.some((row) => row.project_id !== projectId || row.scope !== payload.scope || row.scope_ref !== payload.scopeRef))
    throw new CommandError("conflict", "budget id already belongs to another scope or project", "correct-input");
  const stored = raw.prepare("SELECT * FROM budgets WHERE project_id = ? AND scope = ? AND scope_ref = ?")
    .get(projectId, payload.scope, payload.scopeRef) as BudgetRow | undefined;
  if (stored && (stored.id !== payload.budgetId || payload.expectedRevision !== stored.revision))
    throw new CommandError("conflict", "budget revision changed", "refresh", { currentRevision: stored.revision });
  if (!stored && payload.expectedRevision !== null)
    throw new CommandError("conflict", "budget does not exist", "refresh");
  const revision = stored ? stored.revision + 1 : 1;
  if (stored) {
    raw.prepare("UPDATE budgets SET revision = ?, limit_tokens = ?, warn_at_percent = ? WHERE project_id = ? AND id = ?")
      .run(revision, payload.limitTokens, payload.warnAtPercent, projectId, payload.budgetId);
  } else {
    raw.prepare(`INSERT INTO budgets (project_id, id, revision, scope, scope_ref, limit_tokens, warn_at_percent)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(projectId, payload.budgetId, revision, payload.scope, payload.scopeRef, payload.limitTokens, payload.warnAtPercent);
  }
  return { effects: [{ kind: "budget", id: payload.budgetId, revision }] };
};
