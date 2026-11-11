import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./org-fixture.mjs";
import { EventHub } from "../dist/events/hub.js";
import { createRouteBreaker } from "../dist/policy/breaker.js";
import { createModelProxy, createTokenRegistry } from "../dist/proxy/index.js";
import { createAttempt } from "../dist/dispatch/index.js";
import { DEFAULT_BUDGET_CONFIG } from "../dist/policy/budget.js";
import { tickTeamBreakers } from "../dist/automation/breakers.js";

export const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
export const completion = () => new Response(JSON.stringify({ choices: [{ message: { content: "Answer" } }] }),
  { headers: { "content-type": "application/json" } });
export const body = (patch = {}) => ({ model: "approved", messages: [{ role: "user", content: "Question" }], max_tokens: 16, ...patch });
export function teamFixture(t) {
  const f = fixture(t); let time = f.clock().getTime(); const clock = () => new Date(time);
  const hub = new EventHub(f.raw, { clock });
  const fail = (count = 5, { at = time, projectId = f.projectId, engagementId = f.primary.id, taskId, to = "failed" } = {}) => {
    const eventHub = new EventHub(f.raw, { clock: () => new Date(at) }); const ids = [];
    for (let i = 0; i < count; i++) {
      const id = taskId ?? f.task({ scope: projectId, engagementId, state: "failed" }); ids.push(id);
      eventHub.transaction(() => eventHub.append({ projectId, causationId: id,
        payload: { type: "task.status-changed", taskId: id, to } }));
    }
    return ids;
  };
  return { ...f, hub, clock, fail, advance: ms => { time += ms; },
    tick: (now = clock()) => tickTeamBreakers({ raw: f.raw, hub }, now),
    breaker: (projectId = f.projectId, teamId = f.teamId) => f.raw.prepare("SELECT * FROM team_breakers WHERE project_id=? AND team_id=?").get(projectId, teamId),
    team: (id = f.teamId) => f.raw.prepare("SELECT * FROM teams WHERE id=?").get(id),
    cursor: () => hub.currentCursor(f.projectId).sequence };
}
export async function proxyFixture(t, options = {}) {
  const f = fixture(t); let time = f.clock().getTime(); const clock = () => new Date(time);
  const taskId = f.task({ engagementId: f.primary.id }); const attemptId = randomUUID();
  createAttempt(f.raw, { projectId: f.projectId, taskId, id: attemptId, seatId: f.seat.id,
    runtime: "fake", provider: "fake", model: "approved", effort: "medium", now: clock().toISOString() });
  const tokens = createTokenRegistry({ clock });
  const token = tokens.issue({ projectId: f.projectId, taskId, attemptId, epoch: 1, allowedModels: ["approved", "other"] }).token;
  const breaker = createRouteBreaker({ clock }); const outcomes = []; let calls = 0;
  const observer = { allow: key => breaker.allow(key), snapshot: () => breaker.snapshot(), abandon: key => breaker.abandon(key),
    record(key, outcome) { outcomes.push([key, outcome]); breaker.record(key, outcome); } };
  const proxy = createModelProxy({ tokens, raw: f.raw, clock, newId: randomUUID, allowedHosts: ["127.0.0.1:8788"],
    budget: DEFAULT_BUDGET_CONFIG, routeBreaker: observer, ...options,
    upstream: { providerId: "fake", chatCompletions: async (input, signal) => { calls++; return (options.respond ?? completion)(input, signal); } } });
  t.after(async () => { tokens.revokeAll(); await proxy.close(); });
  const headers = { host: "127.0.0.1:8788", authorization: `Bearer ${token}`, "content-type": "application/json" };
  return { ...f, proxy, breaker, outcomes, clock, tokens, attemptId, headers, calls: () => calls,
    advance: ms => { time += ms; }, rows: () => f.raw.prepare("SELECT * FROM usage_records").all(),
    inject: (input = body(), overrides = {}) => proxy.app.inject({ method: "POST", url: "/v1/chat/completions", headers, payload: input, ...overrides }) };
}
export function open(breaker, key = "approved") { for (let i = 0; i < 5; i++) breaker.record(key, "fail"); }
export function expectStatus(response, status, code) {
  assert.equal(response.statusCode, status, response.body);
  if (code) assert.equal(response.json().error.code, code);
}
