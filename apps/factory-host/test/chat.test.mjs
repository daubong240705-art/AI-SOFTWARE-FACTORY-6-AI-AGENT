import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { API_VERSION, conversationSchema, messageSchema, eventSchema, failureResponseSchema, successResponseSchema } from "@factory/contracts";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { CommandError, createCommandPipeline } from "../dist/commands/index.js";
import {
  appendMessage, chatSendHandler, conversationsCreateHandler, getConversation, getTurn,
  listConversations, listMessages, listPendingTurns, listRecentMessages, setTurnState,
} from "../dist/chat/index.js";
import { EventHub } from "../dist/events/hub.js";
import { startHost } from "../dist/host.js";
import { createFakeGateway } from "../dist/models/fake.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { ensureEngagement, ensureTeamFromPack, findLeadSeat, loadPack } from "../dist/org/index.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { openStorage } from "../dist/storage/database.js";
import { tasksCreateHandler } from "../dist/work/service.js";

const host = "127.0.0.1:8787";
const origin = `http://${host}`;
const clock = () => new Date("2026-11-07T10:00:00.000Z");
const now = clock().toISOString();
const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const command = (type, projectId, payload) => ({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload });
const conversationCommand = (projectId, agentId, overrides = {}) => command("conversations.create", projectId, {
  conversationId: randomUUID(), agentId, title: "Discuss delivery", workItemId: null, ...overrides,
});
const sendCommand = (projectId, conversationId, overrides = {}) => command("chat.send", projectId, {
  conversationId, expectedRevision: 1, messageId: randomUUID(), text: "Please help with this project.",
  attachmentIds: [], intent: "discuss", context: [], draftRevision: null, ...overrides,
});
const events = (raw, commandId) => raw.prepare("SELECT body_json FROM event_log WHERE json_extract(body_json, '$.causationId') = ? ORDER BY sequence")
  .all(commandId).map((row) => eventSchema.parse(JSON.parse(row.body_json)));
const counts = (raw) => ({
  messages: raw.prepare("SELECT count(*) AS n FROM messages").get().n,
  turns: raw.prepare("SELECT count(*) AS n FROM lead_turns").get().n,
  receipts: raw.prepare("SELECT count(*) AS n FROM command_receipts").get().n,
  events: raw.prepare("SELECT count(*) AS n FROM event_log").get().n,
  outbox: raw.prepare("SELECT count(*) AS n FROM outbox").get().n,
});
function success(response) {
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual(successResponseSchema.parse(body), body);
  return body;
}
function failure(response, status, code) {
  assert.equal(response.statusCode, status, response.body);
  const body = response.json();
  assert.deepEqual(failureResponseSchema.parse(body), body);
  assert.equal(body.error.code, code);
  return body.error;
}
async function fixture(t, { handlers = {} } = {}) {
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw;
  const hub = new EventHub(raw, { clock });
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler,
    "conversations.create": conversationsCreateHandler, "chat.send": chatSendHandler, ...handlers,
  } });
  const app = createApiServer({ origins: [origin], clock,
    gate: createBootstrapGate({ token: "chat-test-fixed-bootstrap-token", clock }), sessions: createSessionStore({ clock }),
    register: createRoutes({ storage, hub, pipeline }),
  });
  t.after(async () => { await app.close(); storage.close(); });
  const response = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host, origin, "content-type": "application/json" },
    payload: { token: "chat-test-fixed-bootstrap-token" } });
  assert.equal(response.statusCode, 200);
  const cookie = response.headers["set-cookie"].split(";")[0];
  const headers = { host, origin, cookie, "x-csrf-token": response.json().csrfToken, "content-type": "application/json" };
  const f = { app, raw, hub, storage, pipeline,
    post: (payload) => app.inject({ method: "POST", url: "/commands", headers, payload }),
    get: (url, authenticated = true) => app.inject({ method: "GET", url, headers: authenticated ? { host, cookie } : { host } }),
    async project() {
      const c = command("projects.create", randomUUID(), {
        name: "Chat project", workspace: { kind: "directory", root: `/workspace/${randomUUID()}` },
      });
      success(await this.post(c));
      return c.projectId;
    },
    async conversation(projectId, overrides) {
      const team = (await this.get(`/projects/${projectId}/team`)).json();
      const c = conversationCommand(projectId, team.seats.find((seat) => seat.isLead).id, overrides);
      success(await this.post(c));
      return c.payload.conversationId;
    },
    async send(overrides) {
      const c = sendCommand(this.projectId, this.conversationId, overrides);
      success(await this.post(c));
      return c.payload.messageId;
    },
    append(overrides = {}) {
      return appendMessage(raw, { projectId: this.projectId, conversationId: this.conversationId,
        id: randomUUID(), speaker: "system", agentId: null, text: "Stored message", createdAt: now, ...overrides });
    },
    url(query = "") { return `/projects/${this.projectId}/conversations/${this.conversationId}/messages${query}`; },
  };
  f.projectId = await f.project();
  f.leadId = (await f.get(`/projects/${f.projectId}/team`)).json().seats.find((seat) => seat.isLead).id;
  f.conversationId = await f.conversation(f.projectId);
  return f;
}

