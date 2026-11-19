import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createCommandPipeline } from "../src/commands/pipeline.js";
import { createDispatcher } from "../src/dispatch/dispatcher.js";
import { RuntimeRegistry, type AttemptContext, type RuntimeEvent } from "../src/dispatch/runtime.js";
import { EventHub } from "../src/events/hub.js";
import { createAgentHandlers } from "../src/org/agent-commands.js";
import { createApiAgentRuntime } from "../src/runtimes/api-agent.js";
import { createWorkspaceTools, runApiAgent, type ApiAgentInput } from "../src/runtimes/api-agent-loop.js";
import { fixedClock, idFactory, migratedStorage } from "./helpers.js";

const token = "test-only-attempt-credential";
const input: ApiAgentInput = {
  access: { baseUrl: "http://127.0.0.1:1/v1", token, models: ["allowed-model"], mcpBaseUrl: "http://127.0.0.1:2" },
  model: "allowed-model", effort: "high", timeoutMinutes: 3, language: "English", workspacePath: undefined,
  task: { title: "Research", goal: "Find a fact", brief: "Write a note", acceptance: ["Note exists"], inputs: [] },
  handoff: "Prior work", contextPack: "Project context", instructions: { profile: "Check facts", skills: [{ name: "writing", description: "Make it clear" }] },
  inputs: [{ path: ".factory/inputs/reference.txt", title: "Reference", mediaType: "text/plain", note: null }],
};
const call = (id: string, name: string, args: unknown) => ({ id, type: "function",
  function: { name, arguments: JSON.stringify(args) } });
const answer = (content: string | null, tool_calls: ReturnType<typeof call>[] = [], usage?: unknown) =>
  Response.json({ choices: [{ message: { role: "assistant", content, tool_calls } }], usage });

async function scratch(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(process.cwd(), ".api-agent-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("API agent discovers MCP tools and sends tool results back in order", async (t) => {
  const workspacePath = await scratch(t);
  const events: RuntimeEvent[] = [];
  const definition = { type: "object", properties: { query: { type: "string" } } };
  let turns = 0;
  const rpcMethods: string[] = [];
  await runApiAgent({ ...input, workspacePath }, (event) => events.push(event), async (url, options) => {
    assert.ok(new Headers(options?.headers).get("authorization") === `Bearer ${token}`);
    assert.ok(typeof options?.body === "string");
    const body = JSON.parse(options.body);
    if (String(url) === "http://127.0.0.1:2/mcp") {
      rpcMethods.push(body.method);
      const result = body.method === "tools/list" ? { tools: [
        { name: "knowledge.search", description: "Search", inputSchema: definition }, { name: "skill.get", inputSchema: { type: "object" } },
      ] } : { content: [{ type: "text", text: `Fact found ${token}` }], isError: false };
      if (body.method !== "tools/list") assert.deepEqual(body.params, { name: "knowledge.search", arguments: { query: "fact" } });
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    }
    assert.equal(String(url), "http://127.0.0.1:1/v1/chat/completions");
    assert.equal(body.model, "allowed-model");
    assert.equal(body.reasoning_effort, "high");
    assert.equal(body.tool_choice, "auto");
    assert.equal(body.stream, false);
    assert.equal(JSON.stringify(body).includes(token), false);
    turns++;
    if (turns === 1) {
      assert.deepEqual(body.tools.map((tool: { function: { name: string } }) => tool.function.name),
        ["workspace__list", "workspace__read", "workspace__write", "knowledge__search", "skill__get"]);
      assert.deepEqual(body.tools[3].function.parameters, definition);
      assert.match(body.messages[0].content, /Check facts[\s\S]*writing: Make it clear[\s\S]*skill\.get[\s\S]*English/);
      assert.match(body.messages[1].content, /Research[\s\S]*Find a fact[\s\S]*Write a note[\s\S]*Note exists[\s\S]*Prior work[\s\S]*Project context[\s\S]*reference.txt/);
      return answer(null, [call("search", "knowledge__search", { query: "fact" })], {
        prompt_tokens: 12, completion_tokens: null, prompt_tokens_details: { cached_tokens: 0 },
      });
    }
    assert.deepEqual(body.messages[3], { role: "tool", tool_call_id: "search", content: "Fact found [redacted]" });
    if (turns === 2) return answer(null, [call("write", "workspace__write", { path: "notes/fact.txt", content: "Fact found" })]);
    assert.deepEqual(body.messages[5], { role: "tool", tool_call_id: "write", content: "File written" });
    return answer(`Done ${token}`);
  });
  assert.equal(turns, 3);
  assert.deepEqual(rpcMethods, ["tools/list", "tools/call"]);
  assert.equal(await readFile(join(workspacePath, "notes/fact.txt"), "utf8"), "Fact found");
  assert.deepEqual(events.map(({ type }) => type), ["progress", "usage", "progress", "usage", "evidence", "progress", "usage", "completed"]);
  assert.deepEqual(events[1], { type: "usage", usage: { inputTokens: 12, cachedInputTokens: 0, outputTokens: null, reasoningOutputTokens: null } });
  assert.deepEqual(events[4], { type: "evidence", name: "file", detail: "notes/fact.txt" });
  assert.deepEqual(events.at(-1), { type: "completed", summary: "Done [redacted]" });
  assert.equal(JSON.stringify(events).includes(token), false);
});

