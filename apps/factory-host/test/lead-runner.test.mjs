import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setImmediate as immediate } from "node:timers/promises";
import { test } from "node:test";
import { API_VERSION, eventSchema } from "@factory/contracts";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { appendMessage, chatSendHandler, conversationsCreateHandler, getTurn, listMessages, setTurnState } from "../dist/chat/index.js";
import { EventHub } from "../dist/events/hub.js";
import { startHost } from "../dist/host.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { createIdGenerator } from "../dist/ids.js";
import { createLeadRunner, DEFAULT_LEAD_CONFIG } from "../dist/lead/index.js";
import { createFakeGateway } from "../dist/models/fake.js";
import { findLeadSeat, getActiveEngagement, loadPack } from "../dist/org/index.js";
import { budgetsSetHandler, DEFAULT_BUDGET_CONFIG, recordUsage, usedTokens, dayKey } from "../dist/policy/budget.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { openStorage } from "../dist/storage/database.js";
import { listTasks, tasksCreateHandler } from "../dist/work/service.js";

const clock = () => new Date("2026-11-07T10:00:00.000Z");
const now = clock().toISOString();
const host = "127.0.0.1:8787";
const origin = `http://${host}`;
const bootstrapToken = "runner-test-bootstrap-only";
const profileText = "You are the test team's Lead.";
const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const usage = { inputTokens: 123, cachedInputTokens: 12, outputTokens: 45, reasoningOutputTokens: 4 };
const task = (overrides = {}) => ({ title: "Implement", goal: "Deliver", acceptance: ["Works"], expectedFiles: 1,
  requiredCapabilities: ["code.typescript"], placement: "portable", sideEffect: "none", reviewPolicy: "human-final", dependsOn: [], ...overrides });
const plan = { tasks: [task(), task({ title: "Test", requiredCapabilities: ["test.unit"], dependsOn: [0] })] };
const output = (value = plan) => `Here is my proposal.\n\n\`\`\`factory-plan\n${JSON.stringify(value)}\n\`\`\``;
const command = (type, projectId, payload) => ({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload });
function success(response) { assert.equal(response.statusCode, 200, response.body); return response.json(); }

async function fixture(t, options = {}) {
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir, backupDir: null, now: clock });
  const raw = storage.raw;
  const hub = new EventHub(raw, { clock });
  const gateway = options.gateway === undefined ? createFakeGateway(options.script ?? [{ text: "A helpful reply", usage }]) : options.gateway;
  const runner = createLeadRunner({ storage, hub: options.wrapHub?.(hub) ?? hub, gateway, clock, profileText,
    newId: options.newId ?? createIdGenerator(clock), config: options.config, budgetConfig: options.budgetConfig });
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "conversations.create": conversationsCreateHandler,
    "chat.send": chatSendHandler, "tasks.create": tasksCreateHandler, "budgets.set": budgetsSetHandler,
  } });
  const app = createApiServer({ origins: [origin], clock,
    gate: createBootstrapGate({ token: bootstrapToken, clock }), sessions: createSessionStore({ clock }),
    register: createRoutes({ storage, hub, pipeline,
      ...(options.afterCommand ? { afterCommand: options.afterCommand } : {}),
    }),
  });
  t.after(async () => { await runner.stop(); await app.close(); storage.close(); });
  const auth = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host, origin }, payload: { token: bootstrapToken } });
  assert.equal(auth.statusCode, 200);
  const headers = { host, origin, cookie: auth.headers["set-cookie"].split(";")[0], "x-csrf-token": auth.json().csrfToken };
  const ids = createIdGenerator(clock);
  const f = { storage, raw, hub, gateway, runner, app, pipeline, headers,
    async post(type, payload, projectId = this.projectId) {
      return success(await app.inject({ method: "POST", url: "/commands", headers, payload: command(type, projectId, payload) }));
    },
    async project() {
      const id = randomUUID();
      await this.post("projects.create", { name: "Runner project", workspace: { kind: "directory", root: `/workspace/${id}` } }, id);
      return id;
    },
    async conversation(projectId = this.projectId, workItemId = null) {
      const id = randomUUID();
      const lead = findLeadSeat(raw, getActiveEngagement(raw, projectId).teamId);
      await this.post("conversations.create", { conversationId: id, agentId: lead.id, title: "Lead", workItemId }, projectId);
      return id;
    },
    async send(overrides = {}, projectId = this.projectId, conversationId = this.conversationId) {
      const payload = { conversationId, messageId: ids(), expectedRevision: 1, text: "Please explain.", attachmentIds: [],
        intent: "discuss", context: [], draftRevision: null, ...overrides };
      await this.post("chat.send", payload, projectId);
      return payload.messageId;
    },
    messages() { return listMessages(raw, this.projectId, this.conversationId).messages; },
    turn(id) { return getTurn(raw, this.projectId, id); },
    events(id) { return raw.prepare("SELECT body_json FROM event_log WHERE json_extract(body_json, '$.causationId') = ? ORDER BY sequence")
      .all(id).map((row) => eventSchema.parse(JSON.parse(row.body_json))); },
    usages() { return raw.prepare("SELECT * FROM usage_records ORDER BY rowid").all(); },
    async run() { runner.kick(); await runner.idle(); },
    append(text, speaker = "system") { return appendMessage(raw, { projectId: this.projectId, conversationId: this.conversationId,
      id: ids(), speaker, agentId: null, text, createdAt: now }); },
    async task() {
      const id = randomUUID();
      await this.post("tasks.create", { taskId: id, code: "WK-001", title: "Task", goal: "Deliver", brief: "Brief",
        parentTaskId: null, engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] });
      return id;
    },
  };
  f.projectId = await f.project();
  f.conversationId = await f.conversation();
  f.leadId = findLeadSeat(raw, getActiveEngagement(raw, f.projectId).teamId).id;
  return f;
}