test("conversations.create stores the Lead seat mapping and emits entity then receipt", async (t) => {
  const f = await fixture(t);
  const c = conversationCommand(f.projectId, f.leadId, { title: "Operator's title" });
  assert.deepEqual(success(await f.post(c)).receipt.effects, [{ kind: "conversation", id: c.payload.conversationId, revision: 1 }]);
  assert.deepEqual(getConversation(f.raw, f.projectId, c.payload.conversationId), {
    id: c.payload.conversationId, projectId: f.projectId, revision: 1, agentId: f.leadId, workItemId: null, title: c.payload.title,
  });
  assert.deepEqual(f.raw.prepare("SELECT * FROM conversations WHERE project_id = ? AND id = ?").get(f.projectId, c.payload.conversationId), {
    project_id: f.projectId, id: c.payload.conversationId, revision: 1, seat_id: f.leadId, task_id: null, title: c.payload.title,
  });
  assert.deepEqual(events(f.raw, c.commandId).map((event) => event.payload.type), ["entity.changed", "command.receipted"]);
});

test("conversations.create rejects an unknown project", async (t) => {
  const f = await fixture(t);
  failure(await f.post(conversationCommand(randomUUID(), f.leadId)), 404, "not-found");
});

test("conversations.create rejects a non-Lead or unknown seat", async (t) => {
  const f = await fixture(t);
  const nonLead = (await f.get(`/projects/${f.projectId}/team`)).json().seats.find((seat) => !seat.isLead).id;
  for (const id of [nonLead, randomUUID()]) {
    const c = conversationCommand(f.projectId, id);
    const error = failure(await f.post(c), 400, "validation");
    assert.equal(error.message, "only the Lead seat can chat in M1");
    assert.equal(error.nextAction, "correct-input");
    assert.equal(getConversation(f.raw, f.projectId, c.payload.conversationId), undefined);
  }
});

test("conversations.create rejects another project's separate team's Lead", async (t) => {
  const f = await fixture(t);
  const otherProject = await f.project();
  const team = ensureTeamFromPack(f.raw, { ...pack, manifest: { ...pack.manifest, key: "chat-other-team" } }, { newId: randomUUID, clock });
  f.raw.prepare("UPDATE engagements SET state = ? WHERE project_id = ?").run("ended", otherProject);
  ensureEngagement(f.raw, { projectId: otherProject, teamId: team.teamId }, { newId: randomUUID, clock });
  const leadId = findLeadSeat(f.raw, team.teamId).id;
  failure(await f.post(conversationCommand(f.projectId, leadId)), 400, "validation");
  success(await f.post(conversationCommand(otherProject, leadId)));
});

test("conversations.create requires an active engagement", async (t) => {
  const f = await fixture(t);
  f.raw.prepare("UPDATE engagements SET state = ? WHERE project_id = ?").run("ended", f.projectId);
  failure(await f.post(conversationCommand(f.projectId, f.leadId)), 400, "validation");
});

test("conversations.create maps workItemId to a task of the same project", async (t) => {
  const f = await fixture(t);
  const taskId = randomUUID();
  success(await f.post(command("tasks.create", f.projectId, {
    taskId, code: "CH-001", title: "Chat task", goal: "Discuss", brief: "Brief", parentTaskId: null, engagementId: null,
    ownerSeatId: null, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [],
  })));
  const id = await f.conversation(f.projectId, { workItemId: taskId });
  assert.equal(getConversation(f.raw, f.projectId, id).workItemId, taskId);
  failure(await f.post(conversationCommand(f.projectId, f.leadId, { workItemId: randomUUID() })), 404, "not-found");
  const other = await f.project();
  failure(await f.post(conversationCommand(other, f.leadId, { workItemId: taskId })), 404, "not-found");
});

