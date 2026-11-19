import type { Database } from "better-sqlite3";
import { groupDetailSchema, groupsResponseSchema, LIVE_ATTEMPT_STATES, type GroupDetail, type GroupsResponse } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import { groupTokenUsage } from "../policy/budget.js";
import { groupChain, readGroupSettings, resolveGroupSettings, subtreeProjects } from "./settings.js";

export function requireGroup(raw: Database, groupId: string, { active = false } = {}) {
  const row = raw.prepare<[string], { id: string; revision: number; parent_id: string | null; slug: string; name: string;
    description: string; path: string; depth: number; archived: number }>("SELECT * FROM groups WHERE id = ?").get(groupId);
  if (!row) throw new CommandError("not-found", "group not found", "correct-input");
  if (active && row.archived) throw new CommandError("conflict", "group is archived", "correct-input");
  return row;
}

const summaries = `SELECT g.id, g.revision, g.parent_id AS parentId, g.slug, g.name, g.description, g.path, g.depth,
  g.archived, g.updated_at AS updatedAt,
  (SELECT count(*) FROM projects WHERE group_id = g.id AND disposition <> 'archived') AS projectCount FROM groups g`;

function groupSummaries(raw: Database, condition: string, args: string[], limit: number) {
  return raw.prepare<string[], Omit<GroupDetail["group"], "archived"> & { archived: number }>(
    `${summaries} ${condition} ORDER BY g.path LIMIT ${limit}`).all(...args).map((row) => ({ ...row, archived: Boolean(row.archived) }));
}

export function listGroups(raw: Database): GroupsResponse {
  const projects = raw.prepare<[], { id: string; group_id: string }>(
    "SELECT id, group_id FROM projects WHERE group_id IS NOT NULL AND disposition <> 'archived'").all();
  return groupsResponseSchema.parse({ groups: groupSummaries(raw, "", [], 2_000),
    membership: Object.fromEntries(projects.map(({ id, group_id }) => [id, group_id])) });
}

export function getGroupDetail(raw: Database, groupId: string, now = new Date()): GroupDetail | undefined {
  const [group] = groupSummaries(raw, "WHERE g.id = ?", [groupId], 1);
  if (!group) return undefined;
  const effective = resolveGroupSettings(raw, groupId);
  const states = [...LIVE_ATTEMPT_STATES];
  const counts = raw.prepare<string[], Omit<GroupDetail["rollup"], "tasksByState" | "tokens30d" | "budgetTokens30d">>(`${subtreeProjects}
    SELECT (SELECT count(*) FROM members) AS projects,
      (SELECT count(*) FROM approvals WHERE project_id IN (SELECT id FROM members) AND state = 'pending') AS pendingApprovals,
      (SELECT count(*) FROM flow_runs WHERE project_id IN (SELECT id FROM members)
        AND state NOT IN ('succeeded','failed','cancelled')) AS activeFlowRuns,
      (SELECT count(*) FROM attempts WHERE project_id IN (SELECT id FROM members)
        AND state IN (${states.map(() => "?").join(",")})) AS liveAttempts`).get(groupId, ...states)!;
  const tasks = raw.prepare<[string], { state: string; count: number }>(`${subtreeProjects}
    SELECT state, count(*) AS count FROM tasks WHERE project_id IN (SELECT id FROM members) GROUP BY state`).all(groupId);
  const usage = groupTokenUsage(raw, groupId, now);
  const tokens30d = usage.unreported ? null : usage.used;
  return groupDetailSchema.parse({ group, ...readGroupSettings(raw, groupId), effective,
    ancestors: groupChain(raw, groupId).slice(1).reverse().map(({ id, slug, name }) => ({ id, slug, name })),
    children: groupSummaries(raw, "WHERE g.parent_id = ?", [groupId], 500),
    projects: raw.prepare("SELECT id, name, disposition FROM projects WHERE group_id = ? ORDER BY id LIMIT 1000").all(groupId),
    rollup: { ...counts, tasksByState: Object.fromEntries(tasks.map(({ state, count }) => [state, count])), tokens30d,
      budgetTokens30d: effective.budgetTokens30d.value },
  });
}