test("discussion commits a Lead reply, reported usage, and valid causal events", async (t) => {
  const f = await fixture(t);
  const id = await f.send();
  await f.run();
  const [user, reply] = f.messages();
  assert.equal(user.id, id);
  assert.equal(reply.speaker, "agent");
  assert.equal(reply.agentId, f.leadId);
  assert.equal(reply.text, "A helpful reply");
  assert.equal(reply.createdAt, now);
  assert.equal(f.turn(id).state, "done");
  assert.equal(f.turn(id).replyMessageId, reply.id);
  assert.equal(f.turn(id).updatedAt, now);
  const [row] = f.usages();
  assert.equal(row.input_tokens, usage.inputTokens);
  assert.equal(row.cached_input_tokens, usage.cachedInputTokens);
  assert.equal(row.output_tokens, usage.outputTokens);
  assert.equal(row.reasoning_output_tokens, usage.reasoningOutputTokens);
  assert.equal(row.cost_kind, "unknown");
  assert.equal(row.cost_amount, null);
  assert.equal(row.conversation_id, f.conversationId);
  assert.equal(row.task_id, null);
  assert.equal(row.attempt_id, null);
  assert.equal(row.provider, "fake");
  assert.equal(row.model, DEFAULT_LEAD_CONFIG.model);
  assert.equal(row.effort, "medium");
  assert.equal(row.recorded_at, now);
  assert.equal(f.events(id).length, 1);
  assert.deepEqual(f.events(id)[0].payload.message, (({ ordinal, ...m }) => m)(reply));
  assert.equal(f.events(id)[0].rootCausationId, id);
});

test("request uses profile, user message, and exact default model options once", async (t) => {
  const f = await fixture(t);
  await f.send({ text: "User's exact text" });
  await f.run();
  assert.equal(f.gateway.calls.length, 1);
  const [request] = f.gateway.calls;
  assert.equal(request.model, "gpt-6.1-sol");
  assert.equal(request.effort, "medium");
  assert.equal(request.maxOutputTokens, 4096);
  assert.equal(request.timeoutMs, 120_000);
  assert.ok(request.system.startsWith(profileText));
  assert.deepEqual(request.messages.at(-1), { role: "user", content: "User's exact text" });
  assert.match(request.system, /Runner project/);
  assert.ok(request.system.indexOf("[lead]") < request.system.indexOf("Existing tasks"));
});

test("configuration overrides and null effort reach the gateway", async (t) => {
  const f = await fixture(t, { config: { model: "test-model", effort: null, maxOutputTokens: 17, timeoutMs: 500 } });
  await f.send(); await f.run();
  assert.equal(f.gateway.calls[0].model, "test-model");
  assert.equal(f.gateway.calls[0].effort, null);
  assert.equal(f.gateway.calls[0].maxOutputTokens, 17);
  assert.equal(f.gateway.calls[0].timeoutMs, 500);
});