test("duplicate conversationId conflicts even when requested in another project", async (t) => {
  const f = await fixture(t);
  for (const projectId of [f.projectId, await f.project()])
    failure(await f.post(conversationCommand(projectId, f.leadId, { conversationId: f.conversationId })), 409, "conflict");
});

test("conversations.create replays without database writes or events", async (t) => {
  const f = await fixture(t);
  const c = conversationCommand(f.projectId, f.leadId);
  const first = await f.post(c);
  success(first);
  const before = f.raw.prepare("SELECT total_changes() AS n").get().n;
  assert.equal((await f.post(c)).body, first.body);
  assert.equal(f.raw.prepare("SELECT total_changes() AS n").get().n, before);
});

test("chat.send stores a schema-valid message, NULL command_id, queued turn and ordered events", async (t) => {
  const f = await fixture(t);
  const context = [{ id: randomUUID(), revision: 2 }];
  const c = sendCommand(f.projectId, f.conversationId, { text: "  Text as given ' ; --  ", intent: "delegate", context });
  assert.deepEqual(success(await f.post(c)).receipt.effects, [{ kind: "message", id: c.payload.messageId, revision: 1 }]);
  const row = f.raw.prepare("SELECT * FROM messages WHERE project_id = ? AND id = ?").get(f.projectId, c.payload.messageId);
  assert.equal(row.ordinal, 1);
  assert.equal(row.command_id, null);
  const stored = JSON.parse(row.body_json);
  assert.deepEqual(stored.message, messageSchema.parse({ id: c.payload.messageId, projectId: f.projectId, conversationId: f.conversationId,
    revision: 1, createdAt: now, speaker: "user", agentId: null, text: c.payload.text, attachmentIds: [], runId: null }));
  assert.deepEqual(stored, { message: stored.message, intent: "delegate", context });
  assert.deepEqual(getTurn(f.raw, f.projectId, c.payload.messageId), { projectId: f.projectId, id: c.payload.messageId,
    conversationId: f.conversationId, state: "queued", replyMessageId: null, errorKind: null, createdAt: now, updatedAt: now });
  const all = events(f.raw, c.commandId);
  assert.deepEqual(all.map((event) => event.payload.type), ["entity.changed", "message.appended", "command.receipted"]);
  assert.deepEqual(all[1].payload.message, stored.message);
  assert.deepEqual(all[0].payload.entity, { kind: "message", id: c.payload.messageId, revision: 1 });
  assert.ok(all.every((event) => event.causationId === c.commandId && event.rootCausationId === c.commandId));
  assert.equal(getConversation(f.raw, f.projectId, f.conversationId).revision, 1);
});

test("consecutive chat sends assign continuous ordinals 1, 2, 3", async (t) => {
  const f = await fixture(t);
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(await f.send({ text: `Message ${i}` }));
  const page = listMessages(f.raw, f.projectId, f.conversationId);
  assert.deepEqual(page.messages.map((message) => message.ordinal), [1, 2, 3]);
  assert.deepEqual(page.messages.map((message) => message.id), ids);
  assert.equal(listPendingTurns(f.raw).length, 3);
});

test("stale conversation revisions conflict with currentRevision", async (t) => {
  const f = await fixture(t);
  f.raw.prepare("UPDATE conversations SET revision = ? WHERE project_id = ? AND id = ?").run(2, f.projectId, f.conversationId);
  const error = failure(await f.post(sendCommand(f.projectId, f.conversationId)), 409, "conflict");
  assert.equal(error.currentRevision, 2);
  assert.equal(error.nextAction, "refresh");
  assert.equal(counts(f.raw).messages, 0);
});

test("duplicate messageId with a different commandId conflicts across conversations in a project", async (t) => {
  const f = await fixture(t);
  const messageId = await f.send();
  for (const id of [f.conversationId, await f.conversation(f.projectId)])
    failure(await f.post(sendCommand(f.projectId, id, { messageId })), 409, "conflict");
  assert.equal(counts(f.raw).messages, 1);
  assert.equal(counts(f.raw).turns, 1);
});

