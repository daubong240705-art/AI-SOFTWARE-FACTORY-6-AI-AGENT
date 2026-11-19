import type { Database } from "better-sqlite3";
import { GROUP_MAX_DEPTH, SYSTEM_SCOPE_ID, groupSettingsSchema, type EntityRef } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerMap } from "../commands/pipeline.js";
import { requireGroup } from "./service.js";
import { groupSubtree, readGroupSettings } from "./settings.js";

export const GROUP_COMMANDS = ["groups.create", "groups.update", "groups.move", "groups.archive", "groups.delete",
  "groups.set-settings", "projects.set-group"] as const;

function effect(id: string, revision: number): { effects: EntityRef[] } {
  return { effects: [{ kind: "group", id, revision }] };
}

function checkRevision(actual: number, expected: number): void {
  if (actual !== expected) throw new CommandError("conflict", "revision changed", "refresh",
    actual === 0 ? undefined : { currentRevision: actual });
}

function requireSystemScope(projectId: string): void {
  if (projectId !== SYSTEM_SCOPE_ID) throw new CommandError("validation", "group commands use the system scope", "correct-input");
}

function checkPath(raw: Database, path: string, groupId: string): void {
  if (raw.prepare("SELECT 1 FROM groups WHERE path = ? AND id <> ?").get(path, groupId))
    throw new CommandError("conflict", "group path already exists", "correct-input");
}

function rewriteDescendants(raw: Database, group: ReturnType<typeof requireGroup>, path: string, depth: number, now: string): void {
  if (path === group.path) return;
  raw.prepare(`${groupSubtree} UPDATE groups SET path = ? || substr(path, ?), depth = depth + ?,
    revision = revision + 1, updated_at = ? WHERE id IN (SELECT id FROM subtree) AND id <> ?`)
    .run(group.id, path, group.path.length + 1, depth - group.depth, now, group.id);
}