test("delegate creates proposed tasks, dependency and events exactly once across repeated kicks and recovery", async (t) => {
  const f = await fixture(t, { script: [{ text: output(), delayMs: 15 }] });
  const id = await f.send({ intent: "delegate" });
  for (let i = 0; i < 5; i++) f.runner.kick();
  await immediate();
  for (let i = 0; i < 5; i++) f.runner.kick();
  await f.runner.idle();
  assert.equal(f.runner.recover(), 0);
  await f.run();
  const tasks = listTasks(f.raw, f.projectId);
  assert.deepEqual(tasks.map((x) => [x.code, x.state]), [["TSK-001", "proposed"], ["TSK-002", "proposed"]]);
  assert.deepEqual(tasks[1].dependsOn, [tasks[0].id]);
  assert.ok(tasks.every((x) => x.engagementId === getActiveEngagement(f.raw, f.projectId).id));
  assert.equal(f.messages()[1].text, "Here is my proposal.");
  assert.equal(f.gateway.calls.length, 1);
  assert.equal(f.usages().length, 1);
  assert.deepEqual(f.events(id).map((x) => x.payload.type), ["message.appended", "entity.changed", "entity.changed"]);
  assert.deepEqual(f.events(id).slice(1).map((x) => x.payload.entity), tasks.map((x) => ({ kind: "task", id: x.id, revision: x.revision })));
});

test("discussion plan is removed and produces a system note without tasks", async (t) => {
  const f = await fixture(t, { script: [{ text: output() }] });
  const id = await f.send(); await f.run();
  assert.equal(f.turn(id).state, "done");
  assert.equal(listTasks(f.raw, f.projectId).length, 0);
  assert.equal(f.messages()[1].text, "Here is my proposal.");
  assert.deepEqual(f.messages().slice(1).map((m) => m.speaker), ["agent", "system"]);
  assert.equal(f.messages()[2].text, "plan ignored: the message was a discussion");
  assert.deepEqual(f.events(id).map((e) => e.payload.message.speaker), ["agent", "system"]);
});

for (const [name, text] of [
  ["bad JSON", "Reply\n```factory-plan\n{broken\n```"],
  ["eleven tasks", output({ tasks: Array.from({ length: 11 }, () => task()), testingReason: "Covered" })],
  ["forward dependency", output({ tasks: [task({ dependsOn: [1] }), plan.tasks[1]] })],
  ["no testing", output({ tasks: [task()] })],
]) test(`invalid plan (${name}) preserves reply and adds one note`, async (t) => {
  const f = await fixture(t, { script: [{ text }] });
  const id = await f.send({ intent: "delegate" }); await f.run();
  assert.equal(f.turn(id).state, "done");
  assert.equal(listTasks(f.raw, f.projectId).length, 0);
  assert.equal(f.messages().length, 3);
  assert.equal(f.messages()[1].speaker, "agent");
  assert.ok(!f.messages()[1].text.includes("factory-plan"));
  assert.equal(f.messages()[2].speaker, "system");
  assert.equal(f.usages().length, 1);
});

test("missing stored intent defaults to discussion", async (t) => {
  const f = await fixture(t, { script: [{ text: output() }] });
  const id = await f.send({ intent: "delegate" });
  f.raw.prepare("UPDATE messages SET body_json = json_remove(body_json, '$.intent') WHERE id = ?").run(id);
  await f.run();
  assert.match(f.gateway.calls[0].system, /Intent: discuss/);
  assert.equal(listTasks(f.raw, f.projectId).length, 0);
});

test("null usage records the reservation and counts it against the day budget", async (t) => {
  const f = await fixture(t, { script: [{ text: "Reply", usage: null }] });
  await f.send(); await f.run();
  const [row] = f.usages();
  assert.equal(row.input_tokens, null);
  assert.equal(row.output_tokens, null);
  assert.ok(row.estimated_tokens > 4096);
  const request = f.gateway.calls[0];
  assert.equal(row.estimated_tokens, Math.ceil((request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0)) / 3) + 4096);
  assert.equal(usedTokens(f.raw, f.projectId, "day", dayKey(clock(), 420), DEFAULT_BUDGET_CONFIG), row.estimated_tokens);
});

test("null gateway fails once with the configuration message and no usage", async (t) => {
  const f = await fixture(t, { gateway: null });
  const id = await f.send(); await f.run(); await f.run();
  assert.equal(f.turn(id).state, "failed");
  assert.equal(f.turn(id).errorKind, "not-configured");
  assert.equal(f.usages().length, 0);
  assert.equal(f.messages().length, 2);
  assert.equal(f.messages()[1].text, "The model gateway is not configured. Set NINE_ROUTER_API_KEY and restart the Host.");
  assert.equal(f.events(id).length, 1);
});