test("attachments return unsupported without a message, turn or extra event", async (t) => {
  const f = await fixture(t);
  const c = sendCommand(f.projectId, f.conversationId, { attachmentIds: [randomUUID()] });
  const error = failure(await f.post(c), 501, "unsupported");
  assert.equal(error.message, "attachments are not available yet");
  assert.equal(error.nextAction, "correct-input");
  assert.equal(counts(f.raw).messages, 0);
  assert.equal(counts(f.raw).turns, 0);
  assert.deepEqual(events(f.raw, c.commandId).map((event) => event.payload.type), ["command.receipted"]);
});

test("unknown and cross-project conversations are not reachable by chat.send", async (t) => {
  const f = await fixture(t);
  failure(await f.post(sendCommand(f.projectId, randomUUID())), 404, "not-found");
  failure(await f.post(sendCommand(await f.project(), f.conversationId)), 404, "not-found");
  failure(await f.post(sendCommand(randomUUID(), f.conversationId)), 404, "not-found");
  assert.equal(counts(f.raw).messages, 0);
  assert.equal(counts(f.raw).turns, 0);
});

test("chat.send replay writes no second message, turn, receipt or event", async (t) => {
  const f = await fixture(t);
  const c = sendCommand(f.projectId, f.conversationId);
  const first = await f.post(c);
  success(first);
  const before = f.raw.prepare("SELECT total_changes() AS n").get().n;
  const responses = await Promise.all(Array.from({ length: 10 }, () => f.post(c)));
  for (const response of responses) assert.equal(response.body, first.body);
  assert.equal(f.raw.prepare("SELECT total_changes() AS n").get().n, before);
  assert.equal(counts(f.raw).messages, 1);
  assert.equal(counts(f.raw).turns, 1);
});

for (const [label, text] of [["empty", ""], ["oversized", "x".repeat(32_001)]]) {
  test(`chat.send ${label} text is rejected by the contracts schema before writes`, async (t) => {
    const f = await fixture(t);
    const before = counts(f.raw);
    const error = failure(await f.post(sendCommand(f.projectId, f.conversationId, { text })), 400, "validation");
    assert.ok(error.fields.some((field) => field.path === "payload.text"));
    assert.deepEqual(counts(f.raw), before);
  });
}

test("chat.send accepts text at the contract maximum length", async (t) => {
  const f = await fixture(t);
  await f.send({ text: "x".repeat(32_000) });
  assert.equal(listMessages(f.raw, f.projectId, f.conversationId).messages[0].text.length, 32_000);
});

for (const failAt of [2, 3]) test(`failure appending event ${failAt} rolls back message, turn, receipt and all events`, async (t) => {
  const f = await fixture(t);
  const before = counts(f.raw);
  const cursor = f.hub.currentCursor(f.projectId);
  const notifications = [];
  f.hub.subscribe(f.projectId, (value) => notifications.push(value));
  const append = f.hub.append.bind(f.hub);
  let calls = 0;
  f.hub.append = (input) => { if (++calls === failAt) throw new Error("injected event failure"); return append(input); };
  const c = sendCommand(f.projectId, f.conversationId);
  failure(await f.post(c), 500, "internal");
  assert.deepEqual(counts(f.raw), before);
  assert.deepEqual(f.hub.currentCursor(f.projectId), cursor);
  assert.deepEqual(notifications, []);
  f.hub.append = append;
  success(await f.post(c));
  assert.equal(listMessages(f.raw, f.projectId, f.conversationId).messages[0].ordinal, 1);
});

test("appendMessage stores user, agent and system identities and assigns ordinals", async (t) => {
  const f = await fixture(t);
  for (const [index, speaker] of ["user", "agent", "system"].entries()) {
    const agentId = speaker === "agent" ? f.leadId : null;
    const appended = f.append({ speaker, agentId });
    assert.deepEqual(messageSchema.parse(appended.message), appended.message);
    assert.equal(appended.message.agentId, agentId);
    assert.equal(appended.ordinal, index + 1);
  }
  assert.deepEqual(listMessages(f.raw, f.projectId, f.conversationId).messages.map((message) => message.ordinal), [1, 2, 3]);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM messages WHERE command_id IS NOT NULL").get().n, 0);
  assert.equal(listPendingTurns(f.raw).length, 0);
});

