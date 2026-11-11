import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fixture as orgFixture, otherPack } from "./org-fixture.mjs";
import { ensureTeamFromPack } from "../dist/org/service.js";
import { createAttempt, listAttempts, moveTask, LOCAL_NODE_ID } from "../dist/dispatch/index.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createRequestHandlers } from "../dist/requests/commands.js";
import { createApprovalsDecideHandler, requestTaskReview } from "../dist/approvals/service.js";
import { createRequest, getRequest, replyRequest, triageRequest } from "../dist/requests/service.js";
import { createKnowledgeIndex } from "../dist/knowledge/index.js";

export const kinds = ["clarify", "consult", "produce", "review", "decision", "notify"];
export const requestInput = (targetTeamId, patch = {}) => ({ kind: "produce", targetTeamId, subject: "Architecture advice", ask: "Explain the design",
  expectedResponse: { form: "answer", format: "Markdown", acceptance: ["Explain the tradeoffs"] }, ...patch });
export async function until(predicate) {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise((done) => setTimeout(done, 5)); }
  assert.fail("Expected task state was not reached");
}
export function snapshot(raw) {
  return JSON.stringify(raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, raw.prepare(`SELECT * FROM "${name}"`).all().map((row) => JSON.stringify(row)).sort()]));
}
export function refused(f, fn, message) {
  const before = snapshot(f.raw);
  assert.throws(fn, (error) => error.message === message);
  assert.equal(snapshot(f.raw), before);
}
export function fixture(t, options = {}) {
  const f = orgFixture(t, options); const team = f.secondTeam();
  const secondTeam = () => ensureTeamFromPack(f.raw, { ...otherPack, manifest: { ...otherPack.manifest, key: `team-${randomUUID()}` } },
    { newId: randomUUID, clock: f.clock }).teamId;
  const deps = { raw: f.raw, hub: f.hub, dispatcher: f.dispatcher, now: f.clock, newId: randomUUID, multiTeam: options.enabled ?? true };
  const seed = (taskId = f.task({ seatId: f.seat.id }), seatId = f.seat.id, scope = f.projectId) => {
    const attempt = createAttempt(f.raw, { projectId: scope, taskId, seatId, id: randomUUID(), runtime: "fake", provider: "fake", model: "fake", effort: "medium", now: f.clock().toISOString() });
    f.raw.prepare("UPDATE attempts SET state = 'running',node_id = ?,lease_id = ?,lease_expires_at = ?,started_at = ? WHERE project_id = ? AND id = ?")
      .run(LOCAL_NODE_ID, randomUUID(), "2099-01-01T00:00:00.000Z", f.clock().toISOString(), scope, attempt.id);
    return { projectId: scope, taskId, attemptId: attempt.id, epoch: attempt.epoch, allowedModels: [], expiresAt: Date.parse("2099-01-01") };
  };
  const grant = seed();
  const create = (patch = {}, by = grant, overrides = {}) => createRequest({ ...deps, ...overrides }, { grant: by, input: requestInput(team, patch) });
  const triage = (id, decision = "accept", patch = {}) => triageRequest(f.raw,
    { projectId: f.projectId, requestTaskId: id, decision, reason: "Operator reason", actorId: "operator", now: f.clock().toISOString(), ...patch }, deps);
  const reply = (id, action = "message", message = "Please clarify", by = grant) => replyRequest(deps,
    { grant: by, requestId: id, action, ...(message === undefined ? {} : { message }) });
  const view = (id, by = grant) => getRequest(f.raw, { grantOrOperator: by, requestId: id });
  const meta = (id) => f.raw.prepare("SELECT * FROM ctr_meta WHERE project_id = ? AND task_id = ?").get(f.projectId, id);
  const pipeline = createCommandPipeline({ storage: f.storage, hub: f.hub, clock: f.clock, handlers: {
    ...createRequestHandlers({ multiTeam: deps.multiTeam, dispatcher: f.dispatcher }), "approvals.decide": createApprovalsDecideHandler({ dispatcher: f.dispatcher }),
  } });
  const execute = (type, payload, commandId = randomUUID(), projectId = f.projectId) => pipeline.execute({ apiVersion: 1, commandId, projectId, type, payload });
  const objects = new Map(); const store = {
    put(value) { const bytes = Buffer.from(value); const hash = createHash("sha256").update(bytes).digest("hex"); objects.set(hash, bytes); return { hash, size: bytes.length }; },
    get(hash) { return objects.get(hash) ?? null; },
  };
  const knowledge = createKnowledgeIndex({ raw: f.raw, store });
  const artifact = (patch = {}) => {
    const row = { projectId: f.projectId, artifactId: randomUUID(), version: 1, title: "Context marker", status: "draft", visibility: "team-draft", producer: grant.attemptId, ...patch };
    const content = store.put("Context body marker");
    f.raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,abstract_l0,
      abstract_l1,produced_by_attempt_id,visibility,created_at) VALUES (?,?,?,'requirements',?,'text/markdown',?,?,?,'Context marker','Context detail',?,?,?)`)
      .run(row.projectId, row.artifactId, row.version, row.title, content.hash, content.size, row.status, row.producer, row.visibility, f.clock().toISOString());
    knowledge.indexVersion(row.projectId, row.artifactId, row.version); return { artifactId: row.artifactId, version: row.version };
  };
  const delivered = async (patch = {}) => {
    const result = create({ kind: "clarify", ...patch });
    await until(() => f.getTask(result.requestId).state === "in-review");
    return result.requestId;
  };
  const escalate = async () => {
    const id = await delivered();
    for (let round = 1; round <= 4; round++) {
      reply(id, "request-changes", `Feedback round ${round}`);
      if (round < 4) await until(() => f.getTask(id).state === "in-review");
    }
    return id;
  };
  const review = (id) => requestTaskReview({ raw: f.raw, now: f.clock, newId: randomUUID },
    { projectId: f.projectId, taskId: id, attemptId: listAttempts(f.raw, f.projectId, id).at(-1).id });
  return { ...f, secondTeam, team, deps, grant, seed, create, triage, reply, view, meta, executeCtr: execute, artifact, knowledge, delivered, escalate, review, moveTask };
}