export function createGroupHandlers(): Pick<HandlerMap, (typeof GROUP_COMMANDS)[number]> {
  return {
    "groups.create": ({ raw, clock }, { projectId, payload }) => {
      requireSystemScope(projectId);
      if (raw.prepare("SELECT 1 FROM groups WHERE id = ?").get(payload.groupId))
        throw new CommandError("conflict", "group id already exists", "correct-input");
      const parent = payload.parentId === null ? null : requireGroup(raw, payload.parentId, { active: true });
      const depth = (parent?.depth ?? 0) + 1;
      if (depth > GROUP_MAX_DEPTH) throw new CommandError("validation", "group nesting exceeds maximum depth", "correct-input");
      const path = parent ? `${parent.path}/${payload.slug}` : payload.slug;
      checkPath(raw, path, payload.groupId);
      const now = clock().toISOString();
      raw.prepare(`INSERT INTO groups (id, revision, parent_id, slug, name, description, path, depth, archived, created_at, updated_at)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(payload.groupId, payload.parentId, payload.slug, payload.name, payload.description, path, depth, now, now);
      return effect(payload.groupId, 1);
    },
    "groups.update": ({ raw, clock }, { projectId, payload }) => {
      requireSystemScope(projectId);
      const group = requireGroup(raw, payload.groupId);
      checkRevision(group.revision, payload.expectedRevision);
      const slug = payload.slug ?? group.slug;
      const path = group.path.slice(0, -group.slug.length) + slug;
      checkPath(raw, path, group.id);
      const now = clock().toISOString();
      raw.prepare(`UPDATE groups SET slug = ?, name = ?, description = ?, path = ?, revision = revision + 1, updated_at = ? WHERE id = ?`)
        .run(slug, payload.name ?? group.name, payload.description ?? group.description, path, now, group.id);
      rewriteDescendants(raw, group, path, group.depth, now);
      return effect(group.id, group.revision + 1);
    },
    "groups.move": ({ raw, clock }, { projectId, payload }) => {
      requireSystemScope(projectId);
      const group = requireGroup(raw, payload.groupId);
      checkRevision(group.revision, payload.expectedRevision);
      const parent = payload.parentId === null ? null : requireGroup(raw, payload.parentId, { active: true });
      const bounds = raw.prepare<[string, string | null], { maxDepth: number; cycle: number }>(`${groupSubtree}
        SELECT max(depth) AS maxDepth, count(CASE WHEN id = ? THEN 1 END) AS cycle
        FROM groups WHERE id IN (SELECT id FROM subtree)`).get(group.id, payload.parentId)!;
      if (bounds.cycle) throw new CommandError("validation", "group move would create a cycle", "correct-input");
      const depth = (parent?.depth ?? 0) + 1;
      if (depth + bounds.maxDepth - group.depth > GROUP_MAX_DEPTH)
        throw new CommandError("validation", "group move exceeds maximum depth", "correct-input");
      const path = parent ? `${parent.path}/${group.slug}` : group.slug;
      checkPath(raw, path, group.id);
      const now = clock().toISOString();
      raw.prepare(`UPDATE groups SET parent_id = ?, path = ?, depth = ?, revision = revision + 1, updated_at = ? WHERE id = ?`)
        .run(payload.parentId, path, depth, now, group.id);
      rewriteDescendants(raw, group, path, depth, now);
      return effect(group.id, group.revision + 1);
    },
    "groups.archive": ({ raw, clock }, { projectId, payload }) => {
      requireSystemScope(projectId);
      const group = requireGroup(raw, payload.groupId);
      checkRevision(group.revision, payload.expectedRevision);
      raw.prepare("UPDATE groups SET archived = ?, revision = revision + 1, updated_at = ? WHERE id = ?")
        .run(Number(payload.archived), clock().toISOString(), group.id);
      return effect(group.id, group.revision + 1);
    },
    "groups.delete": ({ raw }, { projectId, payload }) => {
      requireSystemScope(projectId);
      const group = requireGroup(raw, payload.groupId);
      checkRevision(group.revision, payload.expectedRevision);
      if (raw.prepare(`SELECT 1 FROM groups WHERE parent_id = ? UNION ALL SELECT 1 FROM projects WHERE group_id = ?
        UNION ALL SELECT 1 FROM skills WHERE group_id = ? UNION ALL SELECT 1 FROM agent_templates WHERE group_id = ? LIMIT 1`)
        .get(group.id, group.id, group.id, group.id)) throw new CommandError("conflict", "group is not empty", "correct-input");
      raw.prepare("DELETE FROM group_settings WHERE group_id = ?").run(group.id);
      raw.prepare("DELETE FROM groups WHERE id = ?").run(group.id);
      return effect(group.id, group.revision + 1);
    },
    "groups.set-settings": ({ raw }, { projectId, payload }) => {
      requireSystemScope(projectId);
      const group = requireGroup(raw, payload.groupId);
      const { settingsRevision } = readGroupSettings(raw, group.id);
      checkRevision(settingsRevision, payload.expectedRevision);
      raw.prepare(`INSERT INTO group_settings (group_id, revision, settings_json) VALUES (?, ?, ?)
        ON CONFLICT(group_id) DO UPDATE SET revision = excluded.revision, settings_json = excluded.settings_json`)
        .run(group.id, settingsRevision + 1, JSON.stringify(groupSettingsSchema.parse(payload.settings)));
      return effect(group.id, group.revision);
    },
    "projects.set-group": ({ raw }, { projectId, payload }) => {
      if (projectId === SYSTEM_SCOPE_ID) throw new CommandError("validation", "project scope is required", "correct-input");
      const project = raw.prepare<[string], { revision: number }>("SELECT revision FROM projects WHERE id = ?").get(projectId);
      if (!project) throw new CommandError("not-found", "project not found", "correct-input");
      checkRevision(project.revision, payload.expectedRevision);
      if (payload.groupId !== null) requireGroup(raw, payload.groupId, { active: true });
      raw.prepare("UPDATE projects SET group_id = ?, revision = revision + 1 WHERE id = ?").run(payload.groupId, projectId);
      return { effects: [{ kind: "project", id: projectId, revision: project.revision + 1 }] };
    },
  };
}