test("appendMessage rejects invalid speaker identities before insertion without ordinal gaps", async (t) => {
  const f = await fixture(t);
  for (const input of [{ speaker: "agent", agentId: null }, { speaker: "user", agentId: f.leadId }, { speaker: "system", agentId: f.leadId }])
    assert.throws(() => f.append(input), /Only agent messages/);
  assert.equal(counts(f.raw).messages, 0);
  assert.equal(f.append().ordinal, 1);
  assert.throws(() => f.append({ text: "" }));
  assert.equal(f.append().ordinal, 2);
});

test("message ordinals are local to a conversation and messages are project-scoped", async (t) => {
  const f = await fixture(t);
  const first = f.append();
  const conversationId = await f.conversation(f.projectId);
  assert.equal(f.append({ conversationId }).ordinal, 1);
  assert.equal(f.append().ordinal, 2);
  const otherProject = await f.project();
  const otherConversation = await f.conversation(otherProject);
  assert.equal(f.append({ projectId: otherProject, conversationId: otherConversation, id: first.message.id }).ordinal, 1);
  assert.deepEqual(listMessages(f.raw, otherProject, f.conversationId).messages, []);
  assert.equal(getConversation(f.raw, otherProject, f.conversationId), undefined);
});

test("listMessages defaults and limit clamping preserve ordinal pagination", async (t) => {
  const f = await fixture(t);
  f.raw.transaction(() => { for (let i = 0; i < 205; i++) f.append(); })();
  assert.equal(listMessages(f.raw, f.projectId, f.conversationId).messages.length, 100);
  assert.equal(listMessages(f.raw, f.projectId, f.conversationId, { limit: 999 }).messages.length, 200);
  assert.equal(listMessages(f.raw, f.projectId, f.conversationId, { limit: 0 }).messages.length, 1);
  assert.equal(listMessages(f.raw, f.projectId, f.conversationId, { limit: -3 }).messages.length, 1);
  assert.deepEqual(listMessages(f.raw, f.projectId, f.conversationId, { afterOrdinal: 202, limit: 2 }).messages.map((message) => message.ordinal), [203, 204]);
  assert.equal(listRecentMessages(f.raw, f.projectId, f.conversationId, 205).length, 205);
  assert.equal(listRecentMessages(f.raw, f.projectId, f.conversationId, 205)[0].ordinal, 1);
});

test("listRecentMessages returns the last N messages in ascending order", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) f.append({ text: `Message ${i}` });
  const recent = listRecentMessages(f.raw, f.projectId, f.conversationId, 3);
  assert.deepEqual(recent.map((message) => message.ordinal), [3, 4, 5]);
  assert.deepEqual(recent.map((message) => message.text), ["Message 2", "Message 3", "Message 4"]);
  assert.equal(listRecentMessages(f.raw, f.projectId, f.conversationId, 20).length, 5);
  assert.deepEqual(listRecentMessages(f.raw, f.projectId, f.conversationId, 0), []);
});

test("setTurnState supports every allowed transition with timestamps", async (t) => {
  const f = await fixture(t);
  const later = "2026-11-07T10:01:00.000Z";
  for (const state of ["done", "failed", "unknown", "budget-blocked"]) {
    const id = await f.send();
    setTurnState(f.raw, f.projectId, id, "running", { now: later });
    assert.equal(getTurn(f.raw, f.projectId, id).state, "running");
    const reply = state === "done" ? f.append({ speaker: "agent", agentId: f.leadId }).message.id : undefined;
    const options = { now: later, ...(reply ? { replyMessageId: reply } : {}),
      ...(["failed", "budget-blocked"].includes(state) ? { errorKind: "test-error" } : {}) };
    setTurnState(f.raw, f.projectId, id, state, options);
    const turn = getTurn(f.raw, f.projectId, id);
    assert.equal(turn.state, state);
    assert.equal(turn.replyMessageId, reply ?? null);
    assert.equal(turn.errorKind, options.errorKind ?? null);
    assert.equal(turn.updatedAt, later);
    assert.equal(turn.createdAt, now);
  }
  for (const state of ["budget-blocked", "failed"]) {
    const id = await f.send();
    setTurnState(f.raw, f.projectId, id, state, { errorKind: "before-start", now: later });
    assert.equal(getTurn(f.raw, f.projectId, id).state, state);
  }
  assert.deepEqual(listPendingTurns(f.raw), []);
});

