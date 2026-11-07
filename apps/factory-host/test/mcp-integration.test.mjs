import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startHost } from "../dist/host.js";
import { createOpenCodeRuntime } from "../dist/runtimes/index.js";
import { isSandboxAvailable } from "../dist/sandbox/index.js";
import { assertInside, cloneProject, runGit } from "../dist/workspace/index.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { tasksCreateHandler, getTask } from "../dist/work/service.js";
import { loadPack, findLeadSeat, getActiveEngagement } from "../dist/org/index.js";
import { moveTask } from "../dist/dispatch/index.js";
import { listTaskArtifacts } from "../dist/artifacts/service.js";

// Same prerequisites as opencode-integration; no emulation or substituted agent binary.
const opencodeDir = process.platform === "linux" ? process.env.FACTORY_OPENCODE_DIR ?? "/home/lazy/factory-v2/opencode" : "";
const available = process.platform === "linux" && fs.existsSync(join(opencodeDir, "bin", "opencode")) && await isSandboxAvailable();
const key = "synthetic-mcp-integration-private-value";
const bytes = "# Factory deliverable\nRegistered through the sandbox relay.\n";
function reply(res, body, delta, reason) {
  const usage = { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 };
  if (body.stream) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (choices, extra = {}) => ({ id: "chatcmpl-fixture", object: "chat.completion.chunk", created: 1, model: "approved", choices, ...extra });
    res.write(`data: ${JSON.stringify(chunk([{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }]))}\n\n`);
    res.write(`data: ${JSON.stringify(chunk([{ index: 0, delta: {}, finish_reason: reason }]))}\n\n`);
    res.end(`data: ${JSON.stringify(chunk([], { usage }))}\n\ndata: [DONE]\n\n`);
  } else {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "chatcmpl-fixture", object: "chat.completion", created: 1, model: "approved",
      choices: [{ index: 0, message: { role: "assistant", ...delta }, finish_reason: reason }], usage }));
  }
}

