import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { moveTask, listAttempts, getAttempt } from "../dist/dispatch/index.js";
import { createApprovalsDecideHandler, listApprovals, getApprovalView } from "../dist/approvals/service.js";
import { listTaskArtifacts } from "../dist/artifacts/service.js";

// Match the real MCP integration prerequisites; Windows never probes the Linux installation.
const opencodeDir = process.platform === "linux" ? process.env.FACTORY_OPENCODE_DIR ?? "/home/lazy/factory-v2/opencode" : "";
const available = process.platform === "linux" && fs.existsSync(join(opencodeDir, "bin", "opencode")) && await isSandboxAvailable();
const key = "synthetic-decision-integration-value";
const bytes = "# Partial work\nSaved before asking the business question.\n";
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
async function until(predicate) {
  for (let i = 0; i < 600; i++) { if (predicate()) return; await new Promise((done) => setTimeout(done, 50)); }
  assert.fail("Expected real agent lifecycle state was not reached");
}
function markedProcesses(marker) {
  return fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name)).filter((name) => {
    try { return fs.readFileSync(`/proc/${name}/cmdline`, "utf8").includes(marker); } catch { return false; }
  });
}

test("real sandbox business question parks all processes keeps draft work and resumes with the answer", { timeout: 90000,
  skip: available ? false : "Requires Linux, working bubblewrap and the real OpenCode installation" }, async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-mcp-decision-")));
  const marker = `factory-decision-${randomUUID()}`; let host; let server; const requests = []; const failures = []; const resumed = [];
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
  const project = await cloneProject(roots, { name: "Decision integration", source });
  const socketDir = join(root, "proxy"); fs.mkdirSync(socketDir, { mode: 0o700 }); const socketPath = join(socketDir, "model.sock");
  const nodeDir = join(root, "node-prefix"); fs.mkdirSync(join(nodeDir, "bin"), { recursive: true });
  fs.copyFileSync(fs.realpathSync(process.execPath), join(nodeDir, "bin", "node")); fs.chmodSync(join(nodeDir, "bin", "node"), 0o755);
  server = createServer(async (req, res) => {
    let input = ""; for await (const chunk of req) input += chunk;
    const body = JSON.parse(input); requests.push({ headers: req.headers, body });
    if (!body.tools?.length) return reply(res, body, { content: "Fixture title" }, "stop");
    if (body.messages.some((m) => typeof m.content === "string" && m.content.includes("Decision from the operator:"))) {
      resumed.push(body); return reply(res, body, { content: "Continued using the operator decision." }, "stop");
    }
    for (const name of ["write", "bash", "factory_decision_request"]) if (!body.tools.some((tool) => tool.function.name === name)) {
      failures.push("Required tool unavailable"); return reply(res, body, { content: "Tools unavailable" }, "stop");
    }
    const completed = (id) => body.messages.some((message) => message.role === "tool" && message.tool_call_id === id);
    const metadata = fs.readdirSync(roots.worktreesRoot, { recursive: true, withFileTypes: true }).find((entry) => entry.name === ".git" && entry.isFile());
    const directory = metadata ? metadata.parentPath ?? metadata.path : "";
    const steps = [
      { id: "fixture_partial", name: "write", args: { filePath: join(directory, "PARTIAL.md"), content: bytes } },
      { id: "fixture_child", name: "bash", args: { command: `bash -c 'exec -a ${marker} sleep 600' >/dev/null 2>&1 &`, description: "Start fixture worker" } },
      { id: "fixture_decision", name: "factory_decision_request", args: { subject: "Choose delivery scope", summary: "Which scope should be delivered?",
        options: [{ id: "small", label: "Essential scope", consequence: "Deliver essentials." }, { id: "full", label: "Complete scope", consequence: "Deliver everything." }],
        recommendation: "small", impactIfWaiting: "Work waits for your answer." } },
    ];
    const step = steps.find((candidate) => !completed(candidate.id));
    // A post-question model call remains pending until the parked execution's proxy grant is revoked.
    if (!step) return;
    reply(res, body, { content: null, tool_calls: [{ ...(body.stream ? { index: 0 } : {}), id: step.id, type: "function",
      function: { name: step.name, arguments: JSON.stringify(step.args) } }] }, "tool_calls");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const runtime = createOpenCodeRuntime({ roots, opencodeDir: fs.realpathSync(opencodeDir), nodeDir,
    relayFile: fs.realpathSync(fileURLToPath(new URL("../dist/sandbox/relay-main.js", import.meta.url))), timeoutMs: 60000, stallMs: 30000 });
  host = await startHost({ stateDir: roots.stateDir, port: 0, onBootstrapToken() {}, dispatch: {}, workspace: roots, runtimes: [runtime],
    modelProxy: { port: 0, socketPath, approvedModels: ["approved"], upstream: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: key } } });
  const pipeline = createCommandPipeline({ storage: host.storage, hub: host.hub, handlers: {
    "projects.create": createProjectsCreateHandler({ pack: loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url))) }),
    "tasks.create": tasksCreateHandler, "approvals.decide": createApprovalsDecideHandler({ dispatcher: host.dispatch }),
  } });
  const projectId = randomUUID(); const taskId = randomUUID(); const actorId = randomUUID();
  const execute = (type, payload, commandId = randomUUID()) => {
    const result = pipeline.execute({ apiVersion: 1, commandId, projectId, type, payload }, actorId); assert.equal(result.status, 200, JSON.stringify(result.body)); return result;
  };
  execute("projects.create", { name: "Decision integration", workspace: { kind: "directory", root: project.root } });
  execute("tasks.create", { taskId, code: "DEC-001", title: "Deliver", goal: `Prepare work then ask about scope. Fixture marker ${marker}`, brief: "Fixture", parentTaskId: null,
    engagementId: null, ownerSeatId: null, requiredCapabilities: [], acceptance: ["Answer is used"], inputs: [], dependsOn: [] });
  for (const state of ["accepted", "ready", "active"]) moveTask(host.storage.raw, projectId, taskId, state);
  const seatId = findLeadSeat(host.storage.raw, getActiveEngagement(host.storage.raw, projectId).teamId).id;
  host.storage.raw.prepare("UPDATE seats SET runtime='native-opencode' WHERE id=?").run(seatId);
  const a = host.dispatch.enqueue({ projectId, taskId, seatId });
  await until(() => getAttempt(host.storage.raw, projectId, a.id)?.state === "parked"); await host.dispatch.idle();
  assert.deepEqual(markedProcesses(marker), []); assert.deepEqual(failures, []);
  const approval = listApprovals(host.storage.raw, projectId, { states: ["pending"] })[0]; assert.equal(approval.kind, "question");
  assert.deepEqual(approval.options.map((o) => o.id), ["small", "full"]); assert.equal(getTask(host.storage.raw, projectId, taskId).state, "active");
  assert.equal(getTask(host.storage.raw, projectId, taskId).holds[0].ref.id, approval.id); assert.equal(host.dispatch.status().nodeUsed, 0);
  const patch = listTaskArtifacts(host.storage.raw, projectId, taskId).find((artifact) => artifact.kind === "code-ref"); assert.ok(patch);
  assert.equal(patch.versions[0].status, "draft"); assert.match(host.artifacts.store.get(patch.versions[0].contentHash).toString(), /Saved before asking/);
  assert.equal(listTaskArtifacts(host.storage.raw, projectId, taskId).some((artifact) => artifact.title.startsWith("Summary ")), false);
  const commandId = randomUUID(); execute("approvals.decide", { approvalId: approval.id, expectedRevision: approval.revision,
    contextDigest: approval.context.digest, optionId: "full", comment: "Include the complete feature set." }, commandId);
  await until(() => resumed.length > 0); await host.dispatch.idle();
  assert.equal(listAttempts(host.storage.raw, projectId, taskId).length, 2); const next = listAttempts(host.storage.raw, projectId, taskId)[1];
  assert.equal(next.epoch, 2); assert.equal(next.seatId, seatId); assert.equal(getApprovalView(host.storage.raw, projectId, approval.id).appliedByCommandId, commandId);
  const body = JSON.stringify(resumed[0]); assert.match(body, /Question: Choose delivery scope/); assert.match(body, /Answer: Complete scope/); assert.match(body, /Include the complete feature set/);
  const continuation = fs.readdirSync(roots.worktreesRoot, { recursive: true, withFileTypes: true }).filter((entry) => entry.name === "PARTIAL.md" && entry.isFile());
  assert.equal(continuation.length, 2);
  for (const req of requests) { assert.equal(req.headers.authorization, `Bearer ${key}`); assert.equal(JSON.stringify(req.body).includes(key), false); assert.doesNotMatch(JSON.stringify(req.body), /fpx_[A-Za-z0-9_-]+/); }
  const publicText = JSON.stringify([listApprovals(host.storage.raw, projectId), host.storage.raw.prepare("SELECT body_json FROM event_log").all(),
    host.storage.raw.prepare("SELECT body_json FROM attempt_events").all(), host.storage.raw.prepare("SELECT * FROM artifact_versions").all()]);
  assert.equal(publicText.includes(key), false); assert.doesNotMatch(publicText, /fpx_[A-Za-z0-9_-]+/); assert.equal(publicText.includes(root), false);
});