test("setTurnState rejects queued shortcuts, repeated states, terminal exits and unknown turns", async (t) => {
  const f = await fixture(t);
  const id = await f.send();
  for (const state of ["queued", "done", "unknown"])
    assert.throws(() => setTurnState(f.raw, f.projectId, id, state, { now }), /transition not allowed/);
  assert.throws(() => setTurnState(f.raw, randomUUID(), id, "running", { now }), /transition not allowed/);
  assert.throws(() => setTurnState(f.raw, f.projectId, randomUUID(), "running", { now }), /transition not allowed/);
  setTurnState(f.raw, f.projectId, id, "running", { now });
  for (const state of ["queued", "running"])
    assert.throws(() => setTurnState(f.raw, f.projectId, id, state, { now }), /transition not allowed/);
  setTurnState(f.raw, f.projectId, id, "unknown", { now });
  for (const state of ["queued", "running", "done", "failed", "unknown", "budget-blocked"])
    assert.throws(() => setTurnState(f.raw, f.projectId, id, state, { now }), /transition not allowed/);
});

test("setTurnState enforces reply and error CHECKs and preserves the previous state on failure", async (t) => {
  const f = await fixture(t);
  const id = await f.send();
  for (const options of [{ replyMessageId: randomUUID() }, { errorKind: "invalid" }])
    assert.throws(() => setTurnState(f.raw, f.projectId, id, "running", { ...options, now }), /CHECK constraint/);
  for (const state of ["failed", "budget-blocked"])
    assert.throws(() => setTurnState(f.raw, f.projectId, id, state, { now }), /CHECK constraint/);
  assert.equal(getTurn(f.raw, f.projectId, id).state, "queued");
  setTurnState(f.raw, f.projectId, id, "running", { now });
  for (const [state, options] of [["done", {}], ["failed", {}], ["budget-blocked", {}], ["unknown", { errorKind: "invalid" }],
    ["done", { replyMessageId: randomUUID(), errorKind: "invalid" }], ["failed", { replyMessageId: randomUUID(), errorKind: "error" }]])
    assert.throws(() => setTurnState(f.raw, f.projectId, id, state, { ...options, now }), /CHECK constraint/);
  assert.equal(getTurn(f.raw, f.projectId, id).state, "running");
});

test("listPendingTurns selects queued and running across projects ordered by creation and id", async (t) => {
  const f = await fixture(t);
  const ids = [await f.send(), await f.send(), await f.send()];
  setTurnState(f.raw, f.projectId, ids[1], "running", { now });
  setTurnState(f.raw, f.projectId, ids[2], "failed", { errorKind: "test", now });
  const otherProject = await f.project();
  const otherConversation = await f.conversation(otherProject);
  const c = sendCommand(otherProject, otherConversation);
  success(await f.post(c));
  const earlier = "2026-11-07T09:00:00.000Z";
  f.raw.prepare("UPDATE lead_turns SET created_at = ? WHERE project_id = ? AND id = ?").run(earlier, otherProject, c.payload.messageId);
  const pending = listPendingTurns(f.raw);
  assert.deepEqual(pending.map((turn) => turn.id), [c.payload.messageId, ...ids.slice(0, 2).sort()]);
  assert.deepEqual(new Set(pending.map((turn) => turn.state)), new Set(["queued", "running"]));
  assert.equal(getTurn(f.raw, otherProject, ids[0]), undefined);
});

test("GET conversations and messages require a bootstrapped session", async (t) => {
  const f = await fixture(t);
  for (const url of [`/projects/${f.projectId}/conversations`, f.url()])
    failure(await f.get(url, false), 401, "needs-auth");
});

test("GET conversations returns project-scoped, ordered, schema-valid objects", async (t) => {
  const f = await fixture(t);
  await f.conversation(f.projectId);
  const other = await f.project();
  await f.conversation(other);
  const response = await f.get(`/projects/${f.projectId}/conversations`);
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.apiVersion, API_VERSION);
  assert.equal(body.ok, true);
  assert.equal(body.conversations.length, 2);
  assert.deepEqual(body.conversations, listConversations(f.raw, f.projectId));
  for (const conversation of body.conversations) assert.deepEqual(conversationSchema.parse(conversation), conversation);
  const ids = body.conversations.map((conversation) => conversation.id);
  assert.deepEqual(ids, [...ids].sort());
  const empty = await f.project();
  assert.deepEqual((await f.get(`/projects/${empty}/conversations`)).json().conversations, []);
});

