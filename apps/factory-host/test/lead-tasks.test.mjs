import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { API_VERSION, taskSchema, taskProposeInputSchema } from "@factory/contracts";
import { createCommandPipeline } from "../dist/commands/index.js";
import { EventHub } from "../dist/events/hub.js";
import { loadPack } from "../dist/org/index.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { openStorage } from "../dist/storage/database.js";
import { createProposedTasks, listTasks, tasksCreateHandler } from "../dist/work/service.js";

const clock = () => new Date("2026-11-07T10:00:00.000Z");
const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const task = (overrides = {}) => ({ title: "Verify behavior", goal: "Confirm requirements", acceptance: ["Works"], expectedFiles: 1,
  requiredCapabilities: ["test.unit"], placement: "repo-bound", sideEffect: "artifact", reviewPolicy: "human-final", dependsOn: [], ...overrides });
const plan = (tasks = [task(), task({ dependsOn: [0] })]) => taskProposeInputSchema.parse({ tasks });
function fixture(t) {
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir, backupDir: null });
  t.after(() => storage.close());
  const raw = storage.raw;
  const pipeline = createCommandPipeline({ storage, hub: new EventHub(raw, { clock }), clock,
    handlers: { "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler } });
  const projectId = randomUUID();
  const execute = (type, payload) => {
    const result = pipeline.execute({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result;
  };
  execute("projects.create", { name: "Lead project", workspace: { kind: "directory", root: `/workspace/${randomUUID()}` } });
  const engagementId = raw.prepare("SELECT id FROM engagements WHERE project_id = ?").get(projectId).id;
  const input = { projectId, engagementId, turnId: randomUUID(), plan: plan() };
  return { raw, input, create: (overrides = {}) => raw.transaction(() => createProposedTasks(raw, { ...input, ...overrides }))(),
    existing(code) { execute("tasks.create", { taskId: randomUUID(), code, title: "Existing", goal: "Existing goal", brief: "Brief",
      parentTaskId: null, engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] }); } };
}

test("proposed tasks have valid fields, sequential codes, engagement and index-mapped dependencies", (t) => {
  const f = fixture(t);
  const tasks = f.create();
  assert.deepEqual(tasks.map((entry) => entry.code), ["TSK-001", "TSK-002"]);
  assert.deepEqual(tasks[1].dependsOn, [tasks[0].id]);
  for (const entry of tasks) {
    assert.deepEqual(taskSchema.parse(entry), entry);
    assert.equal(entry.state, "proposed");
    assert.equal(entry.revision, 1);
    assert.equal(entry.engagementId, f.input.engagementId);
    assert.equal(entry.ownerSeatId, null);
    assert.equal(entry.parentTaskId, null);
    assert.equal(entry.disposition, "active");
    assert.deepEqual(entry.origin, { kind: "operator" });
    assert.deepEqual(entry.gate, { requiresGo: true });
    assert.deepEqual(entry.inputs, []);
    assert.deepEqual(entry.acceptance, ["Works"]);
    assert.deepEqual(entry.requiredCapabilities, ["test.unit"]);
    assert.equal(entry.placement, "repo-bound");
    assert.equal(entry.sideEffect, "artifact");
    assert.equal(entry.reviewPolicy, "human-final");
  }
});

test("stable SHA-256 UUIDv8 ids make replay a no-op, returning the existing tasks", (t) => {
  const f = fixture(t);
  const first = f.create();
  const bytes = createHash("sha256").update(`lead-turn:${f.input.turnId}:0`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  assert.equal(first[0].id.replaceAll("-", ""), bytes.toString("hex"));
  assert.match(first[0].id, /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const before = f.raw.prepare("SELECT total_changes() AS n").get().n;
  assert.deepEqual(f.create(), first);
  assert.equal(f.raw.prepare("SELECT total_changes() AS n").get().n, before);
  assert.equal(listTasks(f.raw, f.input.projectId).length, 2);
  const next = f.create({ turnId: randomUUID(), engagementId: null });
  assert.deepEqual(next.map((entry) => entry.code), ["TSK-003", "TSK-004"]);
  assert.equal(next[0].engagementId, null);
});

test("codes continue from the numeric TSK maximum, ignoring other prefixes and widening", (t) => {
  const f = fixture(t);
  for (const code of ["ABC-999999", "TSK-003", "TSK-010", "TSK-002"]) f.existing(code);
  assert.deepEqual(f.create().map((entry) => entry.code), ["TSK-011", "TSK-012"]);
  f.existing("TSK-999");
  assert.deepEqual(f.create({ turnId: randomUUID() }).map((entry) => entry.code), ["TSK-1000", "TSK-1001"]);
});

test("caller transaction rollback removes tasks and dependencies without consuming codes", (t) => {
  const f = fixture(t);
  assert.throws(() => f.raw.transaction(() => {
    createProposedTasks(f.raw, f.input);
    throw new Error("rollback");
  })(), /rollback/);
  assert.equal(listTasks(f.raw, f.input.projectId).length, 0);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM task_dependencies").get().n, 0);
  assert.deepEqual(f.create().map((entry) => entry.code), ["TSK-001", "TSK-002"]);
});

test("ten-task plan maps all earlier dependency indexes and replays without gaps", (t) => {
  const f = fixture(t);
  const value = plan(Array.from({ length: 10 }, (_, index) => task({ title: `Task ${index}`,
    dependsOn: Array.from({ length: index }, (_, dependency) => dependency) })));
  const tasks = f.create({ plan: value });
  assert.equal(tasks.length, 10);
  for (const [index, entry] of tasks.entries()) {
    assert.equal(entry.code, `TSK-${String(index + 1).padStart(3, "0")}`);
    assert.deepEqual(entry.dependsOn, tasks.slice(0, index).map((earlier) => earlier.id).sort());
  }
  assert.deepEqual(f.create({ plan: value }), tasks);
  assert.equal(listTasks(f.raw, f.input.projectId).length, 10);
});
