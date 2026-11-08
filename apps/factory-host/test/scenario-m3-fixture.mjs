import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { openStorage } from "../dist/storage/database.js";
import { EventHub } from "../dist/events/hub.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { createOrgHandlers, loadPack, registryEntry, getPrimaryEngagement, listSeats } from "../dist/org/index.js";
import { tasksCreateHandler, getTask } from "../dist/work/service.js";
import { createDispatcher, createDispatchHandlers, createFakeRuntime, RuntimeRegistry, listAttempts } from "../dist/dispatch/index.js";
import { createApprovalsDecideHandler, requestTaskReview, requestAgentDecision, getApprovalView } from "../dist/approvals/service.js";
import { registerAgentOutput, registerAttemptResults } from "../dist/artifacts/service.js";
import { createKnowledgeIndex } from "../dist/knowledge/index.js";
import { createKnowledgeHandlers, withKnowledgeEffects } from "../dist/knowledge/commands.js";
import { collectLifecycleChanges } from "../dist/knowledge/lifecycle.js";
import { createKnowledgeMcp } from "../dist/knowledge/mcp.js";
import { createRequestHandlers } from "../dist/requests/commands.js";
import { createRequestsMcp } from "../dist/requests/mcp.js";
import { createDossierHandlers } from "../dist/dossier/commands.js";
import { createBriefingMcp } from "../dist/dossier/mcp.js";
import { createSkillsMcp } from "../dist/instructions/mcp.js";
import { createToolPolicy } from "../dist/mcp/policy.js";
import { createMcpHandler } from "../dist/mcp/rpc.js";
import { assertActiveGrant } from "../dist/mcp/security.js";
import { createApiServer } from "../dist/api/server.js";
import { createSessionStore } from "../dist/identity/index.js";
import { createRoutes } from "../dist/api/routes.js";

export const packs = Object.fromEntries(["software", "research", "architecture", "design"].map(key =>
  [key, loadPack(fileURLToPath(new URL(`../../../packs/${key}-team/`, import.meta.url)))]));
export const ref = value => ({ artifactId: value.artifactId, version: value.version });
export const L1 = "Evidence: Project X needs a traceable, accessible workflow with explicit acceptance criteria.\nDecision: Pin reviewed source versions and verify every deliverable before implementation begins.";

export async function until(predicate, label = "scenario state", timeout = 4000) {
  const deadline = performance.now() + timeout;
  do {
    if (predicate()) return;
    await new Promise(done => setTimeout(done, 5));
  } while (performance.now() < deadline);
  assert.fail(`Timed out waiting for ${label}`);
}

// Keep the real Fake runtime's progress, hang, cancellation and context handling.
// The test can additionally deliver a completion event, as a scripted agent would.
function scriptedRuntime() {
  const fake = createFakeRuntime({ stepMs: 0 });
  const completions = new Map();
  const adapter = { kind: "fake", async start(context) {
    const session = await fake.start(context);
    const completed = new Promise(done => completions.set(context.ref.attemptId, done));
    return { stop: () => session.stop(), async *events() {
      const iterator = session.events()[Symbol.asyncIterator]();
      let next = iterator.next();
      try {
        for (;;) {
          const item = await Promise.race([next, completed.then(value => ({ value, done: false, scripted: true }))]);
          if (item.done) return;
          yield item.value;
          if (item.scripted) return;
          next = iterator.next();
        }
      } finally { completions.delete(context.ref.attemptId); await session.stop(); }
    } };
  } };
  return { fake, adapter, complete(id) {
    assert.ok(completions.has(id), "completion belongs to a live runtime session");
    completions.get(id)({ type: "completed", summary: "Scripted deliverables verified" });
  } };
}