test("read routes reject unknown projects, missing conversations, cross-project access and invalid ids", async (t) => {
  const f = await fixture(t);
  failure(await f.get(`/projects/${randomUUID()}/conversations`), 404, "not-found");
  failure(await f.get(`/projects/${randomUUID()}/conversations/${f.conversationId}/messages`), 404, "not-found");
  failure(await f.get(`/projects/${f.projectId}/conversations/${randomUUID()}/messages`), 404, "not-found");
  failure(await f.get(`/projects/${await f.project()}/conversations/${f.conversationId}/messages`), 404, "not-found");
  for (const url of ["/projects/invalid/conversations", `/projects/invalid/conversations/${f.conversationId}/messages`,
    `/projects/${f.projectId}/conversations/invalid/messages`]) failure(await f.get(url), 400, "validation");
});

test("GET messages returns schema-valid ordinal wrappers, pagination and queued turns", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.get(f.url())).json(), { apiVersion: API_VERSION, ok: true, messages: [], turns: [] });
  const ids = [await f.send(), await f.send(), await f.send()];
  const response = await f.get(f.url("?afterOrdinal=1&limit=1"));
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.apiVersion, API_VERSION);
  assert.equal(body.ok, true);
  assert.deepEqual(body.messages.map((entry) => entry.ordinal), [2]);
  assert.equal(body.messages[0].message.id, ids[1]);
  for (const entry of body.messages) assert.deepEqual(messageSchema.parse(entry.message), entry.message);
  assert.deepEqual(body.turns, [...ids].sort().map((id) => ({ id, state: "queued", errorKind: null })));
  assert.deepEqual((await f.get(f.url("?afterOrdinal=3"))).json().messages, []);
});

test("GET messages includes unresolved turns and done turns only when their reply is in the page", async (t) => {
  const f = await fixture(t);
  const done = await f.send(); // ordinal 1
  setTurnState(f.raw, f.projectId, done, "running", { now });
  const reply = f.append({ speaker: "agent", agentId: f.leadId }); // ordinal 2
  setTurnState(f.raw, f.projectId, done, "done", { replyMessageId: reply.message.id, now });
  const failed = await f.send(); // ordinal 3
  setTurnState(f.raw, f.projectId, failed, "failed", { errorKind: "test-failure", now });
  const running = await f.send(); // ordinal 4
  setTurnState(f.raw, f.projectId, running, "running", { now });
  const otherConversation = await f.conversation(f.projectId);
  success(await f.post(sendCommand(f.projectId, otherConversation)));
  const expectedUnresolved = [{ id: failed, state: "failed", errorKind: "test-failure" }, { id: running, state: "running", errorKind: null }]
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const query of ["?limit=1", "?afterOrdinal=2", "?afterOrdinal=99"])
    assert.deepEqual((await f.get(f.url(query))).json().turns, expectedUnresolved);
  const window = (await f.get(f.url("?afterOrdinal=1&limit=1"))).json();
  assert.deepEqual(window.messages.map((entry) => entry.message.id), [reply.message.id]);
  assert.deepEqual(window.turns, [...expectedUnresolved, { id: done, state: "done", errorKind: null }].sort((a, b) => a.id.localeCompare(b.id)));
});

test("GET messages rejects malformed, fractional, negative, unsafe and repeated pagination values", async (t) => {
  const f = await fixture(t);
  for (const query of ["afterOrdinal=-1", "afterOrdinal=1.5", "afterOrdinal=no", "afterOrdinal=", "afterOrdinal=1e2",
    "afterOrdinal=9007199254740992", "afterOrdinal=0&afterOrdinal=1", "limit=0", "limit=-2", "limit=1.5", "limit=abc", "limit=",
    "limit=Infinity", "limit=NaN", "limit=9007199254740992", "limit=1&limit=2"])
    failure(await f.get(f.url(`?${query}`)), 400, "validation");
});

test("GET messages clamps large limits to 200", async (t) => {
  const f = await fixture(t);
  f.raw.transaction(() => { for (let i = 0; i < 205; i++) f.append(); })();
  assert.equal((await f.get(f.url("?limit=1000"))).json().messages.length, 200);
  assert.equal((await f.get(f.url())).json().messages.length, 100);
});