for (const kind of ["auth", "rate-limit", "timeout", "unavailable", "bad-response", "cancelled", "config"])
  test(`ModelError ${kind} is sanitized, settled and never retried`, async (t) => {
    const fake = createFakeGateway([{ error: kind }]);
    const providerText = "synthetic-private-provider-body";
    const gateway = { ...fake, async complete(request) {
      try { return await fake.complete(request); } catch (error) { error.message = providerText; throw error; }
    } };
    const f = await fixture(t, { gateway });
    const id = await f.send(); await f.run(); await f.run();
    assert.equal(f.runner.recover(), 0);
    assert.equal(f.turn(id).state, "failed");
    assert.equal(f.turn(id).errorKind, kind);
    assert.equal(fake.calls.length, 1);
    assert.equal(f.messages().length, 2);
    assert.equal(f.messages()[1].text, `The Lead could not answer (${kind}). Your message was kept; send it again to retry.`);
    assert.equal(f.messages()[1].speaker, "system");
    assert.equal(f.events(id).length, 1);
    assert.ok(!JSON.stringify([f.messages(), f.events(id), f.turn(id)]).includes(providerText));
    const uncertain = ["timeout", "unavailable", "bad-response", "cancelled"].includes(kind);
    assert.equal(f.usages().length, uncertain ? 1 : 0);
    if (uncertain) {
      assert.equal(f.usages()[0].input_tokens, null);
      assert.ok(f.usages()[0].estimated_tokens > 4096);
      assert.equal(f.usages()[0].provider, "fake");
    }
  });

test("unexpected gateway exception fails internal without leaking its message", async (t) => {
  const fake = createFakeGateway([{ text: "ignored" }]);
  const f = await fixture(t, { gateway: { ...fake, async complete(request) { await fake.complete(request); throw new Error("private-stack"); } } });
  const id = await f.send(); await f.run();
  assert.equal(f.turn(id).errorKind, "internal");
  assert.match(f.messages()[1].text, /could not answer \(internal\)/);
  assert.ok(!JSON.stringify(f.messages()).includes("private-stack"));
  assert.equal(f.usages().length, 0);
});

for (const scope of ["day", "task"]) test(`${scope} budget exceeded blocks the gateway and shows used and limit`, async (t) => {
  const budgetConfig = { ...DEFAULT_BUDGET_CONFIG, [scope === "day" ? "defaultDayTokens" : "defaultTaskTokens"]: 100 };
  const f = await fixture(t, { budgetConfig });
  const taskId = scope === "task" ? await f.task() : null;
  if (taskId) f.conversationId = await f.conversation(f.projectId, taskId);
  recordUsage(f.raw, { id: randomUUID(), projectId: f.projectId, taskId, attemptId: null, conversationId: f.conversationId,
    provider: "fake", model: "test", effort: null, usage: null, estimatedTokens: 100, recordedAt: now });
  const id = await f.send(); await f.run();
  assert.equal(f.turn(id).state, "budget-blocked");
  assert.equal(f.turn(id).errorKind, `budget-${scope}-exceeded`);
  assert.equal(f.gateway.calls.length, 0);
  assert.equal(f.usages().length, 1);
  assert.equal(f.messages()[1].text, `Budget limit reached (${scope}): 100 of 100 tokens used.`);
  assert.equal(f.events(id).length, 1);
});

test("would-exceed budget blocks before the first model call", async (t) => {
  const f = await fixture(t, { budgetConfig: { ...DEFAULT_BUDGET_CONFIG, defaultDayTokens: 100 } });
  const id = await f.send(); await f.run();
  assert.equal(f.turn(id).errorKind, "budget-day-would-exceed");
  assert.equal(f.gateway.calls.length, 0);
  assert.equal(f.usages().length, 0);
  assert.equal(f.messages()[1].text, "Budget limit reached (day): 0 of 100 tokens used.");
});

test("explicit budgets.set overrides the default and blocks a queued turn", async (t) => {
  const f = await fixture(t);
  await f.post("budgets.set", { budgetId: randomUUID(), expectedRevision: null, scope: "day", scopeRef: "2026-11-07",
    limitTokens: 50, warnAtPercent: 80 });
  const id = await f.send(); await f.run();
  assert.equal(f.turn(id).state, "budget-blocked");
  assert.equal(f.gateway.calls.length, 0);
  assert.equal(f.messages()[1].text, "Budget limit reached (day): 0 of 50 tokens used.");
});

