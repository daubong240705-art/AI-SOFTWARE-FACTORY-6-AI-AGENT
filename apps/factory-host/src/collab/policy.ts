import type { AgentConfig, Seat } from "@factory/contracts";
import { groupSettingsSchema } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import { groupChain, projectGroupId, subtreeProjects } from "../groups/settings.js";
import { currentAgentConfig, groupIdsForAgent } from "../org/agents.js";
import { checkAndReserve, countedTokens, dayKey, effectiveBudget, groupTokenUsage, usedTokens, type BudgetConfig } from "../policy/budget.js";

export const terminalTasks = "'done','failed','cancelled','declined','superseded'";
export const isTerminalTask = (state: string) => ["done", "failed", "cancelled", "declined", "superseded"].includes(state);

export function assignmentScope(raw: Database, projectId: string, agentId: string, config: AgentConfig): (seat: Seat) => boolean {
  switch (config.delegation.canAssign) {
    case "none": return () => false;
    case "project": return () => true;
    case "relations": return (seat) => Boolean(raw.prepare(`SELECT 1 FROM agent_relations WHERE project_id=?
      AND from_agent_id=? AND to_agent_id=? AND kind='manages'`).get(projectId, agentId, seat.id));
    case "team": {
      const groups = new Set(groupIdsForAgent(raw, projectId, agentId));
      return (seat) => groupIdsForAgent(raw, projectId, seat.id).some((id) => groups.has(id));
    }
  }
}

function trigrams(text: string): Set<string> {
  const normalized = `  ${text.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()}  `;
  return new Set(Array.from({ length: normalized.length - 2 }, (_, index) => normalized.slice(index, index + 3)));
}

export function duplicateTask(raw: Database, projectId: string, title: string): string | undefined {
  const incoming = trigrams(title);
  const tasks = raw.prepare(`SELECT id,title FROM tasks WHERE project_id=? AND state NOT IN (${terminalTasks}) ORDER BY code,id`)
    .all(projectId) as { id: string; title: string }[];
  let best: string | undefined;
  let threshold = 0.8;
  for (const task of tasks) {
    const candidate = trigrams(task.title);
    const similarity = 2 * [...candidate].filter((part) => incoming.has(part)).length / (candidate.size + incoming.size);
    if (similarity >= threshold && (best === undefined || similarity > threshold)) { best = task.id; threshold = similarity; }
  }
  return best;
}

export function budgetRefusal(raw: Database, input: { projectId: string; taskId: string; target: Seat; estimateTokens: number;
  now: Date; config: BudgetConfig }): string | undefined {
  const { projectId, target, estimateTokens, now, config } = input;
  const check = checkAndReserve(raw, input);
  if (!check.ok) return `budget:${check.scope}`;
  const targetBudget = currentAgentConfig(raw, target.id)?.config.budget;
  if (estimateTokens > (targetBudget?.perTaskTokens ?? config.defaultTaskTokens)) return "budget:agent-task";
  const reservations = raw.prepare(`SELECT t.owner_seat_id,t.engagement_id,t.id,a.estimate_tokens FROM collab_assignments a
    JOIN tasks t ON t.project_id=a.project_id AND t.id=a.task_id WHERE t.project_id=? AND t.state NOT IN (${terminalTasks})`)
    .all(projectId) as { owner_seat_id: string; engagement_id: string; id: string; estimate_tokens: number }[];
  const remaining = (row: typeof reservations[number]) => Math.max(0, row.estimate_tokens - usedTokens(raw, projectId, "task", row.id, config));
  const reserved = reservations.reduce((sum, row) => sum + remaining(row), 0);
  for (const { id, settings_json } of groupChain(raw, projectGroupId(raw, projectId))) {
    if (!settings_json) continue;
    const limit = groupSettingsSchema.parse(JSON.parse(settings_json)).budgetTokens30d;
    if (limit === null) continue;
    const others = raw.prepare(`${subtreeProjects}
      SELECT t.id,t.project_id,a.estimate_tokens FROM collab_assignments a JOIN tasks t ON t.project_id=a.project_id AND t.id=a.task_id
      WHERE t.project_id<>? AND t.project_id IN (SELECT id FROM members) AND t.state NOT IN (${terminalTasks})`)
      .all(id, projectId) as { id: string; project_id: string; estimate_tokens: number }[];
    const held = others.reduce((sum, row) => sum + Math.max(0, row.estimate_tokens - usedTokens(raw, row.project_id, "task", row.id, config)), reserved);
    if (groupTokenUsage(raw, id, now).used + held + estimateTokens > limit) return "budget:group";
  }
  const engagement = raw.prepare("SELECT id FROM engagements WHERE project_id=? AND team_id=? AND state='active' ORDER BY priority DESC,id LIMIT 1")
    .get(projectId, target.teamId) as { id: string } | undefined;
  const scopes = [{ scope: "day" as const, ref: dayKey(now, config.utcOffsetMinutes), reserved },
    { scope: "project" as const, ref: projectId, reserved }];
  for (const scope of scopes) {
    const budget = effectiveBudget(raw, projectId, scope.scope, scope.ref, config);
    if (budget && usedTokens(raw, projectId, scope.scope, scope.ref, config) + scope.reserved + estimateTokens > budget.limitTokens)
      return `budget:${scope.scope}`;
  }
  if (engagement) {
    const budget = effectiveBudget(raw, projectId, "engagement", engagement.id, config);
    const held = reservations.filter((row) => row.engagement_id === engagement.id).reduce((sum, row) => sum + remaining(row), 0);
    if (budget && usedTokens(raw, projectId, "engagement", engagement.id, config) + held + estimateTokens > budget.limitTokens) return "budget:engagement";
  }
  if (targetBudget?.monthlyTokens) {
    const month = now.toISOString().slice(0, 7);
    const usage = raw.prepare(`SELECT u.* FROM usage_records u JOIN attempt_seats a ON a.project_id=u.project_id AND a.attempt_id=u.attempt_id
      WHERE u.project_id=? AND a.seat_id=? AND substr(u.recorded_at,1,7)=?`).all(projectId, target.id, month) as Parameters<typeof countedTokens>[0][];
    const held = reservations.filter((row) => row.owner_seat_id === target.id).reduce((sum, row) => sum + remaining(row), 0);
    if (usage.reduce((sum, row) => sum + countedTokens(row), 0) + held + estimateTokens > targetBudget.monthlyTokens) return "budget:agent-month";
  }
}
