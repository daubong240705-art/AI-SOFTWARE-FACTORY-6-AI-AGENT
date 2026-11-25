import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, constants, openSync, readSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";
import { SYSTEM_SCOPE_ID } from "@factory/contracts";
import { getApprovalView } from "../src/approvals/service.js";
import { ensureLocalNode } from "../src/dispatch/node.js";
import { startHost } from "../src/host.js";
import { createToolApproval } from "../src/integrations/approval.js";
import { credentialCrypto, secretKey } from "../src/integrations/crypto.js";
import { createIntegrationStore } from "../src/integrations/store.js";
import { launchStdio, type StdioLaunch } from "../src/integrations/stdio.js";
import { createIntegrationTools, withHttpToolDispatch } from "../src/integrations/tools.js";
import { createToolPolicy } from "../src/mcp/policy.js";
import { createMcpHandler } from "../src/mcp/rpc.js";
import { DEFAULT_BUDGET_CONFIG } from "../src/policy/index.js";
import { createModelProxy } from "../src/proxy/server.js";
import { createTokenRegistry } from "../src/proxy/tokens.js";
import { fixedClock, idFactory, MIGRATIONS_DIR, tempDir } from "./helpers.js";

test("integration key file is private and AES-GCM authenticates ciphertext and record ID", (context) => {
  const { dir, cleanup } = tempDir();
  context.after(cleanup);
  const key = secretKey(dir);
  const path = join(dir, "secret.key");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.ok(key.equals(secretKey(dir)));
  const crypto = credentialCrypto(key);
  const value = randomBytes(32).toString("hex");
  const encrypted = crypto.encrypt("sample", value);
  const row = { ...encrypted, key_id: encrypted.keyId };
  assert.ok(crypto.decrypt("sample", row) === value);
  assert.throws(() => crypto.decrypt("another", row), /credential unavailable/);
  const corrupted = Buffer.from(row.ciphertext);
  corrupted[0] = corrupted[0]! ^ 1;
  assert.throws(() => crypto.decrypt("sample", { ...row, ciphertext: corrupted }), /credential unavailable/);
  chmodSync(path, 0o644);
  assert.throws(() => secretKey(dir), /key file permissions/);
});

const echo = `const lines = require('node:readline').createInterface({ input: process.stdin });
lines.on('line', line => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  const result = method === 'initialize' ? { protocolVersion: '2025-06-18' }
    : method === 'tools/list' ? { tools: [{ name: 'echo', description: process.env.ECHO_TOKEN, inputSchema: { type: 'object' } }] }
    : { content: [{ type: 'text', text: params.arguments.message + ':' + process.env.ECHO_TOKEN }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
});`.replaceAll("\n", " ");

async function until<T>(fn: () => Promise<T | undefined>): Promise<T> {
  for (let count = 0; count < 150; count++) {
    const value = await fn();
    if (value !== undefined) return value;
    await sleep(20);
  }
  throw new Error("State did not settle");
}