test("two queued turns run in order and each prompt stops at its user ordinal", async (t) => {
  const f = await fixture(t, { script: [{ text: "First answer", delayMs: 15 }, { text: "Second answer" }] });
  const first = await f.send({ text: "First user" });
  const second = await f.send({ text: "Second user" });
  f.append("Future message", "user");
  await f.run();
  assert.equal(f.gateway.calls.length, 2);
  assert.deepEqual(f.gateway.calls[0].messages, [{ role: "user", content: "First user" }]);
  assert.deepEqual(f.gateway.calls[1].messages, [{ role: "user", content: "First user\n\nSecond user" }]);
  assert.deepEqual(f.messages().slice(-2).map((m) => m.text), ["First answer", "Second answer"]);
  assert.equal(f.turn(first).state, "done");
  assert.equal(f.turn(second).state, "done");
});

test("system messages never enter model history or displace user history", async (t) => {
  const f = await fixture(t, { config: { maxHistoryMessages: 2 } });
  f.append("Earlier user", "user");
  for (let i = 0; i < 10; i++) f.append("Internal system note");
  await f.send({ text: "Latest user" }); await f.run();
  assert.deepEqual(f.gateway.calls[0].messages, [{ role: "user", content: "Earlier user\n\nLatest user" }]);
});

test("append failure rolls back reply, tasks, usage and success events before internal failure", async (t) => {
  let failed = false;
  const f = await fixture(t, { script: [{ text: output() }], wrapHub: (hub) => ({
    transaction: (fn) => hub.transaction(fn),
    append(input) {
      const result = hub.append(input);
      if (!failed && input.payload.type === "entity.changed") { failed = true; throw new Error("private failure"); }
      return result;
    },
  }) });
  const before = f.hub.currentCursor(f.projectId);
  const id = await f.send({ intent: "delegate" }); await f.run();
  assert.ok(failed);
  assert.equal(f.turn(id).state, "failed");
  assert.equal(f.turn(id).errorKind, "internal");
  assert.equal(f.turn(id).replyMessageId, null);
  // The provider answered, so its tokens are spent even though recording the reply failed.
  assert.equal(f.usages().length, 1);
  assert.equal(listTasks(f.raw, f.projectId).length, 0);
  assert.deepEqual(f.messages().map((m) => m.speaker), ["user", "system"]);
  assert.equal(f.events(id).length, 1);
  assert.equal(f.events(id)[0].payload.message.speaker, "system");
  assert.equal(BigInt(f.hub.currentCursor(f.projectId).sequence) - BigInt(before.sequence), 4n);
  await f.run(); assert.equal(f.gateway.calls.length, 1);
});

test("recovery marks running unknown once, emits one message, and leaves queued work alone", async (t) => {
  const f = await fixture(t);
  const running = await f.send(); const queued = await f.send();
  setTurnState(f.raw, f.projectId, running, "running", { now });
  assert.equal(f.runner.recover(), 1);
  assert.equal(f.runner.recover(), 0);
  assert.equal(f.turn(running).state, "unknown");
  assert.equal(f.turn(queued).state, "queued");
  assert.equal(f.gateway.calls.length, 0);
  assert.equal(f.messages()[2].text, "The Lead's answer was interrupted by a restart. Send your message again if you still need it.");
  assert.equal(f.events(running).length, 1);
  assert.equal(f.usages().length, 0);
  await f.run();
  assert.equal(f.turn(queued).state, "done");
  assert.equal(f.turn(running).state, "unknown");
  assert.equal(f.gateway.calls.length, 1);
});

test("queued work survives runner replacement and is processed on kick", async (t) => {
  const f = await fixture(t);
  const id = await f.send();
  await f.runner.stop();
  const next = createLeadRunner({ storage: f.storage, hub: f.hub, gateway: f.gateway, profileText, clock });
  t.after(() => next.stop());
  assert.equal(next.recover(), 0);
  next.kick(); await next.idle();
  assert.equal(f.turn(id).state, "done");
  assert.equal(f.gateway.calls.length, 1);
});

test("stop aborts an in-flight call, settles cancelled usage, and leaves later turns queued", async (t) => {
  const f = await fixture(t, { script: [{ text: "Too late", delayMs: 60_000 }] });
  const first = await f.send(); const second = await f.send();
  f.runner.kick(); await immediate();
  assert.equal(f.gateway.calls.length, 1);
  await f.runner.stop();
  assert.equal(f.turn(first).state, "failed");
  assert.equal(f.turn(first).errorKind, "cancelled");
  assert.equal(f.turn(second).state, "queued");
  assert.equal(f.usages().length, 1);
  assert.ok(f.usages()[0].estimated_tokens > 0);
  assert.equal(f.messages().at(-1).speaker, "system");
  f.runner.kick(); await f.runner.idle(); await immediate();
  assert.equal(f.gateway.calls.length, 1);
});