test("workspace tools reject escapes and oversized I/O, and the loop continues after a denied write", async (t) => {
  const workspacePath = await scratch(t);
  const outside = await scratch(t);
  await writeFile(join(outside, "target.txt"), "unchanged");
  await symlink(outside, join(workspacePath, "escape"), "dir");
  const workspace = createWorkspaceTools(workspacePath, token);
  const escapes = ["../x", "/etc/passwd", "escape/target.txt", ".git/config"];
  for (const path of escapes) {
    assert.match((await workspace("workspace__read", { path })).text, /^Error:/);
    assert.match((await workspace("workspace__write", { path, content: "new text" })).text, /^Error:/);
  }
  assert.match((await workspace("workspace__list", { dir: "escape" })).text, /^Error:/);
  assert.match((await workspace("workspace__write", { path: "large", content: "x".repeat(256 * 1024 + 1) })).text, /^Error:/);
  assert.match((await workspace("workspace__write", { path: "private", content: token })).text, /^Error:/);
  assert.match((await workspace("workspace__read", { path: "small", limit: 65_537 })).text, /^Error:/);
  assert.equal(await readFile(join(outside, "target.txt"), "utf8"), "unchanged");
  const events: RuntimeEvent[] = [];
  let turns = 0;
  await runApiAgent({ ...input, access: { ...input.access!, mcpBaseUrl: "" }, workspacePath }, (event) => events.push(event), async (_url, options) => {
    if (++turns === 1) return answer(null, escapes.map((path) => call(path, "workspace__write", { path, content: "new text" })));
    const { messages } = JSON.parse(String(options?.body));
    assert.deepEqual(messages.slice(3).map((message: { tool_call_id: string }) => message.tool_call_id), escapes);
    assert.ok(messages.slice(3).every((message: { content: string }) => message.content.startsWith("Error:")));
    return answer("Recovered");
  });
  assert.equal(turns, 2);
  assert.deepEqual(events.at(-1), { type: "completed", summary: "Recovered" });
  assert.equal(events.some(({ type }) => type === "evidence"), false);
});

