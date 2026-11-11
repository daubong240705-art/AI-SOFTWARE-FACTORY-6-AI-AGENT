import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { API_VERSION, eventSchema } from "@factory/contracts";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createCommandPipeline } from "../dist/commands/index.js";
import { EventHub } from "../dist/events/hub.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { loadPack } from "../dist/org/index.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { openStorage } from "../dist/storage/database.js";
import { tasksCreateHandler } from "../dist/work/service.js";
import {
  DEFAULT_BUDGET_CONFIG, budgetStatus, budgetsSetHandler, checkAndReserve, countedTokens,
  dayKey, effectiveBudget, recordUsage, usedTokens,
} from "../dist/policy/index.js";

const host = "127.0.0.1:8787";
const origin = `http://${host}`;
const clock = () => new Date("2026-11-07T17:00:00.000Z");
const config = { ...DEFAULT_BUDGET_CONFIG, defaultTaskTokens: 100, defaultDayTokens: 200 };
const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const command = (type, projectId, payload) => ({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload });
const budgetCommand = (projectId, overrides = {}) => command("budgets.set", projectId, {
  budgetId: randomUUID(), expectedRevision: null, scope: "day", scopeRef: "2026-11-08",
  limitTokens: 100, warnAtPercent: 80, ...overrides,
});
function success(response) {
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().ok, true);
  return response.json();
}
function failure(response, status, code) {
  assert.equal(response.statusCode, status, response.body);
  assert.equal(response.json().error.code, code);
  return response.json().error;
}
async function fixture(t) {
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw;
  const hub = new EventHub(raw, { clock });
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler, "budgets.set": budgetsSetHandler,
  } });
  const app = createApiServer({ origins: [origin], clock,
    gate: createBootstrapGate({ token: "budget-test-bootstrap-token", clock }), sessions: createSessionStore({ clock }),
    register: createRoutes({ storage, hub, pipeline, budgetConfig: config, clock }),
  });
  t.after(async () => { await app.close(); storage.close(); });
  const bootstrap = await app.inject({ method: "POST", url: "/auth/bootstrap",
    headers: { host, origin, "content-type": "application/json" }, payload: { token: "budget-test-bootstrap-token" } });
  assert.equal(bootstrap.statusCode, 200);
  const cookie = bootstrap.headers["set-cookie"].split(";")[0];
  const headers = { host, origin, cookie, "x-csrf-token": bootstrap.json().csrfToken, "content-type": "application/json" };
  return { raw, pipeline, app,
    post: (payload) => app.inject({ method: "POST", url: "/commands", headers, payload }),
    get: (url, authenticated = true) => app.inject({ method: "GET", url, headers: authenticated ? { host, cookie } : { host } }),
    async project() {
      const projectId = randomUUID();
      success(await this.post(command("projects.create", projectId, {
        name: "Budget project", workspace: { kind: "directory", root: `/workspace/${randomUUID()}` },
      })));
      const lead = raw.prepare(`SELECT s.id FROM seats s JOIN engagements e ON e.team_id = s.team_id
        WHERE e.project_id = ? AND s.is_lead = ?`).get(projectId, 1);
      const conversationId = randomUUID();
      raw.prepare("INSERT INTO conversations (project_id, id, revision, seat_id, task_id, title) VALUES (?, ?, ?, ?, ?, ?)")
        .run(projectId, conversationId, 1, lead.id, null, "Lead chat");
      return { projectId, conversationId };
    },
    async task(projectId, code = "BG-001") {
      const taskId = randomUUID();
      success(await this.post(command("tasks.create", projectId, { taskId, code, title: "Budgeted task", goal: "Deliver",
        brief: "Implement", parentTaskId: null, engagementId: null, ownerSeatId: null,
        requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [],
      })));
      return taskId;
    },
    usage(project, overrides = {}) {
      const input = { ...project, id: randomUUID(), taskId: null, attemptId: null, provider: "fake", model: "test",
        effort: "medium", usage: null, estimatedTokens: 20, recordedAt: clock().toISOString(), ...overrides };
      recordUsage(raw, input);
      return raw.prepare("SELECT * FROM usage_records WHERE project_id = ? AND id = ?").get(input.projectId, input.id);
    },
  };
}

test("dayKey uses the configured calendar offset at day, month and year boundaries", () => {
  assert.equal(dayKey(new Date("2026-11-07T16:59:59Z"), 420), "2026-11-07");
  assert.equal(dayKey(new Date("2026-11-07T17:00:00Z"), 420), "2026-11-08");
  assert.equal(dayKey(new Date("2026-12-31T17:00:00Z"), 420), "2027-01-01");
  assert.equal(dayKey(new Date("2026-11-01T01:00:00Z"), -120), "2026-10-31");
});

