import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { fixture } from "./org-fixture.mjs";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createDispatcher, createDispatchHandlers, createFakeRuntime, RuntimeRegistry, appendAttemptEvent, getAttempt } from "../dist/dispatch/index.js";
import { createApprovalsDecideHandler, requestTaskReview, computeReviewDigest } from "../dist/approvals/service.js";
import { createIntegrationHandlers } from "../dist/integration/commands.js";
import { integratePending, enqueueIntegration } from "../dist/integration/service.js";
import { createRoutes } from "../dist/api/routes.js";

export const sha = "1".repeat(40);
export const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
export const tick = () => new Promise(setImmediate);
export function mockWorkspace(patch = {}) {
  const prepared = [], integrated = [];
  return { prepared, integrated,
    async prepare(input) { prepared.push(input); return { path: join(tmpdir(), "integration-stub"), branch: `factory/${input.taskCode.toLowerCase()}-e${input.epoch}`, baseSha: sha }; },
    async finish(input) { return { ...input, headSha: sha, files: [], totals: { files: 0, additions: 0, deletions: 0 }, flags: [],
      patchBytes: 0, patchTruncated: false, patchFile: null, patchSha256: null, patchSafe: true, unsafeReasons: [] }; },
    async discard() {},
    async integrate(input) { integrated.push(input); return { outcome: "merged", sha }; }, ...patch };
}
export function integrationFixture(t, options = {}) {
  const f = fixture(t, { multiTeam: false });
  const workspace = options.workspace === false ? undefined : options.workspace ?? mockWorkspace();
  const runtime = options.runtime ?? createFakeRuntime({ stepMs: 0 });
  const errors = [];
  const dispatcher = createDispatcher({ storage: f.storage, hub: f.hub, registry: new RuntimeRegistry([runtime]), clock: f.clock,
    ...(workspace ? { workspace, projectRootFor: options.projectRootFor ?? (() => "/workspace/project") } : {}),
    onError: e => errors.push(e) });
  dispatcher.start(); f.cleanup(() => dispatcher.stop());
  const pipeline = createCommandPipeline({ storage: f.storage, hub: f.hub, clock: f.clock, handlers: {
    ...createIntegrationHandlers(), ...createDispatchHandlers({ dispatcher }),
    "approvals.decide": createApprovalsDecideHandler({ dispatcher }),
  } });
  const task = (patch = {}) => f.task({ goal: "Deliver work", seatId: f.seat.id, ...patch });
  const row = (taskId, scope = f.projectId) => f.raw.prepare("SELECT * FROM integration_merges WHERE project_id=? AND task_id=?").get(scope, taskId);
  const merge = (taskId = task({ state: "done" }), patch = {}, scope = f.projectId) => {
    const input = { branch: "factory/org-001-e1", state: "pending", attempts: 0, errorKind: null, createdAt: f.clock().toISOString(), ...patch };
    f.raw.prepare("INSERT INTO integration_merges (project_id,task_id,branch,state,attempts,error_kind,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(scope, taskId, input.branch, input.state, input.attempts, input.errorKind, input.createdAt);
    return taskId;
  };
  const attempt = (taskId, { epoch = 1, branch = "factory/org-001-e1", scope = f.projectId, state = "succeeded" } = {}) => {
    const id = randomUUID();
    f.raw.prepare(`INSERT INTO attempts (project_id,id,task_id,revision,epoch,state,outcome,runtime,provider,model,effort,ended_at)
      VALUES (?,?,?,1,?,?,'known','fake','fake','fake','medium',?)`).run(scope, id, taskId, epoch, state, f.clock().toISOString());
    f.raw.prepare("INSERT INTO attempt_seats VALUES (?,?,?)").run(scope, id, f.seat.id);
    if (branch !== null) appendAttemptEvent(f.raw, { projectId: scope, attemptId: id, kind: "state", body: { to: "workspace-ready", branch, baseSha: sha }, at: f.clock().toISOString() });
    return id;
  };
  const command = (type, taskId, { scope = f.projectId, actor = "operator", commandId = randomUUID(), payload = {} } = {}) => pipeline.execute({
    apiVersion: 1, projectId: scope, commandId, type, payload: { taskId, ...payload },
  }, actor);
  const review = taskId => f.hub.transaction(() => requestTaskReview({ raw: f.raw, hub: f.hub, now: f.clock, newId: randomUUID },
    { projectId: f.projectId, taskId, attemptId: attempt(taskId) }));
  const accept = (taskId, approvalId = review(taskId), optionId = "accept") => pipeline.execute({ apiVersion: 1, projectId: f.projectId,
    commandId: randomUUID(), type: "approvals.decide", payload: { approvalId, expectedRevision: 1,
      contextDigest: computeReviewDigest(f.raw, f.projectId, taskId), optionId, comment: "Reviewed" } });
  const work = () => integratePending({ raw: f.raw, hub: f.hub, workspace: workspace ?? {},
    projectRootFor: options.projectRootFor ?? (() => "/workspace/project"), now: () => f.clock().toISOString() });
  const enqueue = taskId => dispatcher.enqueue({ projectId: f.projectId, taskId, seatId: f.seat.id });
  const enqueueMerge = taskId => f.raw.transaction(() => enqueueIntegration(f.raw, { projectId: f.projectId, taskId, now: f.clock().toISOString() }))();
  return { ...f, dispatcher, runtime, errors, workspace, pipeline, task, row, merge, attempt, command, review, accept, work, enqueue, enqueueMerge,
    read: a => getAttempt(f.raw, a.projectId, a.id) };
}
export async function integrationApi(t, options = {}) {
  const f = integrationFixture(t, options), app = Fastify(); f.cleanup(() => app.close());
  const session = async (request, reply) => { if (request.headers.cookie !== "session") return reply.code(401).send({ ok: false }); };
  createRoutes({ storage: f.storage, hub: f.hub, pipeline: f.pipeline, clock: f.clock })(app, { session, write: session });
  return { ...f, app, get: (url, authenticated = true) => app.inject({ url, headers: authenticated ? { cookie: "session" } : {} }) };
}
export function success(result) { assert.equal(result.status, 200, JSON.stringify(result.body)); return result; }
