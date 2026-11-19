import { test } from "node:test";
import assert from "node:assert/strict";
import { migratedStorage } from "./helpers.js";

test("all migrations apply to an empty database", () => {
  const storage = migratedStorage();
  try {
    const tables = storage.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    const names = new Set(tables.map((t) => t.name));
    for (const table of ["seats", "agent_revisions", "team_members", "agent_relations", "skills", "skill_versions", "agent_templates"])
      assert.ok(names.has(table), `missing table ${table}`);
  } finally { storage.close(); }
});

test("0029 triggers keep team kind and project scope consistent", () => {
  const storage = migratedStorage();
  const { raw } = storage;
  try {
    raw.prepare("INSERT INTO projects (id, revision, name, workspace_kind, workspace_root) VALUES ('p1', 1, 'P', 'directory', '/tmp/p')").run();
    assert.throws(() => raw.prepare("INSERT INTO teams (id, revision, name, charter, lifecycle, kind) VALUES ('t1', 1, 'R', '', 'active', 'roster')").run(),
      /team kind and project scope disagree/);
    raw.prepare("INSERT INTO teams (id, revision, name, charter, lifecycle, kind, project_id) VALUES ('t1', 1, 'R', '', 'active', 'roster', 'p1')").run();
    assert.throws(() => raw.prepare("INSERT INTO teams (id, revision, name, charter, lifecycle, kind, project_id) VALUES ('t2', 1, 'R2', '', 'active', 'roster', 'p1')").run(),
      /UNIQUE/);
    assert.throws(() => raw.prepare(`INSERT INTO seats (id, team_id, revision, name, role, profile_id, profile_revision, runtime, slots, node_policy, config_revision)
      VALUES ('s1', 't1', 1, 'A', 'r', 's1', 1, 'acp', 1, 'elastic', 1)`).run(), /agent scope/);
  } finally { storage.close(); }
});