test("stop before scheduled kick starts nothing and remains idempotent", async (t) => {
  const f = await fixture(t);
  const id = await f.send();
  f.runner.kick(); await f.runner.stop(); await f.runner.stop();
  f.runner.kick(); await immediate(); await f.runner.idle();
  assert.equal(f.gateway.calls.length, 0);
  assert.equal(f.turn(id).state, "queued");
});

test("idle waits for scheduled and active work and resolves immediately when quiescent", async (t) => {
  const f = await fixture(t, { script: [{ text: "Done", delayMs: 20 }] });
  await f.runner.idle();
  const id = await f.send(); f.runner.kick();
  let settled = false;
  const waiting = f.runner.idle().then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  await immediate(); assert.equal(settled, false);
  await waiting;
  assert.equal(f.turn(id).state, "done");
  await f.runner.idle();
});

test("a kick during processing picks up a newly queued turn", async (t) => {
  const f = await fixture(t, { script: [{ text: "First", delayMs: 25 }, { text: "Second" }] });
  await f.send(); f.runner.kick(); await immediate();
  const second = await f.send(); f.runner.kick();
  await f.runner.idle();
  assert.equal(f.turn(second).state, "done");
  assert.equal(f.gateway.calls.length, 2);
});

test("three projects share one model slot and dispatch oldest first", async (t) => {
  const fake = createFakeGateway(Array.from({ length: 3 }, (_, i) => ({ text: `Reply ${i}`, delayMs: 10 })));
  let active = 0; let maximum = 0;
  const order = [];
  const gateway = { ...fake, async complete(request) {
    active++; maximum = Math.max(maximum, active); order.push(`start:${request.messages.at(-1).content}`);
    try { return await fake.complete(request); } finally { active--; order.push(`end:${request.messages.at(-1).content}`); }
  } };
  const f = await fixture(t, { gateway });
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const project = await f.project(); const conversation = await f.conversation(project);
    ids.push([project, await f.send({ text: `User ${i}` }, project, conversation)]);
  }
  await f.run();
  assert.equal(maximum, 1);
  assert.deepEqual(order, ["start:User 0", "end:User 0", "start:User 1", "end:User 1", "start:User 2", "end:User 2"]);
  assert.ok(ids.every(([p, id]) => getTurn(f.raw, p, id).state === "done"));
});

test("afterCommand receives the result, ignores non-string types, and cannot affect the response", async (t) => {
  const calls = [];
  const f = await fixture(t, { afterCommand(type, result) { calls.push([type, result]); throw new Error("observer"); } });
  const id = await f.send();
  assert.equal(calls.at(-1)[0], "chat.send");
  assert.equal(calls.at(-1)[1].status, 200);
  assert.equal(calls.at(-1)[1].body.ok, true);
  assert.equal(f.turn(id).state, "queued");
  const count = calls.length;
  const response = await f.app.inject({ method: "POST", url: "/commands", headers: f.headers, payload: { type: 1 } });
  assert.equal(response.statusCode, 400);
  assert.equal(calls.length, count);
});

test("injected IDs and clock are used for runner messages and usage", async (t) => {
  const generated = [];
  const f = await fixture(t, { newId() { const id = randomUUID(); generated.push(id); return id; } });
  await f.send(); await f.run();
  assert.deepEqual(generated, [f.usages()[0].id, f.messages()[1].id]);
  assert.equal(f.messages()[1].createdAt, now);
  assert.equal(f.usages()[0].recorded_at, now);
});

const hostsByTest = new WeakMap();
function trackHost(t, runtime) {
  const hosts = hostsByTest.get(t) ?? [];
  hosts.push(runtime);
  hostsByTest.set(t, hosts);
  return runtime;
}
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "factory-lead-"));
  t.after(async () => {
    for (const runtime of hostsByTest.get(t) ?? []) await runtime.close();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep + "factory-lead-"));
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
async function hostSession(runtime, token) {
  const host = `127.0.0.1:${runtime.port}`;
  const origin = `http://${host}`;
  const auth = await runtime.app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host, origin }, payload: { token } });
  assert.equal(auth.statusCode, 200);
  const headers = { host, origin, cookie: auth.headers["set-cookie"].split(";")[0], "x-csrf-token": auth.json().csrfToken };
  return { headers, async post(type, projectId, payload) {
    return success(await runtime.app.inject({ method: "POST", url: "/commands", headers, payload: command(type, projectId, payload) }));
  } };
}
async function hostConversation(runtime, session) {
  const projectId = randomUUID(); const conversationId = randomUUID();
  await session.post("projects.create", projectId, { name: "Host project", workspace: { kind: "directory", root: `/workspace/${projectId}` } });
  const lead = findLeadSeat(runtime.storage.raw, getActiveEngagement(runtime.storage.raw, projectId).teamId);
  await session.post("conversations.create", projectId, { conversationId, agentId: lead.id, workItemId: null, title: "Lead" });
  const payload = { conversationId, messageId: randomUUID(), expectedRevision: 1, text: "Host question", attachmentIds: [],
    intent: "discuss", context: [], draftRevision: null };
  return { projectId, conversationId, payload };
}

