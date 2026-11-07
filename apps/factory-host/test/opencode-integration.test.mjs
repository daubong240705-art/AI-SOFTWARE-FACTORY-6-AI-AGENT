import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { API_VERSION } from "@factory/contracts";
import { createOpenCodeRuntime } from "../dist/runtimes/index.js";
import { isSandboxAvailable, SANDBOX_RELAY_PORT } from "../dist/sandbox/index.js";
import { assertInside, cloneProject, createWorktree, runGit } from "../dist/workspace/index.js";
import { createModelProxy, createTokenRegistry } from "../dist/proxy/index.js";
import { createUpstream } from "../dist/models/index.js";
import { openStorage } from "../dist/storage/database.js";
import { EventHub } from "../dist/events/hub.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { tasksCreateHandler, getTask } from "../dist/work/service.js";
import { loadPack, findLeadSeat, getActiveEngagement } from "../dist/org/index.js";
import { createAttempt, moveTask } from "../dist/dispatch/index.js";
import { DEFAULT_BUDGET_CONFIG } from "../dist/policy/index.js";

const opencodeDir = process.platform === "linux" ? process.env.FACTORY_OPENCODE_DIR ?? "/home/lazy/factory-v2/opencode" : "";
const available = process.platform === "linux" && fs.existsSync(join(opencodeDir, "bin", "opencode")) && await isSandboxAvailable();
const integration = (name, fn) => test(name, { timeout: 60_000,
  skip: available ? false : "Requires Linux, working bubblewrap and the real OpenCode installation" }, fn);