test("recordUsage stores unknown costs and preserves unreported usage and its estimate", async (t) => {
  const f = await fixture(t);
  const project = await f.project();
  const row = f.usage(project, { effort: null, estimatedTokens: 57 });
  assert.equal(row.cost_kind, "unknown");
  assert.equal(row.cost_unknown_reason, "no price list");
  assert.equal(row.cost_amount, null);
  assert.equal(row.cost_currency, null);
  for (const key of ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens"])
    assert.equal(row[key], null);
  assert.equal(countedTokens(row), 57);
  const reported = f.usage(project, { usage: { inputTokens: 30, cachedInputTokens: 25, outputTokens: 12, reasoningOutputTokens: 10 },
    estimatedTokens: 90 });
  assert.equal(countedTokens(reported), 42);
  assert.equal(countedTokens(f.usage(project, { usage: {
    inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0,
  }, estimatedTokens: 100 })), 0);
  assert.throws(() => f.usage(project, { estimatedTokens: null }), /needs an estimate/); // an unreported call is never counted as zero
});

test("recordUsage refuses missing owners before accessing the DB and accepts a valid attempt", async (t) => {
  const f = await fixture(t);
  const project = await f.project();
  const taskId = await f.task(project.projectId);
  const attemptId = randomUUID();
  const noDatabase = { prepare() { assert.fail("invalid usage must not access the database"); } };
  assert.throws(() => recordUsage(noDatabase, { attemptId: null, conversationId: null, taskId }), /attempt or a conversation/);
  assert.throws(() => recordUsage(noDatabase, { attemptId, conversationId: project.conversationId, taskId: null }), /must name its task/);
  f.raw.prepare(`INSERT INTO attempts (project_id, id, task_id, revision, epoch, state, outcome, node_id,
    runtime, provider, model, effort, lease_id, lease_expires_at, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(project.projectId, attemptId, taskId, 1, 1, "queued", "known", null, "fake", "fake", "test", "medium", null, null, null, null);
  const row = f.usage(project, { taskId, attemptId, conversationId: null });
  assert.equal(row.attempt_id, attemptId);
  assert.equal(usedTokens(f.raw, project.projectId, "task", taskId, config), 20);
  f.usage(project, { taskId, estimatedTokens: 15 });
  assert.equal(usedTokens(f.raw, project.projectId, "task", taskId, config), 35);
});

test("usedTokens counts conversation usage by local day and task with project isolation", async (t) => {
  const f = await fixture(t);
  const a = await f.project();
  const b = await f.project();
  const taskId = await f.task(a.projectId);
  f.usage(a, { taskId, estimatedTokens: 40, recordedAt: "2026-11-07T16:59:59Z" });
  f.usage(a, { taskId, usage: { inputTokens: 20, cachedInputTokens: 10, outputTokens: 10, reasoningOutputTokens: 5 } });
  f.usage(a, { estimatedTokens: 7 });
  f.usage(b, { estimatedTokens: 900 });
  assert.equal(usedTokens(f.raw, a.projectId, "day", "2026-11-07", config), 40);
  assert.equal(usedTokens(f.raw, a.projectId, "day", "2026-11-08", config), 37);
  assert.equal(usedTokens(f.raw, a.projectId, "task", taskId, config), 70);
  assert.equal(usedTokens(f.raw, b.projectId, "task", taskId, config), 0);
  assert.equal(usedTokens(f.raw, a.projectId, "day", "2026-11-07", { ...config, utcOffsetMinutes: 0 }), 77);
});

test("effectiveBudget selects explicit budgets over task/day defaults only in the matching project and scope", async (t) => {
  const f = await fixture(t);
  const { projectId } = await f.project();
  const taskId = await f.task(projectId);
  assert.deepEqual(effectiveBudget(f.raw, projectId, "task", taskId, config), { limitTokens: 100, warnAtPercent: 80, source: "default" });
  assert.deepEqual(effectiveBudget(f.raw, projectId, "day", "2026-11-08", config), { limitTokens: 200, warnAtPercent: 80, source: "default" });
  success(await f.post(budgetCommand(projectId, { scope: "task", scopeRef: taskId, limitTokens: 50, warnAtPercent: 60 })));
  success(await f.post(budgetCommand(projectId, { limitTokens: 500, warnAtPercent: 90 })));
  assert.deepEqual(effectiveBudget(f.raw, projectId, "task", taskId, config), { limitTokens: 50, warnAtPercent: 60, source: "explicit" });
  assert.deepEqual(effectiveBudget(f.raw, projectId, "day", "2026-11-08", config), { limitTokens: 500, warnAtPercent: 90, source: "explicit" });
  assert.equal(effectiveBudget(f.raw, randomUUID(), "day", "2026-11-08", config).source, "default");
  assert.equal(effectiveBudget(f.raw, projectId, "day", "2026-11-09", config).source, "default");
});

test("checkAndReserve allows fitting calls, warns at 80%, refuses at 100% and writes nothing", async (t) => {
  const f = await fixture(t);
  const project = await f.project();
  const taskId = await f.task(project.projectId);
  const input = { projectId: project.projectId, taskId, now: clock(), estimateTokens: 20, config };
  const before = f.raw.prepare("SELECT total_changes() AS n").get().n;
  assert.deepEqual(checkAndReserve(f.raw, input), { ok: true, warnings: [] });
  assert.equal(f.raw.prepare("SELECT total_changes() AS n").get().n, before);
  f.usage(project, { taskId, estimatedTokens: 80 });
  assert.deepEqual(checkAndReserve(f.raw, input), { ok: true, warnings: [{ scope: "task", verdict: "warn" }] });
  assert.deepEqual(checkAndReserve(f.raw, { ...input, estimateTokens: 21 }), {
    ok: false, scope: "task", verdict: "would-exceed", used: 80, limit: 100,
  });
  f.usage(project, { taskId, estimatedTokens: 20 });
  assert.deepEqual(checkAndReserve(f.raw, { ...input, estimateTokens: 0 }), {
    ok: false, scope: "task", verdict: "exceeded", used: 100, limit: 100,
  });
  assert.deepEqual(checkAndReserve(f.raw, { ...input, taskId: null }), { ok: true, warnings: [] });
  for (const estimateTokens of [-1, 0.5, NaN, Infinity])
    assert.throws(() => checkAndReserve(f.raw, { ...input, estimateTokens }), /nonnegative safe integer/);
});

test("checkAndReserve always checks day first, including calls without a task", async (t) => {
  const f = await fixture(t);
  const project = await f.project();
  const taskId = await f.task(project.projectId);
  success(await f.post(budgetCommand(project.projectId, { limitTokens: 100 })));
  f.usage(project, { taskId, estimatedTokens: 80 });
  const input = { projectId: project.projectId, taskId, now: clock(), estimateTokens: 20, config };
  assert.deepEqual(checkAndReserve(f.raw, input), { ok: true, warnings: [{ scope: "day", verdict: "warn" }, { scope: "task", verdict: "warn" }] });
  for (const task of [taskId, null]) {
    assert.deepEqual(checkAndReserve(f.raw, { ...input, taskId: task, estimateTokens: 21 }), {
      ok: false, scope: "day", verdict: "would-exceed", used: 80, limit: 100,
    });
  }
  f.usage(project, { estimatedTokens: 20 });
  for (const task of [taskId, null]) {
    assert.deepEqual(checkAndReserve(f.raw, { ...input, taskId: task, estimateTokens: 0 }), {
      ok: false, scope: "day", verdict: "exceeded", used: 100, limit: 100,
    });
  }
});

test("budgetStatus includes only tasks with usage or a budget, ordered by code", async (t) => {
  const f = await fixture(t);
  const project = await f.project();
  assert.deepEqual(budgetStatus(f.raw, project.projectId, clock(), config), {
    day: { date: "2026-11-08", used: 0, limit: 200, verdict: "ok", source: "default" }, tasks: [],
    project: { used: 0, limit: null, verdict: "ok", source: "default" }, engagements: [],
  });
  const usedTask = await f.task(project.projectId, "BG-003");
  const budgetedTask = await f.task(project.projectId, "BG-001");
  await f.task(project.projectId, "BG-002");
  const other = await f.project();
  f.usage(other, { taskId: await f.task(other.projectId), estimatedTokens: 1000 });
  f.usage(project, { taskId: usedTask, estimatedTokens: 80 });
  f.usage(project, { estimatedTokens: 80 });
  success(await f.post(budgetCommand(project.projectId, { scope: "task", scopeRef: budgetedTask, limitTokens: 50 })));
  assert.deepEqual(budgetStatus(f.raw, project.projectId, clock(), config), {
    day: { date: "2026-11-08", used: 160, limit: 200, verdict: "warn", source: "default" },
    project: { used: 160, limit: null, verdict: "ok", source: "default" }, engagements: [],
    tasks: [
      { taskId: budgetedTask, code: "BG-001", used: 0, limit: 50, verdict: "ok", source: "explicit" },
      { taskId: usedTask, code: "BG-003", used: 80, limit: 100, verdict: "warn", source: "default" },
    ],
  });
});

test("budgets.set creates and revises optimistically, replays without writes and emits budget/receipt events", async (t) => {
  const f = await fixture(t);
  const { projectId } = await f.project();
  const create = budgetCommand(projectId);
  const first = await f.post(create);
  assert.deepEqual(success(first).receipt.effects, [{ kind: "budget", id: create.payload.budgetId, revision: 1 }]);
  const before = f.raw.prepare("SELECT total_changes() AS n").get().n;
  assert.equal((await f.post(create)).body, first.body);
  assert.equal(f.raw.prepare("SELECT total_changes() AS n").get().n, before);
  assert.equal(failure(await f.post({ ...create, commandId: randomUUID() }), 409, "conflict").currentRevision, 1);
  failure(await f.post(budgetCommand(projectId)), 409, "conflict");
  const update = budgetCommand(projectId, { ...create.payload, expectedRevision: 1, limitTokens: 300, warnAtPercent: 90 });
  const updated = await f.post(update);
  assert.deepEqual(success(updated).receipt.effects, [{ kind: "budget", id: create.payload.budgetId, revision: 2 }]);
  const after = f.raw.prepare("SELECT total_changes() AS n").get().n;
  assert.equal((await f.post(update)).body, updated.body);
  assert.equal(f.raw.prepare("SELECT total_changes() AS n").get().n, after);
  assert.equal(failure(await f.post({ ...update, commandId: randomUUID() }), 409, "conflict").currentRevision, 2);
  const row = f.raw.prepare("SELECT * FROM budgets WHERE project_id = ? AND id = ?").get(projectId, create.payload.budgetId);
  assert.equal(row.revision, 2);
  assert.equal(row.limit_tokens, 300);
  assert.equal(row.warn_at_percent, 90);
  for (const c of [create, update]) {
    const events = f.raw.prepare("SELECT body_json FROM event_log WHERE project_id = ? ORDER BY sequence").all(projectId)
      .map((row) => eventSchema.parse(JSON.parse(row.body_json))).filter((event) => event.causationId === c.commandId);
    assert.deepEqual(events.map((event) => event.payload.type), ["entity.changed", "command.receipted"]);
    assert.equal(events[0].payload.entity.kind, "budget");
    assert.deepEqual(events[0].payload.entity, events[1].payload.receipt.effects[0]);
  }
});

test("budgets.set validates project, task ownership, dates and immutable budget identity", async (t) => {
  const f = await fixture(t);
  const { projectId } = await f.project();
  const other = await f.project();
  const taskId = await f.task(projectId);
  const otherTask = await f.task(other.projectId);
  failure(await f.post(budgetCommand(randomUUID())), 404, "not-found");
  for (const scopeRef of [otherTask, randomUUID(), "not-a-task-id"])
    failure(await f.post(budgetCommand(projectId, { scope: "task", scopeRef })), 404, "not-found");
  for (const scopeRef of ["2026-02-31", "2026-02-29", "2026-04-31", "2026-00-01", "2026-13-01", "2026-11-00", "2026-1-01", "tomorrow"])
    failure(await f.post(budgetCommand(projectId, { scopeRef })), 400, "validation");
  success(await f.post(budgetCommand(projectId, { scopeRef: "2028-02-29" })));
  const create = budgetCommand(projectId, { scope: "task", scopeRef: taskId });
  success(await f.post(create));
  for (const overrides of [
    { scope: "day", scopeRef: "2026-11-09" },
    { scope: "task", scopeRef: await f.task(projectId, "BG-002") },
  ]) failure(await f.post(budgetCommand(projectId, { ...create.payload, ...overrides, expectedRevision: 1 })), 409, "conflict");
  failure(await f.post(budgetCommand(other.projectId, { ...create.payload, scopeRef: otherTask })), 409, "conflict");
  failure(await f.post(budgetCommand(projectId, { expectedRevision: 1, scopeRef: "2026-11-10" })), 409, "conflict");
  for (const overrides of [{ limitTokens: 0 }, { limitTokens: -1 }, { limitTokens: 0.5 }, { warnAtPercent: 0 }, { warnAtPercent: 100 }])
    failure(await f.post(budgetCommand(projectId, overrides)), 400, "validation");
  assert.equal(f.raw.prepare("SELECT revision FROM budgets WHERE project_id = ? AND id = ?").get(projectId, create.payload.budgetId).revision, 1);
});

test("GET budget requires a session, rejects unknown projects, and returns the configured status", async (t) => {
  const f = await fixture(t);
  const project = await f.project();
  failure(await f.get(`/projects/${project.projectId}/budget`, false), 401, "needs-auth");
  failure(await f.get(`/projects/${randomUUID()}/budget`), 404, "not-found");
  failure(await f.get("/projects/invalid/budget"), 400, "validation");
  f.usage(project, { estimatedTokens: 50 });
  const response = await f.get(`/projects/${project.projectId}/budget`);
  assert.deepEqual(success(response), {
    apiVersion: API_VERSION, ok: true, budget: budgetStatus(f.raw, project.projectId, clock(), config),
  });
});
