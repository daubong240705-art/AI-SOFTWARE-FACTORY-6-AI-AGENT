import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { artifactTraceResponseSchema, monitorResponseSchema, tracesResponseSchema, traceResponseSchema } from "@factory/contracts";
import { createApiServer } from "../src/api/server.js";
import { chatSendHandler, conversationsCreateHandler } from "../src/chat/service.js";
import { createCommandPipeline } from "../src/commands/pipeline.js";
import { createAttempt } from "../src/dispatch/attempts.js";
import { eventsForAttempt, moveTask } from "../src/dispatch/tasks.js";
import { EventHub } from "../src/events/hub.js";
import { createBootstrapGate, createSessionStore } from "../src/identity/index.js";
import { createMcpTools } from "../src/mcp/tools.js";
import { loadPack } from "../src/org/pack.js";
import { createProjectsCreateHandler } from "../src/projects/service.js";
import { openStorage } from "../src/storage/database.js";
import { TraceEventHub, TraceRecorder } from "../src/trace/recorder.js";
import { listTraces, readTrace } from "../src/trace/read.js";
import { registerTraceRoutes } from "../src/trace/routes.js";
import { tasksCreateHandler } from "../src/work/service.js";
import { fixedClock, idFactory, MIGRATIONS_DIR } from "./helpers.js";

function fixture(context: TestContext, tracing = true, disk = false) {
  const dir = disk ? mkdtempSync(fileURLToPath(new URL("../trace-", import.meta.url))) : undefined;
  const storage = openStorage(dir ? join(dir, "host.sqlite") : ":memory:");
  storage.migrate({ migrationsDir: MIGRATIONS_DIR, backupDir: null });
  context.after(() => { storage.close(); if (dir) rmSync(dir, { recursive: true }); });
  const { raw } = storage;
  const clock = fixedClock(), newId = idFactory(), projectId = newId();
  const warnings: string[] = [];
  const trace = tracing ? new TraceRecorder(raw, clock, (message) => warnings.push(message)) : undefined;
  const hub = trace ? new TraceEventHub(raw, trace, { clock, newId }) : new EventHub(raw, { clock, newId });
  const pack = loadPack(fileURLToPath(new URL("../../../../packs/software-team", import.meta.url)));
  const pipeline = createCommandPipeline({ storage, hub, clock, newId, handlers: {
    "projects.create": createProjectsCreateHandler({ pack }), "tasks.create": tasksCreateHandler,
    "chat.send": chatSendHandler, "conversations.create": conversationsCreateHandler,
  } });
  const exec = (type: string, payload: unknown, commandId = newId()) => {
    const response = pipeline.execute({ apiVersion: 1, commandId, projectId, type, payload });
    assert.ok(response.body.ok, JSON.stringify(response.body));
    return response;
  };
  exec("projects.create", { name: "Trace test", workspace: { kind: "git", root: "/projects/trace-test" } });
  const { agentId } = raw.prepare(`SELECT s.id agentId FROM engagements e JOIN seats s ON s.team_id=e.team_id WHERE e.project_id=? AND s.is_lead=1`)
    .get(projectId) as { agentId: string };
  const taskId = newId(), commandId = newId();
  const taskPayload = { taskId, code: "TR-001", title: "Traced task", goal: "Verify trace", brief: "Verify trace", parentTaskId: null,
    engagementId: null, ownerSeatId: agentId, placement: "portable", sideEffect: "none", reviewPolicy: "automatic", requiresGo: false,
    requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [] };
  exec("tasks.create", taskPayload, commandId);
  const attemptId = newId();
  hub.transaction(() => {
    for (const status of ["accepted", "ready", "active"] as const) moveTask(raw, projectId, taskId, status, { now: clock().toISOString() });
    const attempt = createAttempt(raw, { projectId, id: attemptId, taskId, seatId: agentId, runtime: "fake", provider: "test", model: "test",
      effort: "medium", now: clock().toISOString() });
    hub.append({ projectId, causationId: attemptId, payload: eventsForAttempt(attempt) });
  });
  return { raw, storage, trace, clock, newId, projectId, agentId, taskId, attemptId, commandId, hub, exec, warnings, taskPayload };
}