test("real sandbox agent reports progress registers exact deliverable and refuses escape", { timeout: 90000,
  skip: available ? false : "Requires Linux, working bubblewrap and the real OpenCode installation" }, async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-mcp-integration-")));
  let host; let server; const requests = []; const statuses = []; const failures = [];
  t.after(async () => {
    await host?.close();
    if (server?.listening) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
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
  const project = await cloneProject(roots, { name: "MCP integration", source });
  const socketDir = join(root, "proxy"); fs.mkdirSync(socketDir, { mode: 0o700 }); const socketPath = join(socketDir, "model.sock");
  const nodeDir = join(root, "node-prefix"); fs.mkdirSync(join(nodeDir, "bin"), { recursive: true });
  fs.copyFileSync(fs.realpathSync(process.execPath), join(nodeDir, "bin", "node")); fs.chmodSync(join(nodeDir, "bin", "node"), 0o755);
  // The fake model explicitly requests every tool. All executions still use real OpenCode and bubblewrap.
  server = createServer(async (req, res) => {
    let input = ""; for await (const chunk of req) input += chunk;
    const body = JSON.parse(input); requests.push({ headers: req.headers, body });
    if (!body.tools?.length) return reply(res, body, { content: "Fixture title" }, "stop");
    const availableNames = body.tools.map((tool) => tool.function.name);
    for (const name of ["write", "factory_task_progress", "factory_output_register"])
      if (!availableNames.includes(name)) { failures.push("Factory tools were unavailable"); return reply(res, body, { content: "Tools missing" }, "stop"); }
    const completed = (id) => body.messages.some((message) => message.role === "tool" && message.tool_call_id === id);
    const workspace = fs.readdirSync(roots.worktreesRoot, { recursive: true, withFileTypes: true })
      .find((entry) => entry.name === ".git" && entry.isFile());
    const directory = workspace ? workspace.parentPath ?? workspace.path : "";
    const steps = [
      { id: "fixture_write", name: "write", args: { filePath: join(directory, "DELIVERABLE.md"), content: bytes } },
      { id: "fixture_progress", name: "factory_task_progress", args: { summary: "Deliverable milestone", percent: 75 } },
      { id: "fixture_escape", name: "factory_output_register", args: { title: "Escape", kind: "other", mediaType: "text/plain", path: "../outside", abstractL0: "Refused file." } },
      { id: "fixture_register", name: "factory_output_register", args: { title: "Deliverable", kind: "research-report", mediaType: "text/markdown", path: "DELIVERABLE.md", abstractL0: "The completed deliverable." } },
    ];
    const step = steps.find((item) => !completed(item.id));
    if (!step) return reply(res, body, { content: "Done" }, "stop");
    reply(res, body, { content: null, tool_calls: [{ ...(body.stream ? { index: 0 } : {}), id: step.id, type: "function",
      function: { name: step.name, arguments: JSON.stringify(step.args) } }] }, "tool_calls");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const runtime = createOpenCodeRuntime({ roots, opencodeDir: fs.realpathSync(opencodeDir), nodeDir,
    relayFile: fs.realpathSync(fileURLToPath(new URL("../dist/sandbox/relay-main.js", import.meta.url))), timeoutMs: 60000, stallMs: 30000 });
  host = await startHost({ stateDir: roots.stateDir, port: 0, onBootstrapToken() {}, dispatch: {}, workspace: roots, runtimes: [runtime],
    modelProxy: { port: 0, socketPath, approvedModels: ["approved"], upstream: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: key } } });
  const pipeline = createCommandPipeline({ storage: host.storage, hub: host.hub, handlers: {
    "projects.create": createProjectsCreateHandler({ pack: loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url))) }), "tasks.create": tasksCreateHandler,
  } });
  const projectId = randomUUID(); const taskId = randomUUID();
  const execute = (type, payload) => assert.equal(pipeline.execute({ apiVersion: 1, commandId: randomUUID(), projectId, type, payload }).status, 200);
  execute("projects.create", { name: "MCP integration", workspace: { kind: "directory", root: project.root } });
  execute("tasks.create", { taskId, code: "MCP-001", title: "Deliver", goal: "Write and register DELIVERABLE.md", brief: "Fixture", parentTaskId: null,
    engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: ["Deliverable registered"], inputs: [], dependsOn: [] });
  for (const state of ["accepted", "ready", "active"]) moveTask(host.storage.raw, projectId, taskId, state);
  const seatId = findLeadSeat(host.storage.raw, getActiveEngagement(host.storage.raw, projectId).teamId).id;
  host.storage.raw.prepare("UPDATE seats SET runtime = 'native-opencode' WHERE id = ?").run(seatId);
  const unsubscribe = host.hub.subscribe(projectId, () => {
    const versions = listTaskArtifacts(host.storage.raw, projectId, taskId).find((item) => item.title === "Deliverable")?.versions ?? [];
    for (const version of versions) statuses.push(version.status);
  }); t.after(unsubscribe);
  const attempt = host.dispatch.enqueue({ projectId, taskId, seatId }); await host.dispatch.idle();
  assert.deepEqual(failures, []); assert.equal(getTask(host.storage.raw, projectId, taskId).state, "in-review");
  const artifact = listTaskArtifacts(host.storage.raw, projectId, taskId).find((item) => item.title === "Deliverable");
  assert.ok(artifact); assert.equal(artifact.versions[0].status, "in-review"); assert.equal(artifact.versions[0].producedByAttemptId, attempt.id);
  assert.deepEqual(host.artifacts.store.get(artifact.versions[0].contentHash), Buffer.from(bytes));
  assert.ok(statuses.includes("draft")); assert.ok(statuses.includes("in-review"));
  const progress = host.storage.raw.prepare("SELECT body_json FROM attempt_events WHERE attempt_id = ? AND kind = 'progress'").all(attempt.id).map((row) => JSON.parse(row.body_json));
  assert.ok(progress.some((event) => event.message === "Deliverable milestone" && event.percent === 75));
  const escaped = requests.flatMap((request) => request.body.messages).filter((message) => message.role === "tool" && message.tool_call_id === "fixture_escape");
  assert.ok(escaped.length); assert.match(JSON.stringify(escaped), /output could not be registered/);
  assert.equal(listTaskArtifacts(host.storage.raw, projectId, taskId).some((item) => item.title === "Escape"), false);
  const usage = host.storage.raw.prepare("SELECT * FROM usage_records WHERE attempt_id = ?").all(attempt.id);
  assert.equal(usage.length, requests.length); assert.ok(usage.length >= 5);
  for (const request of requests) {
    assert.equal(request.headers.authorization, `Bearer ${key}`); assert.doesNotMatch(JSON.stringify(request.body), /fpx_[A-Za-z0-9_-]+/);
  }
  const persisted = JSON.stringify([
    host.storage.raw.prepare("SELECT body_json FROM event_log").all(), host.storage.raw.prepare("SELECT body_json FROM attempt_events").all(),
    host.storage.raw.prepare("SELECT * FROM artifact_versions").all(),
  ]);
  assert.equal(persisted.includes(key), false); assert.doesNotMatch(persisted, /fpx_[A-Za-z0-9_-]+/);
  assert.equal(persisted.includes(roots.stateDir), false); assert.equal(persisted.includes(dirname(socketPath)), false);
});