test("loop limits and proxy failures have safe failure events", async () => {
  const access = { ...input.access!, mcpBaseUrl: "" };
  const events: RuntimeEvent[] = [];
  const emit = (event: RuntimeEvent) => events.push(event);
  let turns = 0;
  await runApiAgent({ ...input, access }, emit, async () => answer(null, [call(String(++turns), "unknown", {})]));
  assert.equal(turns, 40);
  assert.deepEqual(events.at(-1), { type: "failed", kind: "runtime", message: "API agent hit the 40 model turn limit" });
  await runApiAgent({ ...input, access }, emit, async () => new Response(token, { status: 429 }));
  assert.deepEqual(events.at(-1), { type: "failed", kind: "model", message: "Model proxy returned HTTP 429" });
  await runApiAgent({ ...input, access }, emit, async () => { throw new Error(token); });
  assert.deepEqual(events.at(-1), { type: "failed", kind: "runtime", message: "Model proxy request failed" });
  assert.equal(JSON.stringify(events).includes(token), false);
});

test("child adapter reports a configuration failure without a model grant", async () => {
  const adapter = createApiAgentRuntime();
  const context = { signal: new AbortController().signal, task: input.task, handoff: null } as AttemptContext;
  const session = await adapter.start(context);
  const events: RuntimeEvent[] = [];
  for await (const event of session.events()) events.push(event);
  await session.stop();
  assert.deepEqual(events, [{ type: "failed", kind: "config", message: "API agent requires a proxy token and an approved model" }]);
});

test("agents.create projects an API agent and dispatcher snapshots its model, effort and timeout", async (t) => {
  const storage = migratedStorage();
  t.after(() => storage.close());
  const { raw } = storage;
  const newId = idFactory(), clock = fixedClock();
  const hub = new EventHub(raw, { newId, clock });
  const pipeline = createCommandPipeline({ storage, hub, newId, clock, handlers: createAgentHandlers() });
  const projectId = newId();
  const execute = (type: string, payload: unknown) => {
    const result = pipeline.execute({ apiVersion: 1, commandId: newId(), projectId, type, payload });
    if (!result.body.ok) assert.fail(result.body.error.message);
  };
  execute("projects.create", { name: "Test", workspace: { kind: "directory", root: process.cwd() } });
  const dispatcher = createDispatcher({ storage, hub, newId, clock, registry: new RuntimeRegistry(), defaultAgentModel: () => "host-model" });
  try {
    for (const configured of [true, false]) {
      const seatId = newId(), taskId = newId();
      execute("agents.create", { agentId: seatId, config: { name: configured ? "Researcher" : "Writer", role: "Research",
        runtime: { adapter: "api-agent", ...(configured ? { model: "agent-model", effort: "high", timeoutMinutes: 7 } : {}) } } });
      assert.deepEqual(raw.prepare("SELECT runtime FROM seats WHERE id = ?").get(seatId), { runtime: "api-agent" });
      assert.equal(raw.prepare("SELECT 1 FROM seat_runtime_config WHERE seat_id = ?").get(seatId), undefined);
      const { id: engagementId } = raw.prepare("SELECT id FROM engagements WHERE project_id = ?").get(projectId) as { id: string };
      raw.prepare(`INSERT INTO tasks (project_id, id, revision, code, title, goal, brief, owner_seat_id,
        engagement_id, origin_kind, state, required_capabilities_json, acceptance_json, inputs_json)
        VALUES (?, ?, 1, ?, 'Task', 'Goal', '', ?, ?, 'operator', 'active', '[]', '[]', '[]')`)
        .run(projectId, taskId, configured ? "TASK-001" : "TASK-002", seatId, engagementId);
      const attempt = dispatcher.enqueue({ projectId, taskId, seatId });
      const model = configured ? "agent-model" : "host-model", effort = configured ? "high" : "medium";
      assert.deepEqual(raw.prepare("SELECT runtime, provider, model, effort FROM attempts WHERE project_id = ? AND id = ?").get(projectId, attempt.id),
        { runtime: "api-agent", provider: "api-agent", model, effort });
      const event = raw.prepare("SELECT body_json FROM attempt_events WHERE attempt_id = ? AND json_extract(body_json, '$.to') = 'runtime-configured'")
        .get(attempt.id) as { body_json: string };
      assert.deepEqual(JSON.parse(event.body_json).agent, { model, effort, timeoutMinutes: configured ? 7 : 60 });
    }
  } finally { await dispatcher.stop(); }
});