test("Host commands, MCP endpoint and flow actions use scoped, encrypted integrations", async (context) => {
  const { dir, cleanup } = tempDir();
  const stateDir = join(dir, "state");
  const newId = idFactory(); const clock = fixedClock();
  const value = randomBytes(32).toString("hex");
  const bwrap = spawnSync("/usr/bin/bwrap", ["--unshare-all", "--ro-bind", "/usr", "/usr", "/usr/bin/true"], { stdio: "ignore" });
  let launches = 0;
  const launch: StdioLaunch = (input) => {
    launches++;
    if (bwrap.status === 0) return launchStdio(input);
    const fixture = tempDir();
    const inputPath = join(fixture.dir, "in"); const outputPath = join(fixture.dir, "out");
    assert.equal(spawnSync("mkfifo", [inputPath, outputPath], { stdio: "ignore" }).status, 0);
    const inputFd = openSync(inputPath, constants.O_RDWR);
    const childOutput = openSync(outputPath, constants.O_RDWR);
    const outputFd = openSync(outputPath, constants.O_RDONLY | constants.O_NONBLOCK);
    const child = spawn(process.execPath, input.config.args, { detached: true, env: input.env, stdio: [inputFd, childOutput, "ignore"] });
    const stdin = new Writable({ write(chunk: Buffer, _encoding, done) { writeSync(inputFd, chunk); done(); } });
    const stdout = new Readable({ read() {} });
    Object.assign(child, { stdin, stdout });
    const interval = setInterval(() => {
      const chunk = Buffer.alloc(8192);
      try { const size = readSync(outputFd, chunk); if (size) stdout.push(chunk.subarray(0, size)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EAGAIN") stdout.destroy(); }
    }, 5);
    child.once("close", () => {
      clearInterval(interval);
      for (const fd of [inputFd, outputFd, childOutput]) closeSync(fd);
      fixture.cleanup();
    });
    return child;
  };
  let requests = 0; let down = false; let correctAuth = true;
  const fetcher: typeof fetch = async (url, options) => {
    const parsed = new URL(String(url));
    correctAuth &&= new Headers(options?.headers).get("authorization") === `Bearer ${value}`;
    if (parsed.pathname === "/api") return new Response("ready");
    requests++;
    if (down) throw new Error("Connection ended");
    return Response.json({ path: parsed.pathname, message: parsed.searchParams.get("message"), reflected: value });
  };
  const packsDir = fileURLToPath(new URL("../../../../packs/", import.meta.url));
  const legacy = { servers: [{ name: "old-echo", transport: "stdio" as const, command: "node", args: ["-e", echo],
    envNames: ["ECHO_TOKEN"], clis: ["codex" as const] }] };
  const legacyPath = join(dir, "legacy.json");
  writeFileSync(legacyPath, JSON.stringify(legacy), { mode: 0o600 });
  const options = { stateDir, port: 8787, listen: false as const, openLogin: true, dispatch: null, migrationsDir: MIGRATIONS_DIR,
    packsDir, clock, onBootstrapToken() {}, integrationFetch: fetcher, integrationStdio: launch,
    config: { ECHO_TOKEN: value, FACTORY_MCP_SERVERS_FILE: legacyPath } };
  const host = await startHost(options);
  context.after(async () => { await host.close(); cleanup(); });
  const { raw } = host.storage;
  const origin = host.origins[0]!;
  const baseHeaders = { host: new URL(origin).host };
  const session = await host.app.inject({ url: "/auth/session", headers: baseHeaders });
  assert.equal(session.statusCode, 200);
  const cookie = session.cookies[0]!;
  const headers = { ...baseHeaders, cookie: `${cookie.name}=${cookie.value}`, origin, "x-csrf-token": session.json().csrfToken };
  const inspect = <T extends { body: string }>(response: T): T => { assert.ok(!response.body.includes(value), "response must not contain credential"); return response; };
  const get = async (url: string) => inspect(await host.app.inject({ url, headers }));
  const projectId = newId(); const groupId = newId(); const childId = newId(); const otherGroupId = newId();
  const command = async (type: string, payload: unknown, scope = SYSTEM_SCOPE_ID, status = 200) => {
    const response = inspect(await host.app.inject({ method: "POST", url: "/commands", headers,
      payload: { apiVersion: 1, commandId: newId(), projectId: scope, type, payload } }));
    assert.equal(response.statusCode, status, `${type}: ${response.body}`);
    return response.json();
  };
  await command("groups.create", { groupId, name: "Root", slug: "root", parentId: null });
  await command("groups.create", { groupId: childId, name: "Child", slug: "child", parentId: groupId });
  await command("groups.create", { groupId: otherGroupId, name: "Other", slug: "other", parentId: null });
  await command("projects.create", { name: "Integrations", groupId: childId, workspace: { kind: "directory", root: join(dir, "project") } }, projectId);
  const credentialId = newId();
  await command("credentials.create", { id: credentialId, name: "Echo credential", scopeGroupId: groupId, value });
  await command("credentials.replace", { id: credentialId, expectedRevision: 1, value });
  const stdioId = newId(); const httpId = newId();
  await command("integrations.create", { id: stdioId, kind: "mcp-stdio", name: "echo-mcp", scopeGroupId: childId,
    config: { command: "node", args: ["-e", echo], env: { ECHO_TOKEN: { credential: credentialId } } } });
  const operation = { name: "send", method: "GET", path: "/echo/{id}", sideEffect: "external", inputSchema: { type: "object", properties: {
    id: { type: "string" }, message: { type: "string" }, other: { type: "boolean" },
  }, required: ["id", "message"] } };
  await command("integrations.create", { id: httpId, kind: "http-api", name: "echo-api", scopeGroupId: groupId,
    config: { baseUrl: "http://127.0.0.1:12345/api", auth: { bearer: credentialId }, operations: [operation] } });
  await command("credentials.delete", { id: credentialId, expectedRevision: 2 }, SYSTEM_SCOPE_ID, 409);
  for (const id of [stdioId, httpId]) {
    await command("integrations.test", { id, expectedRevision: 1 });
    const checked = await until(async () => {
      const integration = (await get(`/integrations/${id}`)).json().integration;
      return integration.status === "checking" ? undefined : integration;
    });
    assert.equal(checked.status, "ready");
    assert.equal(checked.tools.length, 1);
  }
  assert.ok((await get("/credentials")).json().credentials.some((entry: { id: string; last4: string }) => entry.id === credentialId && entry.last4 === value.slice(-4)));
  assert.equal((await get(`/integrations?groupId=${childId}`)).json().integrations.length, 3);
  assert.equal((await get(`/integrations?groupId=${otherGroupId}`)).json().integrations.length, 1);
  for (const route of ["/integrations", "/mcp-servers", "/system/capabilities", `/projects/${projectId}/http-effects`]) assert.equal((await get(route)).statusCode, 200);

  const agentId = newId(); const taskId = newId(); const attemptId = newId();
  const agent = (mode: string, httpTool = "http.echo-api.send") => ({ name: "Writer", role: "Editor", runtime: { adapter: "fake" },
    tools: [{ tool: "ext.echo-mcp.echo", mode }, { tool: httpTool, mode: "allow" }] });
  await command("agents.create", { agentId, config: agent("allow", "http.echo-api.absent") }, projectId, 400);
  await command("agents.create", { agentId, config: agent("allow") }, projectId);
  const now = clock().toISOString();
  const node = ensureLocalNode(raw, { slots: 2, now });
  raw.prepare(`INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,owner_seat_id,origin_kind,state,required_capabilities_json,acceptance_json,inputs_json)
    VALUES (?,?,1,'ECHO-001','Echo','Echo','',?,'operator','active','[]','[]','[]')`).run(projectId, taskId, agentId);
  raw.prepare(`INSERT INTO attempts (project_id,id,task_id,revision,epoch,state,outcome,node_id,runtime,provider,model,effort,lease_id,lease_expires_at)
    VALUES (?,?,?,1,1,'running','known',?,'fake','test','test','low',?,?)`).run(projectId, attemptId, taskId, node.id, newId(), "2026-11-20T10:00:00.000Z");
  raw.prepare("INSERT INTO attempt_seats VALUES (?,?,?)").run(projectId, attemptId, agentId);
  const integrationStore = createIntegrationStore(raw, () => credentialCrypto(secretKey(stateDir)), clock);
  const approve = createToolApproval({ raw, hub: host.hub, clock, newId });
  const external = createIntegrationTools({ raw, store: integrationStore, http: host.effects!.http!, stateDir, clock, approve, launch });
  const tokens = createTokenRegistry({ clock });
  const { token } = tokens.issue({ projectId, taskId, attemptId, epoch: 1, allowedModels: ["test"] });
  const proxy = createModelProxy({ raw, tokens, clock, newId, budget: DEFAULT_BUDGET_CONFIG, allowedHosts: ["localhost"],
    upstream: { providerId: "test", async chatCompletions() { throw new Error("unused"); }, async listModels() { return null; } }, mcp: withHttpToolDispatch(createMcpHandler({
      external, toolPolicy: createToolPolicy(raw), approveTool: approve, progress() {}, registerOutput() { throw new Error("unused"); },
      requestDecision() { throw new Error("unused"); },
    }), external) });
  context.after(async () => { external.close(); await proxy.close(); });
  const rpc = async (method: string, params: unknown) => inspect(await proxy.app.inject({ method: "POST", url: "/mcp",
    headers: { host: "localhost", authorization: `Bearer ${token}` }, payload: { jsonrpc: "2.0", id: 1, method, params } })).json().result;
  const stdio = (args: unknown) => rpc("tools/call", { name: "ext.echo-mcp.echo", arguments: args });
  const http = (args: unknown) => rpc("tools/call", { name: "http.echo-api.send", arguments: args });
  assert.ok((await rpc("tools/list", {})).tools.some(({ name }: { name: string }) => name === "ext.echo-mcp.echo"));
  assert.deepEqual((await stdio({ message: "hello" })).content, [{ type: "text", text: "hello:[redacted]" }]);
  await command("agents.update", { agentId, expectedRevision: 1, config: agent("ask") }, projectId);
  const before = launches;
  assert.match((await stdio({ message: "ask", flag: true })).content[0].text, /đang chờ/);
  assert.equal(launches, before);
  const decide = async (optionId: string) => {
    const row = raw.prepare("SELECT approval_id FROM tool_call_approvals ORDER BY rowid DESC LIMIT 1").get() as { approval_id: string };
    const approval = getApprovalView(raw, projectId, row.approval_id)!;
    assert.ok(!JSON.stringify(approval).includes(value));
    await command("approvals.decide", { approvalId: approval.id, expectedRevision: approval.revision,
      contextDigest: approval.context.digest, optionId, comment: "Test decision" }, projectId);
  };
  await decide("approve");
  const duplicate = await Promise.all([stdio({ flag: true, message: "ask" }), stdio({ message: "ask", flag: true })]);
  assert.equal(duplicate.filter((entry) => !entry.isError).length, 1);
  assert.equal(launches, before + 1);
  assert.equal((await stdio({ message: value })).isError, true);
  await decide("reject");
  assert.match((await stdio({ message: value })).content[0].text, /từ chối/);
  await command("agents.update", { agentId, expectedRevision: 2, config: agent("deny") }, projectId);
  assert.equal((await stdio({ message: "denied" })).isError, true);
  assert.equal(launches, before + 1);

  const httpArgs = { id: "agent", message: "hello" };
  assert.equal((await http(httpArgs)).isError, false);
  assert.equal((await http({ message: "hello", id: "agent" })).isError, false);
  assert.equal(requests, 1);
  down = true;
  assert.equal((await http({ id: "error", message: "hello" })).isError, true);
  down = false;
  assert.equal((await http({ id: "error", message: "hello" })).isError, true);
  assert.equal(requests, 2);
  const effects = (await get(`/projects/${projectId}/http-effects`)).json().effects;
  assert.equal(effects.at(-1).state, "unknown");
  const resolved = inspect(await host.app.inject({ method: "POST", url: `/projects/${projectId}/http-effects/${effects.at(-1).id}/reconcile`, headers,
    payload: { resolution: "failed" } }));
  assert.equal(resolved.statusCode, 200);
  const flowId = newId(); const runId = newId();
  await command("flows.create", { flowId, definition: { schema: 2, key: "http-check", title: "HTTP check", inputs: [{ name: "payload", type: "string", required: true }], nodes: [
    { id: "start", type: "trigger", title: "Start", trigger: { kind: "manual" } },
    { id: "send", type: "action", title: "Send", action: "http.request", params: { integration: "echo-api", operation: "send", args: "{{ inputs.payload }}" } },
    { id: "end", type: "output", title: "End", target: "artifact", from: ["nodes.send.output"] },
  ], edges: [{ id: "start-send", from: { node: "start", port: "out" }, to: { node: "send" } },
    { id: "send-end", from: { node: "send", port: "out" }, to: { node: "end" } }] } }, projectId);
  await command("flow-runs.start", { flowId, runId, version: "draft", inputs: { payload: JSON.stringify({ id: "flow", message: "from flow" }) } }, projectId);
  const flow = await until(async () => {
    const data = (await get(`/projects/${projectId}/flow-runs/${runId}`)).json();
    return data.run?.state === "running" ? undefined : data;
  });
  assert.equal(flow.run.state, "succeeded");
  assert.deepEqual(flow.nodeRuns.find((entry: { nodeId: string }) => entry.nodeId === "send").output,
    { path: "/api/echo/flow", message: "from flow", reflected: "[redacted]" });
  assert.equal(requests, 3);
  assert.ok(correctAuth);
  await host.close();
  const pattern = join(dir, "grep-input");
  assert.equal(spawnSync("mkfifo", [pattern], { stdio: "ignore" }).status, 0);
  const reader = openSync(pattern, constants.O_RDONLY | constants.O_NONBLOCK);
  const writer = openSync(pattern, constants.O_WRONLY);
  writeSync(writer, `${value}\n`);
  closeSync(writer);
  const searched = spawnSync("grep", ["-aFq", "-f", "-", join(stateDir, "host.db")], { stdio: [reader, "ignore", "ignore"] });
  closeSync(reader);
  assert.equal(searched.status, 1, "grep must not find plaintext credential in SQLite bytes");
  const restarted = await startHost(options);
  try {
    assert.deepEqual(restarted.storage.raw.prepare("SELECT count(*) AS count FROM integrations WHERE name='old-echo'").get(), { count: 1 });
    assert.deepEqual(restarted.storage.raw.prepare("SELECT count(*) AS count FROM credentials WHERE name='old-echo: ECHO_TOKEN'").get(), { count: 1 });
  } finally { await restarted.close(); }
});