const relayFile = fileURLToPath(new URL("../dist/sandbox/relay-main.js", import.meta.url));
const key = "synthetic-integration-upstream-private-value";
const usage = { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 };
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const collect = async (session) => { const events = []; for await (const event of session.events()) events.push(event); return events; };
async function until(predicate) {
  const deadline = performance.now() + 15_000;
  while (!predicate()) { assert.ok(performance.now() < deadline, "Condition did not become true"); await delay(20); }
}
function hashTree(root) {
  const hash = createHash("sha256");
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name); hash.update(entry.name); hash.update(String(fs.lstatSync(path).mode));
      if (entry.isDirectory()) walk(path); else hash.update(fs.readFileSync(path));
    }
  }
  walk(root); return hash.digest("hex");
}
function markerProcesses(marker) {
  const found = [];
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try { if (fs.readFileSync(`/proc/${entry}/cmdline`).includes(Buffer.from(marker))) found.push(Number(entry)); }
    catch (error) { if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error; }
  }
  return found;
}
function safe(events, f) {
  const value = JSON.stringify(events);
  for (const secret of [key, ...f.credentials, ...Object.values(f.roots), ...f.contexts.map((c) => c.workspace.path)])
    assert.equal(value.includes(secret), false, "events must contain no private values");
}
function reply(res, body, delta, finishReason) {
  if (body.stream) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (choices, extra = {}) => ({ id: "chatcmpl-fixture", object: "chat.completion.chunk", created: 1, model: "approved", choices, ...extra });
    res.write(`data: ${JSON.stringify(chunk([{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }]))}\n\n`);
    res.write(`data: ${JSON.stringify(chunk([{ index: 0, delta: {}, finish_reason: finishReason }]))}\n\n`);
    res.end(`data: ${JSON.stringify(chunk([], { usage }))}\n\ndata: [DONE]\n\n`);
  } else res.end(JSON.stringify({ id: "chatcmpl-fixture", object: "chat.completion", created: 1, model: "approved",
    choices: [{ index: 0, message: { role: "assistant", ...delta }, finish_reason: finishReason }], usage }));
}
async function fixture(t, { mode = "write", timeoutMs = 30_000, stallMs = 15_000, commandFor } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-opencode-integration-")));
  const sessions = []; const credentials = []; const contexts = []; const calls = [];
  let proxy; let storage; let server;
  let tokens;
  t.after(async () => {
    for (const session of sessions) await session.stop().catch(() => {});
    tokens?.revokeAll();
    await proxy?.close();
    if (server?.listening) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
    storage?.close();
    fs.rmSync(assertInside(fs.realpathSync(tmpdir()), root), { recursive: true, force: true });
  });
  const source = join(root, "source"); fs.mkdirSync(source);
  await runGit(source, ["init", "--initial-branch=main", "--template="]);
  await runGit(source, ["config", "user.name", "Fixture"]); await runGit(source, ["config", "user.email", "fixture@localhost"]);
  fs.writeFileSync(join(source, "base.txt"), "base\n"); await runGit(source, ["add", "-A"]);
  const tree = (await runGit(source, ["write-tree"])).stdout.trim();
  const head = (await runGit(source, ["commit-tree", tree, "-m", "base"])).stdout.trim();
  await runGit(source, ["update-ref", "refs/heads/main", head]);
  const roots = { projectsRoot: join(root, "projects"), worktreesRoot: join(root, "worktrees"), stateDir: join(root, "state") };
  fs.mkdirSync(roots.stateDir, { mode: 0o700 }); fs.mkdirSync(join(roots.stateDir, "nested"));
  fs.writeFileSync(join(roots.stateDir, "nested", "private-marker"), "protected host state");
  const project = await cloneProject(roots, { name: "OpenCode integration", source });
  const nodeDir = join(root, "node-prefix"); fs.mkdirSync(join(nodeDir, "bin"), { recursive: true });
  fs.copyFileSync(fs.realpathSync(process.execPath), join(nodeDir, "bin", "node")); fs.chmodSync(join(nodeDir, "bin", "node"), 0o755);
  const socketDir = join(root, "proxy"); fs.mkdirSync(socketDir, { mode: 0o700 }); const socketPath = join(socketDir, "model.sock");
  // The proxy owns its SQLite file separately from the protected state fixture, whose bytes the sandbox must preserve.
  storage = openStorage(join(root, "proxy-usage.db"));
  storage.migrate({ migrationsDir: fileURLToPath(new URL("../migrations/", import.meta.url)), backupDir: null });
  const raw = storage.raw; const clock = () => new Date(); tokens = createTokenRegistry({ clock });
  const hub = new EventHub(raw); const pipeline = createCommandPipeline({ storage, hub, handlers: {
    "projects.create": createProjectsCreateHandler({ pack: loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url))) }),
    "tasks.create": tasksCreateHandler,
  } });
  const projectId = randomUUID();
  const execute = (type, payload) => assert.equal(pipeline.execute({ apiVersion: API_VERSION, commandId: randomUUID(), projectId, type, payload }).status, 200);
  execute("projects.create", { name: "Runtime integration", workspace: { kind: "directory", root: project.root } });
  const seatId = findLeadSeat(raw, getActiveEngagement(raw, projectId).teamId).id;
  server = createServer(async (req, res) => {
    let input = ""; for await (const chunk of req) input += chunk;
    const body = JSON.parse(input); calls.push({ headers: req.headers, body });
    if (mode === "hold") return;
    res.setHeader("content-type", "application/json");
    const hasTools = Boolean(body.tools?.length); const hasResult = body.messages.some((message) => message.role === "tool");
    if (hasTools && !hasResult) {
      const command = commandFor?.({ root, roots, source, project, contexts, port: server.address().port });
      const toolName = command ? "bash" : "write";
      const serialized = JSON.stringify(body.messages);
      const current = contexts.find((context) => serialized.includes(context.workspace.path) || serialized.includes(context.task.code));
      const argumentsText = JSON.stringify(command ? { command, description: "Verify sandbox isolation" }
        : { filePath: join(current.workspace.path, "NEW.md"), content: `Created for ${current.task.code}\n` });
      reply(res, body, { content: null, tool_calls: [{ ...(body.stream ? { index: 0 } : {}), id: "call_fixture", type: "function",
        function: { name: toolName, arguments: argumentsText } }] }, "tool_calls");
    } else reply(res, body, { content: hasTools ? "Done" : "Fixture title" }, "stop");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const upstream = createUpstream({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: key, providerId: "fixture" });
  proxy = createModelProxy({ upstream, tokens, raw, clock, newId: randomUUID,
    allowedHosts: [`127.0.0.1:${SANDBOX_RELAY_PORT}`, `localhost:${SANDBOX_RELAY_PORT}`],
    budget: { ...DEFAULT_BUDGET_CONFIG, defaultTaskTokens: 10_000_000, defaultDayTokens: 100_000_000 } });
  await proxy.app.listen({ path: socketPath }); fs.chmodSync(socketPath, 0o600);
  const runtime = createOpenCodeRuntime({ roots, opencodeDir: fs.realpathSync(opencodeDir), nodeDir, relayFile: fs.realpathSync(relayFile), timeoutMs, stallMs });
  const stateBefore = hashTree(roots.stateDir);
  async function context() {
    const index = contexts.length + 1; const taskId = randomUUID(); const attemptId = randomUUID(); const code = `DEV-${String(index).padStart(3, "0")}`;
    execute("tasks.create", { taskId, code, title: "Create the requested file", goal: "Create NEW.md and report Done", brief: "Fixture", parentTaskId: null,
      engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: ["File exists"], inputs: [], dependsOn: [] });
    for (const state of ["accepted", "ready", "active"]) moveTask(raw, projectId, taskId, state);
    createAttempt(raw, { projectId, taskId, id: attemptId, seatId, runtime: "native-opencode", provider: "fixture", model: "approved", effort: "medium", now: clock().toISOString() });
    const workspace = await createWorktree(roots, { projectRoot: project.root, projectSlug: project.slug, taskCode: code, epoch: 1 });
    const token = tokens.issue({ projectId, taskId, attemptId, epoch: 1, allowedModels: ["approved"] }).token; credentials.push(token);
    const result = { ref: { projectId, taskId, attemptId, epoch: 1, leaseId: randomUUID() }, task: getTask(raw, projectId, taskId),
      seat: { id: seatId, name: "Developer", role: "Implement and verify" }, handoff: null, signal: new AbortController().signal,
      model: { baseUrl: `http://127.0.0.1:${SANDBOX_RELAY_PORT}/v1`, token, models: ["approved"], socketPath }, workspace };
    contexts.push(result); return result;
  }
  const start = async (input) => { const session = await runtime.start(input ?? await context()); sessions.push(session); return session; };
  return { root, roots, source, project, credentials, contexts, calls, raw, tokens, runtime, context, start, stateBefore,
    stateUnchanged: () => assert.equal(hashTree(roots.stateDir), stateBefore),
    closeUpstream: async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); } };
}