test("startHost exposes runner, kicks API chat, loads profile and honors config", async (t) => {
  const dir = tempDir(t); const gateway = createFakeGateway([{ text: "Host reply", usage }]);
  let token;
  const runtime = await startHost({ stateDir: dir, port: 0, clock, modelGateway: gateway,
    lead: { model: "chosen-model", effort: "high", maxOutputTokens: 1234 }, onBootstrapToken(value) { token = value; } });
  trackHost(t, runtime);
  t.after(() => runtime.close());
  assert.equal(typeof runtime.lead.idle, "function");
  const session = await hostSession(runtime, token);
  const { projectId, conversationId, payload } = await hostConversation(runtime, session);
  await session.post("chat.send", projectId, payload);
  await runtime.lead.idle();
  const response = await runtime.app.inject({ method: "GET", url: `/projects/${projectId}/conversations/${conversationId}/messages`, headers: session.headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().messages.map((m) => m.message.text), ["Host question", "Host reply"]);
  assert.equal(gateway.calls.length, 1);
  assert.equal(gateway.calls[0].model, "chosen-model");
  assert.equal(gateway.calls[0].effort, "high");
  assert.equal(gateway.calls[0].maxOutputTokens, 1234);
  const profile = readFileSync(join(pack.dir, pack.manifest.seats.find((s) => s.isLead).profile), "utf8");
  assert.ok(gateway.calls[0].system.startsWith(profile));
  const persisted = JSON.stringify([response.json(), runtime.hub.claimUndelivered()]);
  assert.ok(!persisted.includes(token));
  assert.ok(!persisted.includes(session.headers["x-csrf-token"]));
});

test("startHost recovers running work before listening, then processes only the queued turn", async (t) => {
  const dir = tempDir(t);
  let token;
  const initial = await startHost({ stateDir: dir, port: 0, clock, onBootstrapToken(value) { token = value; } });
  trackHost(t, initial);
  t.after(() => initial.close());
  await initial.lead.stop();
  const session = await hostSession(initial, token);
  const { projectId, conversationId, payload } = await hostConversation(initial, session);
  await session.post("chat.send", projectId, payload);
  setTurnState(initial.storage.raw, projectId, payload.messageId, "running", { now });
  const queuedId = randomUUID();
  await session.post("chat.send", projectId, { ...payload, messageId: queuedId });
  await initial.close();
  const gateway = createFakeGateway([{ text: "After restart" }]);
  const restarted = await startHost({ stateDir: dir, port: 0, clock, modelGateway: gateway, onBootstrapToken() {} });
  trackHost(t, restarted);
  t.after(() => restarted.close());
  assert.equal(getTurn(restarted.storage.raw, projectId, payload.messageId).state, "unknown");
  assert.equal(gateway.calls.length, 0);
  await restarted.lead.idle();
  assert.equal(getTurn(restarted.storage.raw, projectId, queuedId).state, "done");
  assert.equal(gateway.calls.length, 1);
  assert.equal(listMessages(restarted.storage.raw, projectId, conversationId).messages.filter((m) => m.speaker === "system").length, 1);
});

test("Host close aborts the runner before storage closes", async (t) => {
  const dir = tempDir(t); const gateway = createFakeGateway([{ text: "Too late", delayMs: 60_000 }]);
  let token;
  const runtime = await startHost({ stateDir: dir, port: 0, clock, modelGateway: gateway, onBootstrapToken(value) { token = value; } });
  trackHost(t, runtime);
  t.after(() => runtime.close());
  const session = await hostSession(runtime, token);
  const { projectId, payload } = await hostConversation(runtime, session);
  await session.post("chat.send", projectId, payload);
  await immediate(); assert.equal(gateway.calls.length, 1);
  await runtime.close();
  assert.equal(runtime.storage.raw.open, false);
  const storage = openStorage(join(dir, "host.db"));
  try {
    assert.equal(getTurn(storage.raw, projectId, payload.messageId).errorKind, "cancelled");
    const text = JSON.stringify(storage.raw.prepare("SELECT body_json FROM messages").all());
    assert.ok(!text.includes(token));
  } finally { storage.close(); }
});

test("main rejects invalid Lead effort with a clear startup error", () => {
  for (const effort of ["", "max", "ultra", "HIGH", " medium", "medium "]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/main.js", import.meta.url))], {
      env: { FACTORY_LEAD_EFFORT: effort }, encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), "FACTORY_LEAD_EFFORT must be one of low, medium, high, xhigh");
  }
});

