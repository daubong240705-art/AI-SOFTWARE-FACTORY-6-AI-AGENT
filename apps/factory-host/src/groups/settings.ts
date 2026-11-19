import type { Database } from "better-sqlite3";
import { groupSettingsSchema, type GroupDetail, type GroupSettings } from "@factory/contracts";

export const groupSubtree = `WITH RECURSIVE subtree(id) AS (
  SELECT id FROM groups WHERE id = ? UNION ALL SELECT g.id FROM groups g JOIN subtree s ON g.parent_id = s.id
)`;
export const subtreeProjects = `${groupSubtree}, members(id) AS (SELECT p.id FROM projects p JOIN subtree s ON p.group_id = s.id)`;

export function projectGroupId(raw: Database, projectId: string): string | null {
  return raw.prepare<[string], { group_id: string | null }>("SELECT group_id FROM projects WHERE id = ?").get(projectId)?.group_id ?? null;
}

export function groupChain(raw: Database, groupId: string | null) {
  return raw.prepare<[string | null], { id: string; slug: string; name: string; settings_json: string | null }>(`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, slug, name, depth FROM groups WHERE id = ?
      UNION ALL
      SELECT g.id, g.parent_id, g.slug, g.name, g.depth FROM groups g JOIN chain c ON g.id = c.parent_id
    )
    SELECT c.id, c.slug, c.name, s.settings_json FROM chain c LEFT JOIN group_settings s ON s.group_id = c.id ORDER BY c.depth DESC
  `).all(groupId);
}

export function readGroupSettings(raw: Database, groupId: string): { settings: GroupSettings; settingsRevision: number } {
  const row = raw.prepare<[string], { revision: number; settings_json: string }>(
    "SELECT revision, settings_json FROM group_settings WHERE group_id = ?").get(groupId);
  return { settings: groupSettingsSchema.parse(row ? JSON.parse(row.settings_json) : {}), settingsRevision: row?.revision ?? 0 };
}

export function resolveGroupSettings(raw: Database, groupId: string | null): GroupDetail["effective"] {
  const chain = groupChain(raw, groupId).flatMap(({ id, settings_json }) => settings_json === null ? [] :
    [{ id, settings: groupSettingsSchema.parse(JSON.parse(settings_json)) }]);
  const resolve = <Key extends keyof GroupSettings>(key: Key) => {
    for (const { id, settings } of chain) {
      const value = settings[key];
      if (value !== null) return { value, source: { groupId: id } };
    }
    return { value: null, source: "default" as const };
  };
  return { defaultModel: resolve("defaultModel"), defaultAdapter: resolve("defaultAdapter"),
    defaultEffort: resolve("defaultEffort"), budgetTokens30d: resolve("budgetTokens30d") };
}

export function resolveProjectSettings(raw: Database, projectId: string): GroupDetail["effective"] {
  return resolveGroupSettings(raw, projectGroupId(raw, projectId));
}