export function fixture(t, options = {}) {
  const parent = fileURLToPath(new URL("./", import.meta.url));
  const root = mkdtempSync(join(parent, ".scenario-m3-"));
  let shutdown = async () => {};
  t.after(async () => {
    try { await shutdown(); }
    finally {
      assert.ok(resolve(root).startsWith(resolve(parent) + sep + ".scenario-m3-"));
      rmSync(root, { recursive: true, force: true });
    }
  });
  const storage = openStorage(":memory:");
  storage.migrate({ migrationsDir: fileURLToPath(new URL("../migrations/", import.meta.url)), backupDir: null });
  const raw = storage.raw;
  shutdown = async () => storage.close();
  let time = Date.parse("2026-11-08T00:00:00.000Z");
  const clock = () => new Date(time);
  const tick = () => { time += 1000; };
  const multiTeam = options.multiTeam ?? true;
  const hub = new EventHub(raw, { clock });
  const objects = new Map();
  const store = {
    put(value) { const bytes = Buffer.from(value); const hash = createHash("sha256").update(bytes).digest("hex"); objects.set(hash, bytes); return { hash, size: bytes.length }; },
    get: hash => objects.get(hash) ?? null,
    has: hash => objects.has(hash), size: hash => objects.get(hash)?.length ?? null,
  };
  const knowledge = createKnowledgeIndex({ raw, store });
  const afterRegister = value => knowledge.indexVersion(value.projectId, value.artifactId, value.version);
  const runtime = scriptedRuntime();
  const errors = [];
  const dispatcher = createDispatcher({ storage, hub, clock, multiTeam,
    registry: new RuntimeRegistry([runtime.adapter]), config: { nodeSlots: 32 }, onError: error => errors.push(error),
    projectRootFor: () => root,
    // No git operations: each real dispatcher attempt gets an isolated directory.
    workspace: {
      async prepare({ taskCode, epoch }) { const path = join(root, `${taskCode}-${epoch}`); mkdirSync(path); return { path, branch: `scenario-${taskCode}-${epoch}`, baseSha: "0".repeat(40) }; },
      async finish() { return undefined; }, async discard() {},
    },
    results: { register(input) { registerAttemptResults({ raw, store, now: clock, newId: randomUUID, afterRegister }, { ...input, evidenceDir: root }); } },
    onInReview(input) { requestTaskReview({ raw, hub, now: clock, newId: randomUUID }, input); },
  });
  shutdown = async () => { await dispatcher.stop(); storage.close(); assert.deepEqual(errors, [], "dispatcher had no background failures"); };
  const dispatchHandlers = createDispatchHandlers({ dispatcher });
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack: packs.software, multiTeam }),
    "tasks.create": tasksCreateHandler,
    ...createOrgHandlers({ packs: Object.entries(packs).map(([key, pack]) => registryEntry(pack, key === "software")), multiTeam }),
    ...dispatchHandlers,
    "tasks.transition": withKnowledgeEffects(dispatchHandlers["tasks.transition"]),
    "approvals.decide": withKnowledgeEffects(createApprovalsDecideHandler({ dispatcher, multiTeam: true })),
    ...createKnowledgeHandlers({ multiTeam }),
    ...createRequestHandlers({ multiTeam, dispatcher }),
    ...createDossierHandlers({ store, afterRegister }),
  } });
  const projectId = randomUUID();
  const execute = (type, payload = {}) => pipeline.execute({ apiVersion: 1, commandId: randomUUID(), projectId, type, payload });
  const ok = (type, payload = {}) => { const result = execute(type, payload); assert.equal(result.status, 200, `${type}: ${JSON.stringify(result.body)}`); return result; };
  // The project command uses the Host's Linux workspace contract on either OS;
  // the injected provider maps attempts into the disposable local test directory.
  ok("projects.create", { name: "Project X", workspace: { kind: "directory", root: `/workspace/${projectId}` } });
  const primary = getPrimaryEngagement(raw, projectId);
  if (multiTeam) ok("engagements.update", { engagementId: primary.id, expectedRevision: primary.revision, maxConcurrent: 8 });
  const teams = { software: { id: primary.teamId, engagementId: primary.id } };
  if (multiTeam) for (const key of ["research", "architecture", "design"]) {
    tick();
    const teamId = randomUUID(), engagementId = randomUUID();
    ok("teams.create-from-pack", { teamId, packKey: packs[key].manifest.key, packVersion: packs[key].manifest.version });
    ok("engagements.create", { engagementId, teamId, priority: 50, maxConcurrent: 8 });
    teams[key] = { id: teamId, engagementId };
  }
  for (const team of Object.values(teams)) team.seats = listSeats(raw, team.id);
  const seat = (team, name) => teams[team].seats.find(value => value.name === name);
  const attempts = taskId => listAttempts(raw, projectId, taskId);
  const task = taskId => getTask(raw, projectId, taskId);
  const transition = (taskId, to) => ok("tasks.transition", { taskId, expectedRevision: task(taskId).revision, to });
  let code = 0;
  function createTask(team, patch = {}) {
    const taskId = randomUUID();
    ok("tasks.create", { taskId, code: `MTH-${String(++code).padStart(3, "0")}`, title: "Scenario work", goal: "[fake:hang]", brief: "Project X deliverable",
      parentTaskId: null, engagementId: teams[team].engagementId, ownerSeatId: null, requiredCapabilities: [], acceptance: ["Verify deliverable"],
      inputs: [], dependsOn: [], placement: "portable", sideEffect: "none", reviewPolicy: "human-final", requiresGo: true, ...patch });
    transition(taskId, "proposed"); transition(taskId, "accepted");
    return taskId;
  }
  const context = attemptId => runtime.fake.started.find(value => value.ref.attemptId === attemptId);
  async function live(taskId) {
    await until(() => { const a = attempts(taskId).at(-1); return a?.state === "running" && context(a.id); }, "running attempt");
    const attempt = attempts(taskId).at(-1);
    return { projectId, taskId, attemptId: attempt.id, epoch: attempt.epoch, allowedModels: [], workspacePath: context(attempt.id).workspace.path };
  }
  async function start(team, patch = {}) {
    const taskId = createTask(team, patch);
    if (task(taskId).state === "awaiting-go") ok("tasks.release", { taskId, expectedRevision: task(taskId).revision });
    return live(taskId);
  }
  const requestDeps = { raw, hub, dispatcher, multiTeam, now: clock, newId: randomUUID, ...options.requestLimits };
  const mcp = createMcpHandler({
    toolPolicy: createToolPolicy(raw), skills: createSkillsMcp({ raw, now: clock }),
    ...(multiTeam ? { requests: createRequestsMcp(requestDeps), briefing: createBriefingMcp({ raw, store, now: clock }) } : {}),
    knowledge: createKnowledgeMcp({ raw, knowledge, now: clock }),
    progress(grant, input) { assertActiveGrant(raw, grant); assert.equal(dispatcher.recordAgentProgress(grant, input.summary, input.percent), true); },
    requestDecision(grant, request) { return requestAgentDecision({ raw, hub, now: clock, newId: randomUUID }, { grant, request }); },
    registerOutput(grant, input) {
      return hub.transaction(() => {
        const { result, effects } = collectLifecycleChanges(raw, () => registerAgentOutput({ raw, store, now: clock, newId: randomUUID, afterRegister }, { ...input, grant }));
        for (const entity of [...effects, { kind: "artifact-version", id: result.artifactId, revision: result.version }])
          hub.append({ projectId, causationId: grant.attemptId, rootCausationId: grant.attemptId, payload: { type: "entity.changed", entity } });
        return result;
      });
    },
  });
  const send = (grant, method, params = {}) => mcp.handle(grant, { jsonrpc: "2.0", id: 1, method, params }).body.result;
  const call = (grant, name, args = {}) => send(grant, "tools/call", { name, arguments: args });
  const value = (grant, name, args) => { const result = call(grant, name, args); assert.equal(result.isError, false, `${name}: ${result.content[0].text}`); return JSON.parse(result.content[0].text); };
  function output(grant, kind, title, patch = {}) {
    const path = `${randomUUID()}.md`;
    writeFileSync(join(grant.workspacePath, path), `# ${title}\nProject X verified content.\n`);
    return ref(value(grant, "output.register", { kind, title, path, mediaType: "text/markdown", abstractL0: `${title} for Project X`, abstractL1: L1, inputs: [], ...patch }));
  }
  const row = value => raw.prepare("SELECT * FROM artifact_versions WHERE project_id=? AND artifact_id=? AND version=?").get(projectId, value.artifactId ?? value.id, value.version ?? value.revision);
  const artifactTransition = (value, to) => ok("artifacts.transition", { ...ref(value), to, comment: "Scenario review" });
  function approve(value) { for (const to of ["in-review", "reviewed", "approved"].slice(["draft", "in-review", "reviewed"].indexOf(row(value).status))) artifactTransition(value, to); }
  async function finish(grant) { runtime.complete(grant.attemptId); await until(() => task(grant.taskId).state === "in-review", "task review"); }
  function accept(taskId) {
    const pending = raw.prepare("SELECT id FROM approvals WHERE project_id=? AND task_id=? AND state='pending'").get(projectId, taskId);
    assert.ok(pending, "real completion created a review approval");
    const approval = getApprovalView(raw, projectId, pending.id);
    ok("approvals.decide", { approvalId: approval.id, expectedRevision: approval.revision, contextDigest: approval.context.digest, optionId: "accept", comment: "Verified" });
  }
  const refresh = () => { const effect = ok("dossier.refresh").body.receipt.effects[0]; return { artifactId: effect.id, version: effect.revision }; };
  const sessions = createSessionStore(), session = sessions.create();
  const routes = createRoutes({ storage, hub, pipeline, clock, dispatch: dispatcher, artifacts: { store } });
  const app = createApiServer({ origins: ["http://127.0.0.1:18787"], sessions, gate: { consume() { return "invalid"; } }, register: routes });
  const read = async suffix => { const response = await app.inject({ method: "GET", url: `/projects/${projectId}/${suffix}`, headers: { host: "127.0.0.1:18787", cookie: `factory_session=${session.id}` } }); assert.equal(response.statusCode, 200); return response.json(); };
  dispatcher.start();
  shutdown = async () => {
    await app.close(); await dispatcher.stop(); storage.close();
    assert.deepEqual(errors, [], "dispatcher had no background failures");
  };
  return { raw, storage, hub, dispatcher, runtime: runtime.fake, clock, tick, projectId, primary, teams, seat, task, attempts, context,
    execute, ok, transition, createTask, start, live, send, call, value, output, row, approve, artifactTransition, finish, accept, refresh, read, requestDeps };
}

export const request = (teamId, patch = {}) => ({ kind: "consult", targetTeamId: teamId, subject: "Project X advice", ask: "[fake:hang] Explain the Project X design",
  expectedResponse: { form: "answer", format: "Markdown", acceptance: ["Explain the tradeoffs"] }, contextRefs: [], responseMode: "async", ...patch });
