import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test as nodeTest } from "node:test";
import { createOpenCodeRuntime } from "../dist/runtimes/index.js";
import { SANDBOX_RELAY_PORT } from "../dist/sandbox/index.js";

const test = (name, fn) => nodeTest(name, { timeout: 5000 }, fn);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const gate = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const collect = async (session) => { const events = []; for await (const event of session.events()) events.push(event); return events; };
const text = (value) => ({ type: "text", sessionID: "session", part: { type: "text", text: value, time: { start: 1, end: 2 } } });
const tool = (status, input = {}, name = "write") => ({ type: "tool_use", sessionID: "session", part: {
  type: "tool", tool: name, callID: "call", state: { status, input, output: "untrusted output", title: "untrusted title", metadata: {}, time: { start: 1, end: 2 } },
} });
function fixture(t, overrides = {}, behavior = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-opencode-unit-")));
  const roots = { projectsRoot: join(root, "projects"), worktreesRoot: join(root, "worktrees"), stateDir: join(root, "state") };
  const workspace = join(roots.worktreesRoot, "attempt");
  const common = join(roots.projectsRoot, "project", ".git");
  const metadata = join(common, "worktrees", "attempt");
  for (const dir of [workspace, metadata, roots.stateDir]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(workspace, ".git"), `gitdir: ${metadata}\n`);
  const controller = new AbortController();
  const context = { ref: { projectId: "project", attemptId: "attempt", epoch: 1, leaseId: "lease" },
    task: { code: "DEV-001", title: "Deliver a change", goal: "Create the requested file", acceptance: ["File exists", "Tests pass"] },
    seat: { id: "seat", name: "Developer", role: "Implement and verify" }, handoff: "Previous attempt notes", signal: controller.signal,
    workspace: { path: workspace, branch: "factory/dev-001-e1", baseSha: "base" },
    model: { baseUrl: "http://unreachable.invalid/v1", token: "synthetic-private-agent-value", models: ["approved", "provider/other"], socketPath: join(root, "proxy", "model.sock") } };
  const result = gate(); const launched = []; const stops = [];
  let completed = false;
  function end(patch = {}) {
    completed = true;
    result.resolve({ exitCode: 0, signal: null, timedOut: false, stopped: false, stdout: "", stderr: "", truncated: false,
      durationMs: 1, groupGone: true, ...patch });
  }
  const launcher = (options) => {
    launched.push(options);
    if (behavior.throwLaunch) throw new Error(context.model.token + workspace);
    return { pid: 123, result: result.promise, async stop(reason) {
      stops.push(reason);
      if (behavior.rejectStop) throw new Error(context.model.token + workspace);
      if (behavior.stopGate) await behavior.stopGate.promise;
      if (!behavior.manualEnd) end({ stopped: true, exitCode: null, groupGone: !behavior.survives });
    } };
  };
  const options = { roots, opencodeDir: join(root, "opencode"), nodeDir: join(root, "node"), relayFile: join(root, "relay.js"),
    launcher, timeoutMs: 2000, stallMs: 1000, ...overrides };
  const sessions = [];
  t.after(async () => {
    end();
    for (const session of sessions) await session.stop().catch(() => {});
    assert.ok(resolve(root).startsWith(fs.realpathSync(tmpdir()) + sep + "factory-opencode-unit-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const runtime = createOpenCodeRuntime(options);
  const start = async (patch = {}) => { const session = await runtime.start({ ...context, ...patch }); sessions.push(session); return session; };
  const output = (chunk, stream = "stdout") => launched[0]?.onOutput(stream, chunk);
  const emit = (event) => output(JSON.stringify(event) + "\n");
  const run = async (events = [], patch = {}) => { const session = await start(); events.forEach(emit); end(patch); return collect(session); };
  return { root, roots, workspace, common, metadata, context, options, runtime, controller, launched, stops, start, output, emit, end, run, completed: () => completed };
}
const terminal = (events) => events.at(-1);
function safe(events, f) {
  const encoded = JSON.stringify(events);
  for (const secret of [f.context.model.token, f.workspace, ...Object.values(f.roots), "fpx_some_other_private_value", "sk-synthetic-private-value"])
    assert.equal(encoded.includes(secret), false, "output must be scrubbed");
}

test("adapter registers the contract runtime kind", (t) => { assert.equal(fixture(t).runtime.kind, "native-opencode"); });
test("sandbox spec contains only the required mounts and socket capability", async (t) => {
  const f = fixture(t); await f.run(); const { spec, timeoutMs, maxOutputBytes } = f.launched[0];
  assert.deepEqual(spec, { bwrapPath: "/usr/bin/bwrap", workspace: f.workspace, roots: f.roots,
    readOnlyBinds: [{ host: f.options.nodeDir, guest: "/opt/node" }, { host: f.options.opencodeDir, guest: "/opt/opencode" },
      { host: f.options.relayFile, guest: "/opt/factory/relay.js" }],
    gitDirs: { common: f.common, worktree: f.metadata }, socket: { host: f.context.model.socketPath, guest: "/opt/factory/model.sock" },
    env: spec.env, command: "/opt/opencode/bin/opencode", args: spec.args });
  assert.equal(timeoutMs, 2000); assert.equal(maxOutputBytes, 4 * 1024 * 1024);
  assert.deepEqual(spec.args.slice(0, -1), ["run", "--pure", "--format", "json", "-m", "factory/approved", "--dir", f.workspace]);
});
test("configuration uses the relay and only approved provider models", async (t) => {
  const f = fixture(t); await f.run(); const config = JSON.parse(f.launched[0].spec.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(config, { $schema: "https://opencode.ai/config.json", autoupdate: false, share: "disabled",
    model: "factory/approved", small_model: "factory/approved", enabled_providers: ["factory"],
    mcp: { factory: { type: "remote", url: `http://127.0.0.1:${SANDBOX_RELAY_PORT}/mcp`, enabled: true,
      headers: { Authorization: `Bearer ${f.context.model.token}` } } },
    provider: { factory: { npm: "@ai-sdk/openai-compatible", name: "Factory",
      options: { baseURL: `http://127.0.0.1:${SANDBOX_RELAY_PORT}/v1`, apiKey: f.context.model.token },
      models: Object.fromEntries(f.context.model.models.map((name) => [name, { name, tool_call: true, limit: { context: 128000, output: 8192 } }])) } },
    permission: { edit: "allow", bash: "allow", webfetch: "deny", external_directory: "deny" } });
});
test("MCP uses the model credential and the prompt names both Factory tools", async (t) => {
  const f = fixture(t); await f.run(); const spec = f.launched[0].spec;
  const config = JSON.parse(spec.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.mcp.factory.headers.Authorization, `Bearer ${config.provider.factory.options.apiKey}`);
  assert.equal(spec.env.OPENCODE_CONFIG_CONTENT.split(f.context.model.token).length - 1, 2);
  for (const name of ["factory_task_progress", "factory_output_register", "Never include secrets"]) assert.ok(spec.args.at(-1).includes(name));
});
for (const name of ["factory_task_progress", "factory_output_register", "factory_decision_request"]) for (const status of ["running", "completed", "error"])
  test(`Factory tool ${name} reports ${status} without inputs`, async (t) => {
    const f = fixture(t); const events = await f.run([tool(status, { command: "private-input", filePath: f.workspace, summary: f.context.model.token }, name)]);
    assert.deepEqual(events[0], { type: "progress", message: `tool: ${name}` }); safe(events, f);
    assert.equal(JSON.stringify(events).includes("private-input"), false);
  });
test("prompt instructs the agent to stop immediately after asking a business question", async (t) => {
  const f = fixture(t); await f.run();
  assert.ok(f.launched[0].spec.args.at(-1).includes("If a business decision blocks you and you cannot make it yourself, call factory_decision_request with the question and 2-6 options, then stop immediately without further tool calls. The operator will answer and a new session will continue your work."));
});
test("agent credential occurs only in the configuration env value", async (t) => {
  const f = fixture(t); await f.run(); const spec = structuredClone(f.launched[0].spec);
  assert.deepEqual(Object.keys(spec.env).sort(), ["OPENCODE_CONFIG_CONTENT", "OPENCODE_DISABLE_AUTOUPDATE", "OPENCODE_DISABLE_MODELS_FETCH"]);
  assert.equal(spec.env.OPENCODE_DISABLE_AUTOUPDATE, "true"); assert.equal(spec.env.OPENCODE_DISABLE_MODELS_FETCH, "true");
  delete spec.env.OPENCODE_CONFIG_CONTENT; assert.equal(JSON.stringify(spec).includes(f.context.model.token), false);
});
test("handoff cannot copy the credential into process arguments", async (t) => {
  const f = fixture(t); const session = await f.start({ handoff: `Previous output ${f.context.model.token}` }); f.end(); await collect(session);
  assert.equal(JSON.stringify(f.launched[0].spec.args).includes(f.context.model.token), false);
});
test("optional variant is passed as a separate argument", async (t) => {
  const f = fixture(t, { variant: "high" }); await f.run(); assert.deepEqual(f.launched[0].spec.args.slice(-3, -1), ["--variant", "high"]);
});
test("node prefix and compiled relay have module-relative defaults", async (t) => {
  const f = fixture(t, { nodeDir: undefined, relayFile: undefined }); await f.run(); const binds = f.launched[0].spec.readOnlyBinds;
  assert.equal(binds[0].host, dirname(dirname(process.execPath)));
  assert.equal(binds[2].host, fileURLToPath(new URL("../dist/sandbox/relay-main.js", import.meta.url)));
});
test("custom bubblewrap path is passed to the sandbox launcher", async (t) => {
  const f = fixture(t, { bwrapPath: "/custom/bwrap" }); await f.run(); assert.equal(f.launched[0].spec.bwrapPath, "/custom/bwrap");
});
test("prompt includes task details role handoff and all execution rules", async (t) => {
  const f = fixture(t); await f.run(); const prompt = f.launched[0].spec.args.at(-1);
  for (const content of [f.context.task.code, f.context.task.title, f.context.task.goal, ...f.context.task.acceptance,
    f.context.seat.role, f.context.handoff, "Work only inside the current directory", "Do not commit or push or change git config",
    "Do not touch files outside the task scope", "project's own tests", "summary of what changed and what was verified"])
    assert.ok(prompt.includes(content));
});
test("absent handoff adds no handoff section", async (t) => {
  const f = fixture(t); const session = await f.start({ handoff: null }); f.end(); await collect(session);
  assert.equal(f.launched[0].spec.args.at(-1).includes("Handoff:"), false);
});
test("long multi-byte handoff truncates on a UTF-8 boundary", async (t) => {
  const f = fixture(t, { maxPromptBytes: 2048 }); const session = await f.start({ handoff: "🧩漢é".repeat(1000) }); f.end(); await collect(session);
  const prompt = f.launched[0].spec.args.at(-1);
  assert.ok(Buffer.byteLength(prompt) <= 2048); assert.ok(Buffer.byteLength(prompt) > 2043); assert.equal(prompt.includes("�"), false);
  assert.ok(prompt.includes("Finish with a short summary"));
});
test("default prompt budget is ninety-six KiB", async (t) => {
  const f = fixture(t); const session = await f.start({ handoff: "x".repeat(200000) }); f.end(); await collect(session);
  assert.equal(Buffer.byteLength(f.launched[0].spec.args.at(-1)), 96 * 1024);
});
test("oversized mandatory prompt fails generically without launching", async (t) => {
  const f = fixture(t, { maxPromptBytes: 20 }); await assert.rejects(f.start(), { message: "Runtime configuration invalid" }); assert.equal(f.launched.length, 0);
});
for (const [label, make] of [
  ["missing workspace", () => ({ workspace: undefined })], ["missing model", () => ({ model: undefined })],
  ["missing socket", (f) => ({ model: { ...f.context.model, socketPath: undefined } })],
  ["empty socket", (f) => ({ model: { ...f.context.model, socketPath: "" } })],
  ["empty credential", (f) => ({ model: { ...f.context.model, token: "" } })],
  ["empty models", (f) => ({ model: { ...f.context.model, models: [] } })],
  ["duplicate models", (f) => ({ model: { ...f.context.model, models: ["approved", "approved"] } })],
  ["invalid model", (f) => ({ model: { ...f.context.model, models: ["bad model"] } })],
]) test(`configuration rejects ${label} with one generic message`, async (t) => {
  const f = fixture(t); await assert.rejects(f.start(make(f)), (error) => { assert.equal(error.message, "Runtime configuration invalid"); safe(error.message, f); return true; });
  assert.equal(f.launched.length, 0);
});
for (const [label, contents] of [
  ["missing prefix", (f) => f.metadata], ["empty target", () => "gitdir: \n"], ["relative target", () => "gitdir: ../project/.git/worktrees/a\n"],
  ["extra line", (f) => `gitdir: ${f.metadata}\nextra\n`], ["zero byte", (f) => `gitdir: ${f.metadata}\0`],
  ["wrong case", (f) => `Gitdir: ${f.metadata}\n`], ["foreign target", (f) => `gitdir: ${join(f.root, "foreign", ".git", "worktrees", "a")}\n`],
  ["common directory", (f) => `gitdir: ${f.common}\n`], ["wrong metadata shape", (f) => `gitdir: ${join(f.roots.projectsRoot, "other", "worktrees", "a")}\n`],
  ["oversized metadata", () => "x".repeat(16385)],
]) test(`git metadata rejects ${label}`, async (t) => {
  const f = fixture(t); fs.writeFileSync(join(f.workspace, ".git"), contents(f));
  await assert.rejects(f.start(), { message: "Runtime configuration invalid" }); assert.equal(f.launched.length, 0);
});
test("git metadata rejects an ordinary repository directory", async (t) => {
  const f = fixture(t); fs.unlinkSync(join(f.workspace, ".git")); fs.mkdirSync(join(f.workspace, ".git"));
  await assert.rejects(f.start(), { message: "Runtime configuration invalid" });
});
test("git metadata rejects a missing target", async (t) => {
  const f = fixture(t); fs.rmdirSync(f.metadata); await assert.rejects(f.start(), { message: "Runtime configuration invalid" });
});
test("worktree must be inside its configured root", async (t) => {
  const f = fixture(t); await assert.rejects(f.start({ workspace: { ...f.context.workspace, path: f.root } }), { message: "Runtime configuration invalid" });
});
test("metadata accepts CRLF with exactly one record", async (t) => {
  const f = fixture(t); fs.writeFileSync(join(f.workspace, ".git"), `gitdir: ${f.metadata}\r\n`); assert.equal(terminal(await f.run()).type, "completed");
});
test("real step start event maps to working progress", async (t) => {
  const f = fixture(t); assert.deepEqual(await f.run([{ type: "step_start", sessionID: "s", part: { type: "step-start" } }]),
    [{ type: "progress", message: "Working" }, { type: "completed", summary: "Work finished" }]);
});
test("real text event maps to progress and completion summary", async (t) => {
  const f = fixture(t); assert.deepEqual(await f.run([text("Done")]), [{ type: "progress", message: "Done" }, { type: "completed", summary: "Done" }]);
});
test("text progress is a single line and limited to two hundred characters", async (t) => {
  const events = await fixture(t).run([text("hello\r\nworld\t" + "a".repeat(300))]); assert.equal(events[0].message.length, 200); assert.doesNotMatch(events[0].message, /[\r\n\t]/);
});
test("completion remembers the last text and trims it to two thousand characters", async (t) => {
  const events = await fixture(t).run([text("Earlier"), text("  " + "a".repeat(2500) + "  ")]); assert.equal(terminal(events).summary, "a".repeat(2000));
});
test("completed write tool shows a workspace-relative file", async (t) => {
  const f = fixture(t); const events = await f.run([tool("completed", { filePath: join(f.workspace, "src", "NEW.md"), content: f.context.model.token })]);
  assert.equal(events[0].message, "tool: write src/NEW.md"); safe(events, f);
});
test("relative tool file remains relative", async (t) => {
  const events = await fixture(t).run([tool("completed", { filePath: "NEW.md" })]); assert.equal(events[0].message, "tool: write NEW.md");
});
test("foreign tool file never exposes an absolute path", async (t) => {
  const f = fixture(t); const events = await f.run([tool("completed", { filePath: join(f.roots.stateDir, "private") })]);
  assert.equal(events[0].message, "tool: write <outside workspace>"); safe(events, f);
});
test("completed bash tool displays at most eighty command characters", async (t) => {
  const events = await fixture(t).run([tool("completed", { command: "a".repeat(100) }, "bash")]); assert.equal(events[0].message, `tool: bash ${"a".repeat(80)}`);
});
test("failed tool never forwards raw output or input", async (t) => {
  const f = fixture(t); const events = await f.run([tool("error", { command: f.context.model.token }, "bash")]);
  assert.equal(events[0].message, "tool failed: bash"); safe(events, f);
});
test("pending tool events produce no progress", async (t) => {
  const events = await fixture(t).run([tool("running"), tool("pending")]); assert.equal(events.length, 1);
});
test("completed tool without input shows its name", async (t) => {
  const events = await fixture(t).run([tool("completed")]); assert.equal(events[0].message, "tool: write");
});
test("step finish usage events do not duplicate proxy usage", async (t) => {
  const events = await fixture(t).run([{ type: "step_finish", sessionID: "s", part: { reason: "stop",
    tokens: { total: 26, input: 20, output: 6, reasoning: 0, cache: { write: 0, read: 0 } }, cost: 0 } }]);
  assert.deepEqual(events, [{ type: "completed", summary: "Work finished" }]);
});
for (const status of [401, 403, 429, 500]) test(`model API status ${status} is mapped without response details`, async (t) => {
  const f = fixture(t); const events = await f.run([{ type: "error", sessionID: "s", error: { name: "APIError", data: {
    message: f.context.model.token, statusCode: status, isRetryable: false, responseHeaders: { private: f.workspace }, responseBody: "private raw body" } } }], { exitCode: 1 });
  assert.deepEqual(events, [{ type: "failed", kind: "model", message: `model request failed (HTTP ${status})` }]); safe(events, f);
});
for (const [label, error, expected] of [
  ["unknown name", { name: "UnknownError", data: { message: "private" } }, "runtime"],
  ["missing error", undefined, "runtime"], ["API missing data", { name: "APIError" }, "model"],
  ["API invalid status", { name: "APIError", data: { statusCode: "401 private" } }, "model"],
]) test(`error mapping handles ${label}`, async (t) => {
  const events = await fixture(t).run([{ type: "error", error }]);
  assert.deepEqual(events, [{ type: "failed", kind: expected, message: expected === "model" ? "model request failed" : "agent error" }]);
});
for (const code of [1, 2, 137, null]) test(`exit result ${code ?? "signal"} fails generically`, async (t) => {
  assert.deepEqual(terminal(await fixture(t).run([], { exitCode: code })), { type: "failed", kind: "runtime", message: `agent exited with code ${code ?? 1}` });
});
test("success without text uses the fixed summary", async (t) => { assert.deepEqual(terminal(await fixture(t).run()), { type: "completed", summary: "Work finished" }); });
test("process launcher timeout result maps to timeout", async (t) => {
  assert.deepEqual(terminal(await fixture(t).run([], { timedOut: true, exitCode: null })), { type: "failed", kind: "timeout", message: "agent timed out" });
});
test("error event takes precedence over a successful exit", async (t) => {
  const events = await fixture(t).run([{ type: "error", error: { name: "Unknown" } }]); assert.equal(terminal(events).type, "failed");
});
test("non JSON noise and invalid event shapes are ignored", async (t) => {
  const f = fixture(t); const session = await f.start(); f.output("banner\n{broken\nnull\n[]\n42\n{}\n");
  f.emit({ type: "text", part: { text: 1 } }); f.emit({ type: "future" }); f.end(); assert.equal((await collect(session)).length, 1);
});
test("JSON lines split across chunks are reconstructed", async (t) => {
  const f = fixture(t); const session = await f.start(); const line = JSON.stringify(text("Done")); f.output(line.slice(0, 25)); f.output(line.slice(25) + "\n"); f.end();
  assert.equal(terminal(await collect(session)).summary, "Done");
});
test("final unterminated line is parsed", async (t) => {
  const f = fixture(t); const session = await f.start(); f.output(JSON.stringify(text("Done"))); f.end(); assert.equal(terminal(await collect(session)).summary, "Done");
});
test("one MiB line buffer discards overflow and recovers at newline", async (t) => {
  const f = fixture(t); const session = await f.start(); f.output(JSON.stringify(text("x".repeat(1048576))) + "\n"); f.emit(text("Recovered")); f.end();
  assert.deepEqual(await collect(session), [{ type: "progress", message: "Recovered" }, { type: "completed", summary: "Recovered" }]);
});
test("line buffer byte limit also handles multi-byte input", async (t) => {
  const f = fixture(t); const session = await f.start(); f.output(JSON.stringify(text("漢".repeat(350000))) + "\n"); f.end();
  assert.deepEqual(await collect(session), [{ type: "completed", summary: "Work finished" }]);
});
test("custom output cap is enforced even with an injected launcher", async (t) => {
  const f = fixture(t, { maxOutputBytes: 128 }); const session = await f.start(); f.output("x".repeat(129) + "\n"); f.emit(text("Must be ignored")); f.end();
  assert.equal(f.launched[0].maxOutputBytes, 128); assert.equal((await collect(session)).length, 1);
});
test("stderr is never parsed or emitted", async (t) => {
  const f = fixture(t); const session = await f.start(); f.output(JSON.stringify(text(f.context.model.token)) + "\n", "stderr"); f.end();
  assert.deepEqual(await collect(session), [{ type: "completed", summary: "Work finished" }]);
});
test("total deadline bounds a run even while events arrive", async (t) => {
  const f = fixture(t, { timeoutMs: 70, stallMs: 500 }); const session = await f.start();
  const timer = setInterval(() => f.emit({ type: "step_start" }), 10);
  try { assert.deepEqual(terminal(await collect(session)), { type: "failed", kind: "timeout", message: "agent timed out" }); }
  finally { clearInterval(timer); }
  assert.deepEqual(f.stops, ["operator"]);
});
test("stall deadline bounds a silent retry loop", async (t) => {
  const f = fixture(t, { timeoutMs: 1000, stallMs: 25 }); const session = await f.start(); const events = await collect(session);
  assert.deepEqual(events, [{ type: "failed", kind: "timeout", message: "agent timed out" }]); assert.deepEqual(f.stops, ["operator"]);
});
test("each parsed event restarts the stall deadline", async (t) => {
  const f = fixture(t, { stallMs: 100 }); const session = await f.start();
  for (let i = 0; i < 3; i++) { await delay(40); f.emit({ type: "step_finish" }); }
  f.end(); assert.equal(terminal(await collect(session)).type, "completed"); assert.equal(f.stops.length, 0);
});
test("non JSON stdout does not refresh the stall deadline", async (t) => {
  const f = fixture(t, { stallMs: 40 }); const session = await f.start(); const timer = setInterval(() => f.output("noise\n"), 5);
  try { assert.equal(terminal(await collect(session)).kind, "timeout"); } finally { clearInterval(timer); }
});
test("timeout terminal event waits for process termination", async (t) => {
  const stopGate = gate(); const f = fixture(t, { stallMs: 20 }, { stopGate }); const session = await f.start(); let settled = false;
  const pending = collect(session).then((events) => { settled = true; return events; });
  await delay(50); assert.equal(settled, false); assert.equal(f.stops.length, 1); stopGate.resolve(); assert.equal(terminal(await pending).kind, "timeout");
});
test("all event text is scrubbed before truncation", async (t) => {
  const f = fixture(t); const privateText = [f.context.model.token, "fpx_some_other_private_value", "sk-synthetic-private-value", f.workspace, ...Object.values(f.roots)].join("\n");
  const events = await f.run([text(privateText), tool("completed", { command: privateText }, "bash"), tool("error", {}, privateText)]);
  safe(events, f); assert.ok(events[0].message.includes("<workspace>"));
});
test("long secret is scrubbed before progress shortening", async (t) => {
  const f = fixture(t); f.context.model.token = "private".repeat(50); const events = await f.run([text("x".repeat(190) + f.context.model.token)]);
  assert.equal(events[0].message.includes("private"), false); safe(events, f);
});
test("arbitrary absolute paths in agent text are removed", async (t) => {
  const events = await fixture(t).run([text("See /private/unrelated/file and C:\\private\\unrelated\\file")]);
  assert.equal(JSON.stringify(events).includes("unrelated"), false);
});
test("launch failure does not reveal the underlying error", async (t) => {
  const f = fixture(t, {}, { throwLaunch: true }); await assert.rejects(f.start(), (error) => { assert.equal(error.message, "Runtime launch failed"); safe(error.message, f); return true; });
});
test("stop is idempotent and uses the operator reason", async (t) => {
  const f = fixture(t); const session = await f.start(); const first = session.stop(); assert.equal(session.stop(), first); await first;
  assert.deepEqual(f.stops, ["operator"]); assert.deepEqual(await collect(session), []);
});
test("stop waits for both the stop handle and its execution result", async (t) => {
  const stopGate = gate(); const f = fixture(t, {}, { stopGate, manualEnd: true }); const session = await f.start(); let settled = false;
  const pending = session.stop().then(() => { settled = true; }); await delay(10); assert.equal(settled, false);
  stopGate.resolve(); await delay(10); assert.equal(settled, false); f.end(); await pending; assert.equal(settled, true);
});
test("stop discards queued events and ignores all later output", async (t) => {
  const f = fixture(t); const session = await f.start(); f.emit(text("Queued")); await session.stop(); f.emit(text("Too late")); f.emit({ type: "error" });
  assert.deepEqual(await collect(session), []);
});
test("pending iterator ends after stop verifies termination", async (t) => {
  const stopGate = gate(); const f = fixture(t, {}, { stopGate }); const session = await f.start(); let ended = false;
  const pending = session.events()[Symbol.asyncIterator]().next().then((event) => { ended = true; return event; });
  const stopping = session.stop(); await delay(10); assert.equal(ended, false); stopGate.resolve(); await stopping; assert.equal((await pending).done, true);
});
test("pre-aborted context is safe and never launches", async (t) => {
  const f = fixture(t); f.controller.abort(); const session = await f.start(); await session.stop(); assert.equal(f.launched.length, 0); assert.deepEqual(await collect(session), []);
});
test("immediate stop after start is safe", async (t) => {
  const f = fixture(t); const session = await f.start(); await session.stop(); assert.equal(f.completed(), true);
});
test("abort signal stops the sandbox and suppresses completion", async (t) => {
  const f = fixture(t); const session = await f.start(); f.controller.abort(); await session.stop(); assert.deepEqual(f.stops, ["operator"]); assert.deepEqual(await collect(session), []);
});
test("surviving process group makes stop reject generically", async (t) => {
  const f = fixture(t, {}, { survives: true }); const session = await f.start(); await assert.rejects(session.stop(), { message: "Runtime stop failed" });
  await assert.rejects(collect(session), { message: "Runtime stop failed" });
});
test("underlying stop rejection is scrubbed", async (t) => {
  const f = fixture(t, {}, { rejectStop: true }); const session = await f.start();
  await assert.rejects(session.stop(), (error) => { safe(error.message, f); assert.equal(error.message, "Runtime stop failed"); return true; });
});
test("natural result with surviving group never emits completion", async (t) => {
  const f = fixture(t); const session = await f.start(); f.end({ groupGone: false }); await assert.rejects(collect(session), { message: "Runtime stop failed" });
});
test("iterator return stops the execution", async (t) => {
  const f = fixture(t); const session = await f.start(); await session.events()[Symbol.asyncIterator]().return(); assert.deepEqual(f.stops, ["operator"]);
});
for (const [label, options] of [["zero total", { timeoutMs: 0 }], ["negative stall", { stallMs: -1 }], ["nonfinite deadline", { timeoutMs: Infinity }],
  ["fractional output", { maxOutputBytes: 1.5 }], ["oversized prompt", { maxPromptBytes: 98305 }], ["invalid variant", { variant: "high\nprivate" }]])
  test(`runtime rejects ${label} options generically`, (t) => {
    assert.throws(() => fixture(t, options), { message: "Runtime configuration invalid" });
  });
test("an abort of the attempt signal alone stops the sandbox without any explicit stop call", async (t) => {
  const f = fixture(t); const session = await f.start(); f.controller.abort(); await delay(30);
  assert.deepEqual(f.stops, ["operator"]); assert.deepEqual(await collect(session), []);
});
test("a burst of events is bounded to the newest 1024 and still ends with the terminal event", async (t) => {
  const f = fixture(t); const session = await f.start();
  for (let index = 0; index < 1500; index++) f.emit(text(`message ${index}`));
  f.end(); const events = await collect(session);
  assert.ok(events.length >= 1024 && events.length <= 1025, `bounded, got ${events.length}`); assert.equal(terminal(events).type, "completed");
  assert.equal(events.at(-2).message, "message 1499"); assert.ok(Number(events[0].message.split(" ")[1]) >= 475, "the oldest events were dropped");
});
for (const [label, statusCode] of [["too small", 42], ["too large", 600], ["huge", 99999], ["fractional", 401.5], ["string", "401"], ["missing", undefined]])
  test(`model error with a ${label} status code reports no status`, async (t) => {
    const f = fixture(t); const events = await f.run([{ type: "error", sessionID: "s", error: { name: "APIError", data: { statusCode } } }], { exitCode: 1 });
    assert.deepEqual(events, [{ type: "failed", kind: "model", message: "model request failed" }]);
  });