test("pipeline emits injected extra events after all entity effects and before receipt", async (t) => {
  let expectedMessage;
  const f = await fixture(t, { handlers: { "chat.send": (ctx, c) => {
    const first = appendMessage(ctx.raw, { projectId: c.projectId, conversationId: c.payload.conversationId, id: c.payload.messageId,
      speaker: "system", agentId: null, text: "First", createdAt: now });
    const second = appendMessage(ctx.raw, { projectId: c.projectId, conversationId: c.payload.conversationId, id: randomUUID(),
      speaker: "system", agentId: null, text: "Second", createdAt: now });
    expectedMessage = first.message;
    return { effects: [first, second].map(({ message }) => ({ kind: "message", id: message.id, revision: 1 })),
      events: [first, second].map(({ message }) => ({ type: "message.appended", message })) };
  } } });
  const c = sendCommand(f.projectId, f.conversationId);
  success(await f.post(c));
  const all = events(f.raw, c.commandId);
  assert.deepEqual(all.map((event) => event.payload.type), ["entity.changed", "entity.changed", "message.appended", "message.appended", "command.receipted"]);
  assert.deepEqual(all[2].payload.message, expectedMessage);
  assert.ok(all.every((event) => event.rootCausationId === c.commandId && event.causationId === c.commandId));
});

test("pipeline rejection rolls back handler writes and emits only the rejected receipt", async (t) => {
  const f = await fixture(t, { handlers: { "chat.send": (ctx, c) => {
    const result = chatSendHandler(ctx, c);
    assert.equal(result.events.length, 1);
    throw new CommandError("conflict", "injected rejection", "refresh");
  } } });
  const c = sendCommand(f.projectId, f.conversationId);
  failure(await f.post(c), 409, "conflict");
  assert.equal(counts(f.raw).messages, 0);
  assert.equal(counts(f.raw).turns, 0);
  assert.deepEqual(events(f.raw, c.commandId).map((event) => event.payload.type), ["command.receipted"]);
  assert.deepEqual(events(f.raw, c.commandId)[0].payload.receipt.effects, []);
});

test("host startup wires conversations.create and chat.send to the Lead runner", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "factory-chat-host-"));
  let runtime;
  t.after(async () => {
    await runtime?.close();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep + "factory-chat-host-"));
    rmSync(dir, { recursive: true, force: true });
  });
  let bootstrapToken;
  const gateway = createFakeGateway([{ text: "Host Lead reply" }]);
  runtime = await startHost({ stateDir: dir, port: 0, clock,
    onBootstrapToken(token) { bootstrapToken = token; },
    modelGateway: gateway,
  });
  const runtimeHost = `127.0.0.1:${runtime.port}`;
  const runtimeOrigin = `http://${runtimeHost}`;
  const auth = await runtime.app.inject({ method: "POST", url: "/auth/bootstrap",
    headers: { host: runtimeHost, origin: runtimeOrigin, "content-type": "application/json" }, payload: { token: bootstrapToken } });
  assert.equal(auth.statusCode, 200);
  const headers = { host: runtimeHost, origin: runtimeOrigin, cookie: auth.headers["set-cookie"].split(";")[0],
    "x-csrf-token": auth.json().csrfToken, "content-type": "application/json" };
  const post = (payload) => runtime.app.inject({ method: "POST", url: "/commands", headers, payload });
  const projectId = randomUUID();
  success(await post(command("projects.create", projectId, { name: "Host chat", workspace: { kind: "directory", root: "/workspace/host-chat" } })));
  const team = (await runtime.app.inject({ method: "GET", url: `/projects/${projectId}/team`, headers })).json();
  const conversation = conversationCommand(projectId, team.seats.find((seat) => seat.isLead).id);
  success(await post(conversation));
  const send = sendCommand(projectId, conversation.payload.conversationId);
  success(await post(send));
  await runtime.lead.idle();
  assert.equal(getTurn(runtime.storage.raw, projectId, send.payload.messageId).state, "done");
  assert.equal(listMessages(runtime.storage.raw, projectId, conversation.payload.conversationId).messages.length, 2);
  assert.equal(gateway.calls.length, 1);
});
