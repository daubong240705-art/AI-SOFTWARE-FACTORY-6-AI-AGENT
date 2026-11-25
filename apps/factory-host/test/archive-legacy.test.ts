import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { EventHub } from "../src/events/hub.js";
import { startHost } from "../src/host.js";
import { orgActivity } from "../src/org/activity.js";
import { archiveGameProjects } from "../src/projects/archive.js";
import { openStorage } from "../src/storage/database.js";
import { fixedClock, idFactory, migratedStorage, MIGRATIONS_DIR } from "./helpers.js";

function seedProjects(raw: ReturnType<typeof openStorage>["raw"], workspace: string) {
  const newId = idFactory();
  const project = raw.prepare(`INSERT INTO projects (id, revision, name, workspace_kind, workspace_root)
    VALUES (?, 1, ?, 'directory', ?)`);
  const team = raw.prepare(`INSERT INTO teams (id, revision, name, charter, pack_key, pack_version, lifecycle)
    VALUES (?, 1, ?, '', ?, '1.0.0', 'active')`);
  const engagement = raw.prepare(`INSERT INTO engagements (project_id, id, team_id, revision, priority, max_concurrent, state, created_at)
    VALUES (?, ?, ?, 1, 60, 4, 'active', ?)`);
  const create = (key: string) => {
    const projectId = newId(), teamId = newId();
    project.run(projectId, key, workspace);
    team.run(teamId, key, key);
    engagement.run(projectId, newId(), teamId, fixedClock()().toISOString());
    return projectId;
  };
  return { retired: create("web-games"), normal: create("software-team"), newId };
}

test("startup archive only archives retired pack projects and is idempotent", (context) => {
  const storage = migratedStorage();
  context.after(() => storage.close());
  const { raw } = storage;
  const { retired, normal, newId } = seedProjects(raw, process.cwd());
  const clock = fixedClock();
  const hub = new EventHub(raw, { newId, clock });
  const cursor = hub.ensureStream(retired);

  archiveGameProjects(raw, hub, clock);
  const select = raw.prepare("SELECT disposition, revision, workspace_root FROM projects WHERE id=?");
  assert.deepEqual(select.get(retired), { disposition: "archived", revision: 2, workspace_root: process.cwd() });
  assert.deepEqual(select.get(normal), { disposition: "active", revision: 1, workspace_root: process.cwd() });
  assert.deepEqual(orgActivity(raw, clock()).teams.map(({ name }) => name), ["software-team"]);
  const event = hub.readAfter(retired, cursor);
  assert.equal(event.kind, "events");
  assert.deepEqual(event.events.map(({ payload }) => payload), [{ type: "entity.changed", entity: { kind: "project", id: retired, revision: 2 } }]);
  const totalChanges = raw.prepare("SELECT total_changes()").pluck();
  const changes = totalChanges.get();
  archiveGameProjects(raw, hub, clock);
  assert.equal(totalChanges.get(), changes);
});

test("Host starts and stops with a migrated database containing historical releases and actions", async (context) => {
  const stateDir = mkdtempSync(join(process.cwd(), "dist-test", "legacy-host-"));
  try {
    const storage = openStorage(join(stateDir, "host.db"));
    try {
      storage.migrate({ migrationsDir: MIGRATIONS_DIR, backupDir: null });
      const { raw } = storage;
      const { retired, normal, newId } = seedProjects(raw, stateDir);
      raw.prepare("DELETE FROM engagements WHERE project_id=?").run(normal);
      const approvalId = newId(), now = fixedClock()().toISOString();
      raw.prepare(`INSERT INTO approvals (project_id, id, revision, kind, subject, summary, options_json,
        impact_if_waiting, context_digest, approver, requested_at, expires_at, state)
        VALUES (?, ?, 1, 'question', 'Release', 'Historical fixture', '[{},{}]', '', ?, 'operator', ?, '2026-11-20T10:00:00.000Z', 'pending')`)
        .run(retired, approvalId, "0".repeat(64), now);
      raw.prepare(`INSERT INTO game_releases (project_id, id, kind, game_id, state, version, created_at)
        VALUES (?, ?, 'publish', 'fixture', 'done', 1, ?)`).run(retired, newId(), now);
      raw.prepare(`INSERT INTO portal_actions (project_id, id, approval_id, action, game_id, reason, state, created_at)
        VALUES (?, ?, ?, 'publish', 'fixture', '', 'proposed', ?)`).run(retired, newId(), approvalId, now);
    } finally { storage.close(); }

    const options = { stateDir, port: 0, migrationsDir: MIGRATIONS_DIR, onBootstrapToken: () => {},
      packsDir: fileURLToPath(new URL("../../../../packs/", import.meta.url)),
      dispatch: null, modelGateway: null, periodicBackup: null, clock: fixedClock() };
    const host = await startHost(options).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EPERM" || error.syscall !== "listen") throw error;
      context.diagnostic("Loopback bind prohibited; verifying Fastify startup and shutdown without a listener");
      return startHost({ ...options, listen: false });
    });
    try {
      if (host.port !== 0) assert.ok(host.app.server.listening);
      assert.equal((await host.app.inject({ url: "/health", headers: { host: `127.0.0.1:${host.port}` } })).statusCode, 200);
      assert.equal(host.storage.raw.prepare("SELECT count(*) FROM game_releases").pluck().get(), 1);
      assert.equal(host.storage.raw.prepare("SELECT count(*) FROM portal_actions").pluck().get(), 1);
      assert.equal(host.storage.raw.prepare("SELECT disposition FROM projects WHERE name='web-games'").pluck().get(), "archived");
    } finally { await host.close(); }
  } finally { rmSync(stateDir, { recursive: true, force: true }); }
});
