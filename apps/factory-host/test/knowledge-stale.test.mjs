import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { artifactStatusSchema, taskStateSchema } from "@factory/contracts";
import { openStorage } from "../dist/storage/database.js";
import { markDependantsStale, clearStale, listStale, versionStale, collectLifecycleChanges, transitionArtifactVersion } from "../dist/knowledge/lifecycle.js";
import { getTask, tasksTransitionHandler } from "../dist/work/service.js";
import { createKnowledgeIndex, getKnowledgeArtifact } from "../dist/knowledge/index.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const now = "2026-11-08T00:00:00.000Z";
function fixture(t) {
  const storage = openStorage(":memory:"); storage.migrate({ migrationsDir, backupDir: null });
  t.after(() => storage.close()); const raw = storage.raw; const projectId = randomUUID(); const otherProject = randomUUID();
  for (const id of [projectId, otherProject]) raw.prepare("INSERT INTO projects VALUES (?,1,'Knowledge','artifact','unused','active')").run(id);
  const add = (extra = {}) => {
    const row = { projectId, artifactId: randomUUID(), version: 1, title: "Document", status: "draft", visibility: "project", ...extra };
    raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,
      size_bytes,status,abstract_l0,visibility,created_at) VALUES (?,?,?,'other',?,'text/plain',?,1,?,'Abstract',?,?)`)
      .run(row.projectId, row.artifactId, row.version, row.title, "a".repeat(64), row.status, row.visibility, now);
    return row;
  };
  const source = add({ status: "superseded" }); const replacement = add({ artifactId: source.artifactId, version: 2, status: "approved" });
  const depend = (row, input = source) => raw.prepare("INSERT INTO artifact_inputs VALUES (?,?,?,?,?)")
    .run(row.projectId, row.artifactId, row.version, input.artifactId, input.version);
  let code = 0;
  const task = (state = "active", inputs = [{ artifactId: source.artifactId, version: 1 }], scope = projectId) => {
    const id = randomUUID(); raw.prepare(`INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,origin_kind,state,
      required_capabilities_json,acceptance_json,inputs_json) VALUES (?,?,1,?,'Task','Goal','Brief','operator',?,'[]','[]',?)`)
      .run(scope, id, `KN-${String(++code).padStart(3,"0")}`, state, JSON.stringify(inputs)); return id;
  };
  const input = { projectId, artifactId: source.artifactId, supersededVersion: 1, byVersion: 2, now };
  const mark = (extra = {}) => raw.transaction(() => markDependantsStale(raw, { ...input, ...extra }))();
  const holds = (id) => raw.prepare("SELECT * FROM task_holds WHERE task_id=?").all(id);
  const revision = (id) => raw.prepare("SELECT revision FROM tasks WHERE id=?").get(id).revision;
  const scope = { projectId, teamId: null, viewer: "operator" };
  const knowledge = createKnowledgeIndex({ raw, store: { get() { return Buffer.from("a"); } } });
  return { storage, raw, projectId, otherProject, add, source, replacement, depend, task, input, mark, holds, revision, knowledge, scope };
}
for (const status of artifactStatusSchema.options) test(`stale analysis for a ${status} artifact dependant`, (t) => {
  const f = fixture(t); const row = f.add({ status }); f.depend(row); const effects = f.mark();
  const expected = !["withdrawn", "rejected", "superseded"].includes(status);
  assert.equal(versionStale(f.raw, row).length, expected ? 1 : 0);
  assert.deepEqual(effects, expected ? [{ kind: "artifact-version", id: row.artifactId, revision: 1 }] : []);
});
for (const state of taskStateSchema.options) test(`stale input hold for task state ${state}`, (t) => {
  const f = fixture(t); const id = f.task(state); const effects = f.mark();
  const expected = !["done", "cancelled", "declined", "superseded"].includes(state);
  assert.equal(f.holds(id).length, expected ? 1 : 0); assert.equal(f.revision(id), expected ? 2 : 1);
  assert.deepEqual(effects, expected ? [{ kind: "task", id, revision: 2 }] : []);
  if (expected) {
    const hold = getTask(f.raw, f.projectId, id).holds[0]; assert.equal(hold.kind, "input"); assert.equal(hold.needsAction, true);
    assert.equal(hold.reason, "Input Document v1 was superseded by v2"); assert.equal(hold.ref.kind, "artifact-version");
  }
});
for (const inputs of [[], [{ artifactId: "other", version: 1 }], [{ version: 2 }]]) test(`unrelated pinned inputs case ${JSON.stringify(inputs)}`, (t) => {
  const f = fixture(t); const id = f.task("active", inputs.map((ref) => ({ artifactId: f.source.artifactId, ...ref })));
  f.mark(); assert.equal(f.holds(id).length, 0); assert.equal(f.revision(id), 1);
});
test("stale analysis is idempotent for marks holds revisions and timestamps", (t) => {
  const f = fixture(t); const row = f.add(); f.depend(row); const id = f.task();
  assert.equal(f.mark().length, 2); const marks = listStale(f.raw, f.projectId); const holds = f.holds(id);
  assert.deepEqual(f.mark({ now: "2026-11-09T00:00:00.000Z" }), []);
  assert.deepEqual(listStale(f.raw, f.projectId), marks); assert.deepEqual(f.holds(id), holds); assert.equal(f.revision(id), 2);
});
test("existing input hold is kept verbatim without a revision bump", (t) => {
  const f = fixture(t); const id = f.task();
  f.raw.prepare("INSERT INTO task_holds VALUES (?,?,'input','Existing input',NULL,NULL,?,1)").run(f.projectId, id, now);
  const before = f.holds(id); assert.deepEqual(f.mark(), []); assert.deepEqual(f.holds(id), before); assert.equal(f.revision(id), 1);
});
test("other hold kinds coexist with a new input hold", (t) => {
  const f = fixture(t); const id = f.task();
  f.raw.prepare("INSERT INTO task_holds VALUES (?,?,'decision','Waiting',NULL,NULL,?,1)").run(f.projectId, id, now);
  f.mark(); assert.equal(f.holds(id).length, 2); assert.equal(f.revision(id), 2);
});
test("stale analysis stays in the project and respects exact artifact versions", (t) => {
  const f = fixture(t); const row = f.add(); f.depend(row, f.replacement);
  const foreign = f.add({ projectId: f.otherProject, artifactId: f.source.artifactId });
  const other = f.add({ projectId: f.otherProject }); f.depend(other, foreign);
  const task = f.task("active", [{ artifactId: f.source.artifactId, version: 1 }], f.otherProject);
  assert.deepEqual(f.mark(), []); assert.equal(listStale(f.raw, f.projectId).length, 0); assert.equal(f.holds(task).length, 0);
});
test("stale chains stop at direct dependants for the Lead to assess", (t) => {
  const f = fixture(t); const b = f.add({ status: "approved" }); const c = f.add(); f.depend(b); f.depend(c, b);
  f.mark(); assert.equal(versionStale(f.raw, b).length, 1); assert.equal(versionStale(f.raw, c).length, 0);
});
test("clearing one reason preserves other reasons and task holds", (t) => {
  const f = fixture(t); const row = f.add(); f.depend(row); const id = f.task(); f.mark();
  const second = f.add({ status: "approved" }); f.depend(row, second);
  f.mark({ artifactId: second.artifactId, supersededVersion: 1, byVersion: 1 });
  assert.equal(versionStale(f.raw, row).length, 2);
  assert.deepEqual(clearStale(f.raw, { ...row, becauseArtifactId: f.source.artifactId, becauseVersion: 2 }),
    [{ kind: "artifact-version", id: row.artifactId, revision: 1 }]);
  assert.equal(versionStale(f.raw, row).length, 1); assert.equal(f.holds(id).length, 1);
  clearStale(f.raw, { ...row, becauseArtifactId: second.artifactId, becauseVersion: 1 });
  assert.deepEqual(versionStale(f.raw, row), []); assert.equal(f.holds(id).length, 1); assert.equal(f.revision(id), 2);
  assert.throws(() => clearStale(f.raw, { ...row, becauseArtifactId: second.artifactId, becauseVersion: 1 }), (e) => e.code === "not-found");
});
test("running attempts are unchanged by stale analysis", (t) => {
  const f = fixture(t); const id = f.task();
  f.raw.prepare("INSERT INTO nodes (id,revision,name,platform,trust,state,slots_total,slots_used) VALUES ('local',1,'Local','linux','trusted-workstation','online',1,0)").run();
  f.raw.prepare(`INSERT INTO attempts (project_id,id,task_id,revision,epoch,state,outcome,runtime,provider,model,effort,node_id,lease_id,lease_expires_at)
    VALUES (?,?,?,1,1,'running','known','fake','fake','fake','medium','local','lease',?)`).run(f.projectId, randomUUID(), id, now);
  const before = f.raw.prepare("SELECT * FROM attempts").all(); f.mark();
  assert.deepEqual(f.raw.prepare("SELECT * FROM attempts").all(), before); assert.equal(f.holds(id).length, 1);
});
test("operators can transition tasks carrying a stale input hold", (t) => {
  const f = fixture(t); const id = f.task("draft"); f.mark();
  tasksTransitionHandler({ raw: f.raw }, { projectId: f.projectId, payload: { taskId: id, expectedRevision: 2, to: "proposed" } });
  assert.equal(getTask(f.raw, f.projectId, id).state, "proposed"); assert.equal(f.holds(id).length, 1);
});
test("hold reasons are bounded and sanitize public text", (t) => {
  const f = fixture(t); f.raw.prepare("UPDATE artifact_versions SET title=? WHERE artifact_id=?").run("x".repeat(1200), f.source.artifactId);
  const id = f.task(); f.mark(); assert.equal(f.holds(id)[0].reason.length, 1000);
});
test("approval stale rows and supersession roll back together", (t) => {
  const f = fixture(t); const source = f.add({ status: "approved" }); const newer = f.add({ artifactId: source.artifactId, version: 2, status: "reviewed" });
  const row = f.add(); f.depend(row, source);
  assert.throws(() => f.raw.transaction(() => {
    transitionArtifactVersion(f.raw, { ...newer, to: "approved", actorId: "operator", now }); throw new Error("rollback");
  })(), /rollback/);
  assert.equal(f.raw.prepare("SELECT status FROM artifact_versions WHERE artifact_id=? AND version=1").get(source.artifactId).status, "approved");
  assert.deepEqual(versionStale(f.raw, row), []);
});
test("collectors discard effects from failed nested lifecycle work", (t) => {
  const f = fixture(t); const row = f.add(); f.depend(row);
  const captured = collectLifecycleChanges(f.raw, () => {
    assert.throws(() => collectLifecycleChanges(f.raw, () => f.raw.transaction(() => { f.mark(); throw new Error("rollback"); })()), /rollback/);
  });
  assert.deepEqual(captured.effects, []); assert.deepEqual(versionStale(f.raw, row), []);
});
test("artifact detail exposes empty and populated per-version stale arrays", (t) => {
  const f = fixture(t); const row = f.add(); f.depend(row);
  assert.deepEqual(getKnowledgeArtifact(f.raw, f.scope, row.artifactId).versions[0].stale, []);
  f.mark(); assert.deepEqual(getKnowledgeArtifact(f.raw, f.scope, row.artifactId).versions[0].stale,
    [{ becauseArtifactId: f.source.artifactId, becauseVersion: 2, since: now }]);
});
for (const hidden of [false, true]) test(`stale read flag with ${hidden ? "hidden" : "visible"} because artifact`, (t) => {
  const f = fixture(t); const row = f.add(); f.depend(row); f.mark();
  if (hidden) {
    f.raw.prepare("UPDATE artifact_versions SET status='superseded' WHERE artifact_id=? AND version=2").run(f.source.artifactId);
    f.raw.prepare("UPDATE artifact_versions SET visibility='team-draft' WHERE artifact_id=?").run(f.source.artifactId);
  }
  const scope = { projectId: f.projectId, teamId: null, viewer: "agent" }; f.knowledge.indexVersion(f.projectId, row.artifactId, 1);
  assert.equal(f.knowledge.get(scope, { artifactId: row.artifactId, level: "l0" }).stale, true);
  assert.equal(f.knowledge.search(scope, "Document")[0].stale, true);
  const detail = getKnowledgeArtifact(f.raw, scope, row.artifactId).versions[0];
  assert.equal(detail.isStale, true); assert.equal(detail.stale.length, hidden ? 0 : 1);
  if (hidden) assert.equal(JSON.stringify(detail).includes(f.source.artifactId), false);
});
test("stale listing is ordered oldest first and capped at two hundred", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 202; i++) { const row = f.add(); f.depend(row); f.mark({ now: new Date(Date.parse(now) + i * 1000).toISOString() }); }
  const rows = listStale(f.raw, f.projectId); assert.equal(rows.length, 200);
  assert.deepEqual(rows.map((r) => r.since), [...rows.map((r) => r.since)].sort());
  assert.equal(rows[0].since, now); assert.equal(rows[199].since, new Date(Date.parse(now) + 199000).toISOString());
});
test("migration five has strict stale rows composite foreign keys and an index", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.raw.prepare("SELECT version FROM migration_ledger ORDER BY version").all().map((r) => r.version), [1,2,3,4,5,6,7,8,9,10,11,12]);
  assert.equal(f.raw.prepare("SELECT strict FROM pragma_table_list WHERE name='knowledge_stale'").get().strict, 1);
  assert.equal(f.raw.prepare("PRAGMA foreign_key_list(knowledge_stale)").all().length, 6);
  assert.deepEqual(f.raw.prepare("PRAGMA index_info(knowledge_stale_because)").all().map((r) => r.name), ["project_id","because_artifact_id","because_version"]);
  assert.throws(() => f.raw.prepare("INSERT INTO knowledge_stale VALUES (?,?,1,?,2,?)").run(f.projectId, randomUUID(), f.source.artifactId, now), /FOREIGN KEY/);
});
test("a database at migration four upgrades preserving versions and pinned inputs", (t) => {
  const root = mkdtempSync(join(tmpdir(), "factory-stale-upgrade-"));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + "factory-stale-upgrade-")); rmSync(root, { recursive: true, force: true }); });
  for (const name of ["0001_core.sql", "0002_dispatch.sql", "0003_approval_comments.sql", "0004_knowledge.sql"]) copyFileSync(join(migrationsDir, name), join(root, name));
  const storage = openStorage(":memory:"); t.after(() => storage.close()); storage.migrate({ migrationsDir: root, backupDir: null });
  storage.raw.prepare("INSERT INTO projects VALUES ('project',1,'Retained','artifact','unused','active')").run();
  storage.raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,abstract_l0,visibility,created_at)
    VALUES ('project','document',1,'other','Retained','text/plain',?,1,'approved','Abstract','project',?)`).run("a".repeat(64), now);
  const before = storage.raw.prepare("SELECT * FROM artifact_versions").all();
  assert.deepEqual(storage.migrate({ migrationsDir, backupDir: join(root, "backups") }).applied, [5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(storage.raw.prepare("SELECT * FROM artifact_versions").all(), before); assert.deepEqual(storage.raw.prepare("PRAGMA foreign_key_check").all(), []);
});