integration("real OpenCode writes through the tool loop and records attributed proxy usage", async (t) => {
  const f = await fixture(t); const context = await f.context(); const events = await collect(await f.start(context));
  assert.deepEqual(events.at(-1), { type: "completed", summary: "Done" });
  assert.equal(fs.readFileSync(join(context.workspace.path, "NEW.md"), "utf8"), `Created for ${context.task.code}\n`);
  for (const directory of [f.root, f.source, f.project.root, f.roots.stateDir, process.cwd()]) assert.equal(fs.existsSync(join(directory, "NEW.md")), false);
  const rows = f.raw.prepare("SELECT * FROM usage_records WHERE attempt_id = ?").all(context.ref.attemptId);
  assert.ok(rows.length >= 2); assert.ok(rows.some((row) => row.input_tokens === 20 && row.output_tokens === 6));
  for (const row of rows) { assert.equal(row.project_id, context.ref.projectId); assert.equal(row.task_id, context.ref.taskId); }
  assert.ok(f.calls.length >= 2);
  for (const call of f.calls) {
    assert.equal(call.headers.authorization, `Bearer ${key}`); assert.equal(JSON.stringify(call).includes(context.model.token), false);
    assert.equal(call.body.model, "approved"); assert.equal(call.body.max_tokens, 8192);
  }
  safe(events, f); f.stateUnchanged();
});
integration("real OpenCode upstream outage is bounded by adapter deadlines", async (t) => {
  const f = await fixture(t, { timeoutMs: 4000, stallMs: 2000 }); await f.closeUpstream();
  const started = performance.now(); const events = await collect(await f.start());
  assert.equal(events.at(-1).type, "failed"); assert.ok(["model", "timeout"].includes(events.at(-1).kind));
  assert.ok(performance.now() - started < 15_000); safe(events, f); f.stateUnchanged();
});
integration("real OpenCode stop removes marked processes and ends event delivery", async (t) => {
  const f = await fixture(t, { mode: "hold" }); const context = await f.context(); const marker = `factory-stop-${randomUUID()}`;
  context.handoff = marker; const session = await f.start(context);
  await until(() => f.calls.length > 0); assert.ok(markerProcesses(marker).length > 0);
  await session.stop(); assert.deepEqual(markerProcesses(marker), []); assert.deepEqual(await collect(session), []); f.stateUnchanged();
});
integration("real OpenCode concurrent attempts write only their own worktrees", async (t) => {
  const f = await fixture(t); const first = await f.context(); const second = await f.context();
  const sessions = await Promise.all([f.start(first), f.start(second)]); const events = await Promise.all(sessions.map(collect));
  for (let index = 0; index < 2; index++) {
    assert.deepEqual(events[index].at(-1), { type: "completed", summary: "Done" });
    assert.equal(fs.readFileSync(join(f.contexts[index].workspace.path, "NEW.md"), "utf8"), `Created for ${f.contexts[index].task.code}\n`); safe(events[index], f);
    assert.ok(f.raw.prepare("SELECT COUNT(*) AS n FROM usage_records WHERE attempt_id = ?").get(f.contexts[index].ref.attemptId).n > 0);
  }
  fs.writeFileSync(join(first.workspace.path, "NEW.md"), "first only");
  assert.equal(fs.readFileSync(join(second.workspace.path, "NEW.md"), "utf8"), `Created for ${second.task.code}\n`);
  assert.equal(fs.existsSync(join(f.project.root, "NEW.md")), false); f.stateUnchanged();
});
integration("real OpenCode revoked proxy credential maps to a model failure", async (t) => {
  const f = await fixture(t); const context = await f.context(); f.tokens.revoke(context.ref.attemptId);
  const events = await collect(await f.start(context)); assert.deepEqual(events.at(-1), { type: "failed", kind: "model", message: "model request failed (HTTP 401)" });
  assert.equal(f.calls.length, 0); safe(events, f); f.stateUnchanged();
});
integration("real OpenCode tool cannot reach host networking or protected files", async (t) => {
  const f = await fixture(t, { commandFor: ({ roots, project, contexts, port }) => {
    const targets = [join(roots.stateDir, "nested", "private-marker"), join(project.root, "base.txt"), join(contexts[1].workspace.path, "base.txt")];
    const code = `const fs=require('node:fs'),net=require('node:net');const hidden=${JSON.stringify(targets)}.map(p=>!fs.existsSync(p));
      const probe=(host,port)=>new Promise(done=>{const s=net.createConnection({host,port});const finish=x=>{s.destroy();done(x)};s.setTimeout(500,()=>finish(false));s.on('error',()=>finish(false));s.on('connect',()=>finish(true))});
      Promise.all([probe('127.0.0.1',${port}),probe('1.1.1.1',80)]).then(network=>fs.writeFileSync('isolation.json',JSON.stringify({hidden,network})))`;
    return `/opt/node/bin/node -e '${code.replaceAll("'", "'\\''")}'`;
  } });
  const context = await f.context(); await f.context(); const events = await collect(await f.start(context));
  assert.equal(events.at(-1).type, "completed");
  assert.deepEqual(JSON.parse(fs.readFileSync(join(context.workspace.path, "isolation.json"), "utf8")), { hidden: [true, true, true], network: [false, false] });
  safe(events, f); f.stateUnchanged();
});
