import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rulesFixture } from "./rules-fixture.mjs";
import { EventHub } from "../dist/events/hub.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createNotification, tickNotifications, createNotificationHandlers } from "../dist/notify/index.js";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
import { recordUsage } from "../dist/policy/budget.js";

export function notifyFixture(t, options = {}) {
  const f = rulesFixture(t);
  let time = Date.parse(options.at ?? "2026-11-10T00:00:00.000Z");
  const clock = () => new Date(time), hub = new EventHub(f.raw, { clock });
  const pipeline = createCommandPipeline({ storage: f.storage, hub, clock, handlers: createNotificationHandlers() });
  const deps = { raw: f.raw, hub, ...options };
  const command = (type, id, projectId = f.projectId, commandId = randomUUID()) => pipeline.execute({
    apiVersion: 1, commandId, projectId, type: `notifications.${type}`, payload: { notificationId: id },
  });
  const rows = (projectId = f.projectId) => f.raw.prepare("SELECT * FROM notifications WHERE project_id=? ORDER BY rowid").all(projectId);
  const deliveries = () => f.raw.prepare("SELECT * FROM notification_deliveries ORDER BY rowid").all();
  const notify = (patch = {}) => {
    const id = patch.id ?? randomUUID();
    createNotification(f.raw, { projectId: f.projectId, id, dedupKey: id, category: "important", urgency: "normal", title: "Update", body: "Details", now: clock(), ...patch });
    return id;
  };
  const approval = (patch = {}) => {
    const { projectId = f.projectId, id = randomUUID(), revision = 1, subject = "Review result", summary = "Decide next step",
      requestedAt = clock().toISOString(), expiresAt = new Date(time + 10 * 86400000).toISOString(), state = "pending" } = patch;
    f.raw.prepare(`INSERT INTO approvals (project_id,id,revision,kind,subject,summary,options_json,impact_if_waiting,context_digest,approver,requested_at,expires_at,state)
      VALUES (?,?,?,'question',?,?,'[{"id":"yes"},{"id":"no"}]','Waiting',?,'operator',?,?,?)`)
      .run(projectId, id, revision, subject, summary, "a".repeat(64), requestedAt, expiresAt, state);
    return id;
  };
  const decide = (id, at = clock().toISOString()) => f.raw.prepare(`UPDATE approvals SET state='approved',outcome_option_id='yes',outcome_actor_id='operator',decided_at=?,revision=revision+1 WHERE id=?`).run(at, id);
  const event = (to, at = clock().toISOString(), projectId = f.projectId, taskId = randomUUID()) => {
    const eventHub = new EventHub(f.raw, { clock: () => new Date(at) });
    eventHub.transaction(() => eventHub.append({ projectId, causationId: taskId, payload: { type: "task.status-changed", taskId, to } }));
    return taskId;
  };
  const clearActivity = () => {
    f.raw.prepare("DELETE FROM outbox WHERE event_id IN (SELECT event_id FROM event_log)").run();
    f.raw.prepare("DELETE FROM event_log").run();
  };
  const usage = (tokens, at = clock().toISOString(), projectId = f.projectId, estimated = false) => {
    const id = randomUUID();
    f.raw.prepare("INSERT INTO conversations (project_id,id,revision,seat_id,title) VALUES (?,?,1,?,'Usage')").run(projectId, id, f.seat.id);
    recordUsage(f.raw, { id: randomUUID(), projectId, taskId: null, attemptId: null, conversationId: id,
      provider: "fake", model: "fake", effort: null, usage: estimated ? null : { inputTokens: tokens, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0 },
      estimatedTokens: estimated ? tokens : null, recordedAt: at });
  };
  return { ...f, hub, clock, deps, pipeline, command, rows, deliveries, notify, approval, decide, event, clearActivity, usage,
    at: value => { time = Date.parse(value); }, advance: ms => { time += ms; }, tick: (now = clock()) => tickNotifications(deps, now) };
}

export async function notifyApi(t) {
  const f = notifyFixture(t), host = "127.0.0.1:8787", origin = `http://${host}`, gate = createBootstrapGate({ clock: f.clock });
  const app = createApiServer({ origins: [origin], clock: f.clock, gate, sessions: createSessionStore({ clock: f.clock }),
    register: createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, clock: f.clock }) });
  t.after(() => app.close());
  const auth = await app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host, origin, "content-type": "application/json" }, payload: { token: gate.token } });
  assert.equal(auth.statusCode, 200);
  const headers = { host, cookie: auth.headers["set-cookie"].split(";")[0] };
  return { ...f, app, root: `/projects/${f.projectId}/notifications`, get: url => app.inject({ url, headers }), anonymous: url => app.inject({ url, headers: { host } }) };
}