test("main accepts all supported efforts and a model before subsequent startup validation", () => {
  for (const effort of ["low", "medium", "high", "xhigh"]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/main.js", import.meta.url))], {
      env: { FACTORY_LEAD_EFFORT: effort, FACTORY_LEAD_MODEL: "test-model", FACTORY_PORT: "invalid" }, encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), "FACTORY_PORT must be an integer from 1 to 65535");
  }
});

test("main rejects empty model configuration without echoing its input", () => {
  for (const model of ["", "   "]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/main.js", import.meta.url))], {
      env: { FACTORY_LEAD_MODEL: model }, encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), "FACTORY_LEAD_MODEL must be a non-empty string");
  }
});

test("synthetic api key and bootstrap token never appear in failure messages, events or turn errors", async (t) => {
  const privateKey = "synthetic-api-key-never-a-real-credential";
  const fake = createFakeGateway([{ error: "auth" }]);
  const gateway = { ...fake, async complete(request) {
    try { return await fake.complete(request); } catch (error) { error.message = `${privateKey} ${bootstrapToken}`; throw error; }
  } };
  const f = await fixture(t, { gateway });
  const id = await f.send(); await f.run();
  const persisted = JSON.stringify([f.messages(), f.events(id), f.turn(id)]);
  assert.ok(!persisted.includes(privateKey));
  assert.ok(!persisted.includes(bootstrapToken));
  assert.equal(f.turn(id).errorKind, "auth");
});

test("an answer cut by the output limit fails the turn with a clear message and still records the spend", async (t) => {
  const f = await fixture(t, { script: [{ text: "", usage: { inputTokens: 4566, cachedInputTokens: 0, outputTokens: 4096, reasoningOutputTokens: 4000 }, finishReason: "length" }] });
  const id = await f.send({ intent: "delegate" });
  await f.run();
  const turn = f.turn(id);
  assert.equal(turn.state, "failed");
  assert.equal(turn.errorKind, "output-limit");
  const system = f.messages().map((m) => m.message ?? m).find((m) => m.speaker === "system");
  assert.match(system.text, /ran out of output tokens \(4096\)/);
  assert.match(system.text, /FACTORY_LEAD_MAX_OUTPUT_TOKENS/);
  assert.equal(f.messages().map((m) => m.message ?? m).some((m) => m.speaker === "agent"), false);
  assert.equal(listTasks(f.raw, f.projectId).length, 0);
  const [spent] = f.usages();
  assert.equal(spent.output_tokens, 4096);
  assert.equal(spent.input_tokens, 4566);
});

test("a normal stop still produces the Lead reply", async (t) => {
  const f = await fixture(t, { script: [{ text: "A helpful reply", usage, finishReason: "stop" }] });
  const id = await f.send();
  await f.run();
  assert.equal(f.turn(id).state, "done");
});

for (const policy of ["automatic", "hybrid"]) test(`a ${policy} plan task is stored as human-final until an automatic reviewer exists`, async (t) => {
  const f = await fixture(t, { script: [{ text: output({ tasks: [task({ reviewPolicy: policy }), task({ title: "Test", requiredCapabilities: ["test.unit"], dependsOn: [0], reviewPolicy: policy })] }), usage }] });
  await f.send({ intent: "delegate" });
  await f.run();
  const tasks = listTasks(f.raw, f.projectId);
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks.map((x) => x.reviewPolicy), ["human-final", "human-final"]);
});

test("the Lead protocol only offers the human-final review policy", async (t) => {
  const f = await fixture(t);
  await f.send();
  await f.run();
  const system = f.gateway.calls[0].system;
  assert.match(system, /"reviewPolicy": "human-final"/);
  assert.doesNotMatch(system, /automatic\|hybrid/);
});
