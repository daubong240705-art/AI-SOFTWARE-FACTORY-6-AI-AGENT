import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ARTIFACT_TRANSITIONS, artifactStatusSchema } from "@factory/contracts";
import { openStorage } from "../dist/storage/database.js";
import { EventHub } from "../dist/events/hub.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { knowledgeHandlers } from "../dist/knowledge/commands.js";
import { ArtifactLifecycleError, transitionArtifactVersion } from "../dist/knowledge/lifecycle.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
function fixture(t) {
  const storage = openStorage(":memory:"); storage.migrate({ migrationsDir, backupDir: null });
  t.after(() => storage.close()); const raw = storage.raw; const projectId = randomUUID();
  const clock = () => new Date("2026-11-08T00:00:00.000Z");
  const hub = new EventHub(raw, { clock });
  raw.prepare("INSERT INTO projects VALUES (?,1,'Lifecycle','artifact','unused','active')").run(projectId);
  hub.ensureStream(projectId);
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: knowledgeHandlers });
  const add = (status = "draft", extra = {}) => {
    const row = { projectId, artifactId: randomUUID(), version: 1, visibility: status === "approved" ? "project" : "team-draft", status, ...extra };
    raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,
      size_bytes,status,abstract_l0,visibility,created_at) VALUES (?,?,?,'other','Document','text/plain',?,1,?,'Abstract',?,?)`)
      .run(row.projectId, row.artifactId, row.version, "a".repeat(64), row.status, row.visibility, clock().toISOString());
    return row;
  };
  const command = (type, payload, extra = {}) => ({ apiVersion: 1, commandId: randomUUID(), projectId, type, payload, ...extra });
  const execute = (type, payload) => pipeline.execute(command(type, payload));
  const transition = (row, to) => execute("artifacts.transition", { artifactId: row.artifactId, version: row.version, to, comment: "Review" });
  const rowOf = (row) => raw.prepare("SELECT * FROM artifact_versions WHERE project_id=? AND artifact_id=? AND version=?")
    .get(row.projectId, row.artifactId, row.version);
  return { raw, projectId, clock, hub, pipeline, add, command, execute, transition, rowOf };
}

for (const from of artifactStatusSchema.options) for (const to of artifactStatusSchema.options) {
  test(`command transition ${from} to ${to}`, (t) => {
    const f = fixture(t); const row = f.add(from); const before = f.rowOf(row);
    const allowed = ARTIFACT_TRANSITIONS[from].includes(to); const response = f.transition(row, to);
    assert.equal(response.status, allowed ? 200 : 409, JSON.stringify(response.body));
    const after = f.rowOf(row);
    if (allowed) {
      assert.equal(after.status, to); assert.equal(after.content_hash, before.content_hash);
      assert.equal(after.abstract_l0, before.abstract_l0);
      assert.deepEqual(response.body.receipt.effects, [{ kind: "artifact-version", id: row.artifactId, revision: 1 }]);
      assert.equal(after.visibility, to === "approved" ? "project" : before.visibility);
    } else {
      assert.deepEqual(after, before); assert.equal(response.body.error.code, "conflict"); assert.equal(response.body.error.nextAction, "refresh");
    }
    assert.deepEqual(f.raw.prepare("PRAGMA foreign_key_check").all(), []);
  });
}
for (const status of artifactStatusSchema.options) for (const visibility of ["team-draft", "project", "shared"]) {
  test(`command sharing ${status} as ${visibility}`, (t) => {
    const f = fixture(t); const row = f.add(status); const before = f.rowOf(row);
    const allowed = !["withdrawn", "rejected", "superseded"].includes(status)
      && (visibility !== "shared" || status === "approved") && (visibility !== "team-draft" || status !== "approved");
    const response = f.execute("artifacts.share", { artifactId: row.artifactId, version: 1, visibility });
    assert.equal(response.status, allowed ? 200 : 409);
    if (allowed) assert.equal(f.rowOf(row).visibility, visibility === "shared" ? "organization" : visibility);
    else { assert.deepEqual(f.rowOf(row), before); assert.equal(response.body.error.code, "conflict"); }
  });
}
test("approval supersedes only other approved versions and promotes draft visibility atomically", (t) => {
  const f = fixture(t); const older = f.add("approved");
  const unchanged = ["draft", "in-review", "reviewed", "rejected", "withdrawn", "superseded"]
    .map((status, i) => f.add(status, { artifactId: older.artifactId, version: i + 2 }));
  const latest = f.add("reviewed", { artifactId: older.artifactId, version: 8 }); const unrelated = f.add("approved");
  assert.equal(f.transition(latest, "approved").status, 200);
  assert.equal(f.rowOf(latest).status, "approved"); assert.equal(f.rowOf(latest).visibility, "project");
  assert.equal(f.rowOf(older).status, "superseded"); assert.equal(f.rowOf(unrelated).status, "approved");
  for (const row of unchanged) assert.equal(f.rowOf(row).status, row.status);
});
for (const newerStatus of artifactStatusSchema.options) test(`approval with a newer ${newerStatus} version`, (t) => {
  const f = fixture(t); const old = f.add("reviewed"); const newer = f.add(newerStatus, { artifactId: old.artifactId, version: 2 });
  const response = f.transition(old, "approved"); assert.equal(response.status, newerStatus === "withdrawn" ? 200 : 409);
  if (newerStatus !== "withdrawn") { assert.equal(response.body.error.message, "not-latest"); assert.equal(f.rowOf(old).status, "reviewed"); }
  assert.equal(f.rowOf(newer).status, newerStatus);
});
test("an outdated transition conflicts after another command already moved the status", (t) => {
  const f = fixture(t); const row = f.add(); assert.equal(f.transition(row, "in-review").status, 200);
  const response = f.transition(row, "in-review"); assert.equal(response.status, 409); assert.equal(response.body.error.nextAction, "refresh");
});
test("lifecycle helpers throw typed errors without changing content", (t) => {
  const f = fixture(t); const row = f.add();
  assert.throws(() => transitionArtifactVersion(f.raw, { ...row, to: "approved", actorId: "operator", now: f.clock().toISOString() }),
    (error) => error instanceof ArtifactLifecycleError && error.code === "transition-not-allowed");
  assert.equal(f.rowOf(row).status, "draft");
});
test("database guards still reject content mutation and invalid approval visibility", (t) => {
  const f = fixture(t); const row = f.add();
  assert.throws(() => f.raw.prepare("UPDATE artifact_versions SET status='approved' WHERE artifact_id=?").run(row.artifactId), /CHECK/);
  assert.throws(() => f.raw.prepare("UPDATE artifact_versions SET content_hash=? WHERE artifact_id=?").run("b".repeat(64), row.artifactId), /immutable/);
});
for (const status of ["superseded", "withdrawn", "rejected", "approved"]) test(`database preserves final guard on ${status}`, (t) => {
  const f = fixture(t); const row = f.add(status);
  assert.throws(() => f.raw.prepare("UPDATE artifact_versions SET status='draft' WHERE artifact_id=?").run(row.artifactId), /final|superseded/);
});