test("MCP persists only sizes and links the newest artifact through its creating call", async (context) => {
  const fx = fixture(context, true, true);
  const artifactId = fx.newId();
  const args = { path: "example.pdf", title: "Example", kind: "report", mediaType: "application/pdf", abstractL0: "A document" };
  const marker = "ARGUMENT-MARKER-MUST-NEVER-BE-PERSISTED";
  const resultMarker = "RESULT-MARKER-MUST-NEVER-BE-PERSISTED";
  let version = 0;
  const tools = createMcpTools({ trace: fx.trace!, progress() {}, requestDecision() { throw new Error("not configured"); },
    knowledge: { call() { return { isError: false, content: [{ type: "text", text: resultMarker }] }; } },
    registerOutput() {
      fx.hub.transaction(() => {
        version++;
        fx.raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,
          abstract_l0,produced_by_attempt_id,visibility,created_at) VALUES (?,?,?,'report','Example','application/pdf',?,0,'draft',?,?,'project',?)`)
          .run(fx.projectId, artifactId, version, "a".repeat(64), "A document", fx.attemptId, fx.clock().toISOString());
        fx.hub.append({ projectId: fx.projectId, causationId: fx.attemptId, payload: {
          type: "entity.changed", entity: { kind: "artifact-version", id: artifactId, revision: version },
        } });
      });
      return { artifactId, version };
    },
  });
  const grant = { projectId: fx.projectId, taskId: fx.taskId, attemptId: fx.attemptId, epoch: 1, allowedModels: [], expiresAt: 0 };
  const result = await tools.call(grant, "knowledge.search", { query: marker });
  assert.equal(result.isError, false);
  assert.equal((await tools.call(grant, marker, {})).isError, true);
  for (const _version of [1, 2]) assert.equal((await tools.call(grant, "output.register", args)).isError, false);
  assert.equal(version, 2);
  fx.raw.pragma("wal_checkpoint(TRUNCATE)");
  const persisted = readFileSync(fx.storage.file);
  for (const text of [marker, resultMarker]) assert.equal(persisted.includes(Buffer.from(text)), false);

  const sessions = createSessionStore();
  const app = createApiServer({ origins: ["http://localhost:8787"], sessions, gate: createBootstrapGate(),
    register: (instance, guards) => registerTraceRoutes(instance, guards, { raw: fx.raw, clock: fx.clock, utcOffsetMinutes: 420 }) });
  context.after(() => app.close());
  const url = `/projects/${fx.projectId}`;
  const host = { host: "localhost:8787" };
  assert.equal((await app.inject({ url: `${url}/monitor`, headers: host })).statusCode, 401);
  const headers = { ...host, cookie: `factory_session=${sessions.create().id}` };
  const get = async (path: string) => {
    const response = await app.inject({ url: `${url}${path}`, headers });
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as unknown;
  };
  const monitor = monitorResponseSchema.parse(await get("/monitor"));
  assert.equal(monitor.liveAttempts[0]?.agent?.id, fx.agentId);
  assert.equal(monitor.today.unknownSpans, 1);
  const call = monitor.recentToolCalls.find(({ name }) => name === "knowledge.search")!;
  assert.deepEqual([call.status, call.argsBytes, call.resultBytes],
    ["ok", Buffer.byteLength(JSON.stringify({ query: marker })), Buffer.byteLength(JSON.stringify(result))]);
  assert.ok(monitor.recentToolCalls.some(({ name, status }) => name === "unrecognized" && status === "denied"));
  const artifact = artifactTraceResponseSchema.parse(await get(`/artifacts/${artifactId}/trace`));
  assert.equal(artifact.version, 2);
  assert.equal(artifact.traceId, fx.commandId);
  assert.deepEqual(artifact.spans.map(({ kind }) => kind), ["request", "task", "attempt", "tool-call", "artifact"]);
  assert.equal(artifact.summary.unknownSpans, 1);
  assert.equal(artifactTraceResponseSchema.parse(await get(`/artifacts/${artifactId}/trace?version=1`)).version, 1);
  assert.equal(tracesResponseSchema.parse(await get("/traces?limit=1")).traces[0]?.id, fx.commandId);
  assert.equal(traceResponseSchema.parse(await get(`/traces/${fx.commandId}`)).spans.filter(({ kind }) => kind === "tool-call").length, 4);
  assert.equal((await app.inject({ url: `/projects/${fx.newId()}/traces/${fx.commandId}`, headers })).statusCode, 404);
});

test("backfill records existing rows once and recorder failures do not fail commands", (context) => {
  const fx = fixture(context, false);
  const warnings: string[] = [];
  const trace = new TraceRecorder(fx.raw, fx.clock, (message) => warnings.push(message));
  assert.deepEqual(listTraces(fx.raw, fx.projectId, 10), []);
  trace.backfill();
  const [root] = listTraces(fx.raw, fx.projectId, 10);
  const imported = readTrace(fx.raw, fx.projectId, root!.id);
  assert.deepEqual(imported?.spans.map(({ kind }) => kind).sort(), ["attempt", "request", "task"]);
  assert.equal(imported?.summary.unknownSpans, 1);
  trace.backfill();
  assert.deepEqual(readTrace(fx.raw, fx.projectId, root!.id), imported);
  fx.raw.exec("CREATE TEMP TRIGGER reject_trace BEFORE INSERT ON trace_spans BEGIN SELECT RAISE(ABORT,'trace unavailable'); END");
  for (const code of ["TR-002", "TR-003"]) fx.exec("tasks.create", { ...fx.taskPayload, taskId: fx.newId(), code });
  assert.equal(warnings.length, 1);
});

test("each chat.send command creates one request, including on replay", (context) => {
  const fx = fixture(context);
  const conversationId = fx.newId();
  fx.exec("conversations.create", { conversationId, agentId: fx.agentId, title: "Lead", workItemId: null });
  const commandId = fx.newId(), messageId = fx.newId();
  const payload = { messageId, conversationId, expectedRevision: 1, text: "Discuss the task.", intent: "discuss", attachmentIds: [], context: [], draftRevision: null };
  fx.exec("chat.send", payload, commandId);
  assert.ok(fx.exec("chat.send", payload, commandId).replayed);
  const root = listTraces(fx.raw, fx.projectId, 10).filter(({ title }) => title === "chat.send");
  assert.deepEqual(root.map(({ traceId, detail }) => [traceId, detail.targetId]), [[commandId, messageId]]);
});
