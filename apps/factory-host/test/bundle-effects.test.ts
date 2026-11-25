import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { flowDefinitionSchema, SYSTEM_SCOPE_ID, validateFlow, type HttpOperation } from "@factory/contracts";
import { startHost } from "../src/host.js";
import { createBundleEffects } from "../src/integrations/bundle-effects.js";
import { createIntegrationStore } from "../src/integrations/store.js";
import { credentialCrypto } from "../src/integrations/crypto.js";
import { EventHub } from "../src/events/hub.js";
import { fixedClock, idFactory, migratedStorage, MIGRATIONS_DIR, tempDir } from "./helpers.js";

const packsDir = fileURLToPath(new URL("../../../../packs/", import.meta.url));
const operation: HttpOperation = { name: "publish", method: "POST", path: "/api/publish/{channel}", sideEffect: "external",
  inputSchema: { type: "object", required: ["channel"], properties: { channel: { type: "string" } } } };
const definition = (params: unknown) => flowDefinitionSchema.parse({ schema: 2, key: "publish-fixture", title: "Bundle fixture", nodes: [
  { id: "start", type: "trigger", title: "Start", trigger: { kind: "manual" } },
  { id: "bundle", type: "action", title: "Publish", action: "bundle.publish", params, onError: "port", retry: { max: 2, backoffSeconds: 1 } },
], edges: [{ id: "start-bundle", from: { node: "start", port: "out" }, to: { node: "bundle" } }] });

async function fixture(context: TestContext, baseUrl: string, fetcher?: typeof fetch) {
  const { dir, cleanup } = tempDir();
  let close: (() => Promise<void>) | undefined;
  context.after(async () => { try { await close?.(); } finally { cleanup(); } });
  const projectsRoot = join(dir, "projects"), project = join(projectsRoot, "tiny"), stateDir = join(dir, "state");
  mkdirSync(project, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args],
    { cwd: project, encoding: "utf8", env: { PATH: process.env.PATH!, HOME: dir, GIT_CONFIG_NOSYSTEM: "1" } }).trim();
  git("init", "-q", "-b", "main");
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "fixture-bundle", version: "1.0.0", scripts: {
    build: "node build.cjs", test: "node -e 'process.exit(1)'",
  } }));
  writeFileSync(join(project, "build.cjs"), `const fs = require('node:fs');
    if (process.env.FACTORY_MODEL_API_KEY) process.exit(2);
    fs.mkdirSync('dist', { recursive: true });
    fs.writeFileSync('dist/game.json', JSON.stringify({ id: 'fixture' }));
    if (fs.existsSync('large')) {
      const fd = fs.openSync('dist/blob', 'w');
      for (let index = 0; index < 51; index++) fs.writeSync(fd, require('node:crypto').randomBytes(1024 * 1024));
      fs.closeSync(fd);
    }
    if (fs.existsSync('unsafe')) fs.symlinkSync('/etc', 'dist/unsafe');
  `);
  git("add", "."); git("commit", "-qm", "fixture");
  git("branch", "factory/integration");
  const commit = git("rev-parse", "HEAD");
  const clock = fixedClock(), newId = idFactory();
  const host = await startHost({ stateDir, port: 8787, packsDir, migrationsDir: MIGRATIONS_DIR, listen: false,
    dispatch: null, workspace: { projectsRoot, worktreesRoot: join(dir, "worktrees") }, clock, openLogin: true,
    onBootstrapToken() {}, ...(fetcher === undefined ? {} : { integrationFetch: fetcher }) });
  close = () => host.close();
  const projectId = newId(), integrationId = newId(), credentialId = newId();
  const value = randomBytes(24).toString("hex");
  const origin = host.origins[0]!;
  const base = { host: new URL(origin).host };
  const session = await host.app.inject({ url: "/auth/session", headers: base });
  const cookie = session.cookies[0]!;
  const headers = { ...base, cookie: `${cookie.name}=${cookie.value}`, origin, "x-csrf-token": session.json().csrfToken };
  const command = async (type: string, payload: unknown, scope = projectId, status = 200) => {
    const result = await host.app.inject({ method: "POST", url: "/commands", headers,
      payload: { apiVersion: 1, commandId: newId(), projectId: scope, type, payload } });
    assert.ok(!result.body.includes(value), "command must not expose credentials");
    assert.equal(result.statusCode, status, `${type}: ${result.body}`);
  };
  await command("projects.create", { name: "Bundle fixture", workspace: { kind: "git", root: project } });
  await command("credentials.create", { id: credentialId, name: "Fixture token", value }, SYSTEM_SCOPE_ID);
  await command("integrations.create", { id: integrationId, kind: "http-api", name: "fixture-portal", config: {
    baseUrl, auth: { bearer: credentialId }, operations: [operation],
  } }, SYSTEM_SCOPE_ID);
  const raw = host.storage.raw;
  const lookup = async (runId: string, expected: string) => {
    for (let count = 0; count < 500; count++) {
      const result = await host.app.inject({ url: `/projects/${projectId}/flow-runs/${runId}`, headers });
      assert.ok(!result.body.includes(value), "node output must not expose credentials");
      assert.equal(result.statusCode, 200);
      if (result.json().run.state === expected) return result.json();
      await sleep(20);
    }
    assert.fail(`Expected flow run state ${expected}: ${JSON.stringify(raw.prepare("SELECT state,error FROM effects").all())}`);
  };
  const run = async (key: string, overrides: Record<string, unknown> = {}) => {
    const flowId = newId(), runId = newId();
    const spec = { ...definition({ integrationId, operation: "publish", channel: "test channel", scripts: ["build"],
      query: { commitSha: "{{bundle.commit}}" }, ...overrides }), key };
    await command("flows.create", { flowId, definition: spec });
    await command("flow-runs.start", { flowId, runId, version: "draft" });
    return runId;
  };
  return { host, raw, projectId, integrationId, lookup, run, headers, value, clock, newId, git, commit, project, stateDir };
}

function canBuild(context: TestContext): boolean {
  const probe = spawnSync("/usr/bin/git", ["--version"]);
  if (probe.error && ["EPERM", "EACCES"].includes((probe.error as NodeJS.ErrnoException).code ?? "")) {
    context.skip("Sandbox prohibits subprocess pipes for Git/npm/tar");
    return false;
  }
  assert.equal(probe.status, 0);
  return true;
}

test("bundle publish uploads gzip to a loopback Portal", async (context) => {
  let received: { path: string; type: string; bundle: Buffer } | undefined;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    received = { path: request.url!, type: request.headers["content-type"]!, bundle: Buffer.concat(chunks) };
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ gameId: "fixture", version: 1, playPath: "/play/fixture" }));
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  } catch (error) {
    if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) { context.skip("Sandbox prohibits loopback listeners"); return; }
    throw error;
  }
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  if (!canBuild(context)) return;
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const env = await fixture(context, `http://127.0.0.1:${address.port}`);
  const result = await env.lookup(await env.run("real-bundle", { scripts: ["ci", "build"] }), "succeeded");
  assert.equal(result.nodeRuns.find(({ nodeId }: { nodeId: string }) => nodeId === "bundle").output.response.gameId, "fixture");
  assert.ok(received);
  assert.equal(received.type, "application/gzip");
  assert.equal(received.path, `/api/publish/test%20channel?commitSha=${env.commit}`);
  assert.ok(gunzipSync(received.bundle).includes(Buffer.from('"id":"fixture"')));
});

test("bundle flow records success, rejection and unknown without leaking credentials or resending", async (context) => {
  if (!canBuild(context)) return;
  let status = 200, calls = 0, key: string | null = null, token = "";
  const fixtureFetch: typeof fetch = async (_, options) => {
    const headers = new Headers(options?.headers);
    assert.ok(headers.get("authorization") === `Bearer ${token}`, "credential must be sent only as auth");
    assert.equal(options?.redirect, "error");
    key = headers.get("idempotency-key");
    calls++;
    return Response.json(status === 200 ? { gameId: "fixture", reflected: token, [token]: Buffer.from(token).toString("base64") }
      : { error: `Rejected ${token}`, problems: Array.from({ length: 7 }, (_, index) => `problem-${index}`) }, { status });
  };
  const env = await fixture(context, "http://127.0.0.1:1", fixtureFetch);
  token = env.value;
  const node = (result: { nodeRuns: { nodeId: string; port: string; error: string; output: { state: string; commit: string; response: unknown; log: string } }[] }) =>
    result.nodeRuns.find(({ nodeId }) => nodeId === "bundle")!;
  const done = await env.lookup(await env.run("done-bundle"), "succeeded");
  assert.equal(node(done).port, "out");
  assert.deepEqual(node(done).output, { state: "done", commit: env.commit,
    response: { gameId: "fixture", reflected: "[redacted]", "[redacted]": "[redacted]" }, log: node(done).output.log });
  assert.match(node(done).output.log, /npm run build/);
  assert.equal(env.raw.prepare("SELECT id FROM effects WHERE state='done'").pluck().get(), key);
  status = 422;
  const failed = await env.lookup(await env.run("failed-bundle"), "succeeded");
  const failure = node(failed);
  assert.equal(failure.port, "error");
  assert.match(failure.error, /Rejected \[redacted\]/);
  assert.doesNotMatch(failure.error, /problem-5/);
  status = 500;
  const runId = await env.run("unknown-bundle");
  const unknown = await env.lookup(runId, "stalled");
  assert.equal(unknown.run.stateReason, "bundle-outcome-unknown");
  const unknownId = env.raw.prepare("SELECT id FROM effects WHERE state='unknown'").pluck().get();
  const integration = createIntegrationStore(env.raw, () => credentialCrypto(Buffer.alloc(32)), env.clock).get(env.integrationId);
  assert.ok(integration?.kind === "http-api");
  const bundle = createBundleEffects({ raw: env.raw, hub: env.host.hub, store: createIntegrationStore(env.raw, () => credentialCrypto(Buffer.alloc(32)), env.clock),
    stateDir: env.stateDir, clock: env.clock, newId: env.newId, cache: { prepare: async () => ({ used: false }), close: async () => {} },
    projectRootFor: () => env.project, fetch: fixtureFetch });
  for (const nodeAttempt of [1, 2]) assert.equal((await bundle.submit({ projectId: env.projectId, caller: `flow:${runId}:bundle:1`, nodeAttempt,
    integration, operation: integration.config.operations[0]!, args: {} })).id, unknownId);
  assert.equal(calls, 3);
  const reconciled = await env.host.app.inject({ method: "POST", url: `/projects/${env.projectId}/http-effects/${String(unknownId)}/reconcile`,
    headers: env.headers, payload: { resolution: "done" } });
  assert.equal(reconciled.statusCode, 200);
  await env.lookup(runId, "succeeded");
  assert.equal(calls, 3);
  for (const table of ["effects", "flow_node_runs", "flow_runs", "credentials", "integrations", "event_log", "trace_spans"]) {
    const stored = JSON.stringify(env.raw.prepare(`SELECT * FROM ${table}`).all());
    assert.ok(!stored.includes(token) && !stored.includes(Buffer.from(token).toString("base64")), `${table} must not retain credential values`);
  }
});

test("bundle rejects failed builds, symlink escapes and oversized archives before sending", async (context) => {
  if (!canBuild(context)) return;
  let calls = 0;
  const env = await fixture(context, "http://127.0.0.1:1", async () => { calls++; return Response.json({}); });
  await env.lookup(await env.run("test-failed", { scripts: ["test"] }), "succeeded");
  assert.match(String(env.raw.prepare("SELECT error FROM effects ORDER BY rowid DESC LIMIT 1").pluck().get()), /^build-failed: test/);
  writeFileSync(join(env.project, "unsafe"), "");
  env.git("add", "unsafe"); env.git("commit", "-qm", "symlink fixture");
  await env.lookup(await env.run("unsafe-bundle", { ref: "main" }), "succeeded");
  assert.match(String(env.raw.prepare("SELECT error FROM effects ORDER BY rowid DESC LIMIT 1").pluck().get()), /^build-failed: directory/);
  env.git("rm", "unsafe"); writeFileSync(join(env.project, "large"), "");
  env.git("add", "large"); env.git("commit", "-qm", "large fixture");
  await env.lookup(await env.run("large-bundle", { ref: "main" }), "succeeded");
  assert.match(String(env.raw.prepare("SELECT error FROM effects ORDER BY rowid DESC LIMIT 1").pluck().get()), /^build-failed: too-large/);
  assert.equal(calls, 0);
});

test("bundle action validates paths, scripts, query, integration and the external method", () => {
  const invalid = definition({ operation: "invalid operation", dir: "../dist", ref: "HEAD", scripts: ["lint"],
    query: Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`param${index}`, "value"])) });
  assert.deepEqual(validateFlow(invalid).map(({ code }) => code), ["bundle-integration", "bundle-operation", "bundle-dir", "bundle-ref", "bundle-scripts", "bundle-query"]);
  const fixed = definition({ integrationId: idFactory()(), operation: "publish" });
  assert.equal(validateFlow(fixed, { bundleOperations: () => [{ name: "publish", method: "GET", path: "/", sideEffect: "none",
    inputSchema: { type: "object", properties: {} } }] })[0]?.code, "bundle-operation");
  assert.equal(validateFlow(definition({ integrationId: "{{inputs.target}}", operation: "publish", query: { sha: "{{bundle.commit}}" } })).length, 0);
});

test("bundle redacts credential values from build logs and stored JSON without subprocesses", async (context) => {
  const { dir, cleanup } = tempDir();
  const storage = migratedStorage();
  context.after(() => { storage.close(); cleanup(); });
  const { raw } = storage;
  const newId = idFactory(), projectId = newId(), credentialId = newId(), integrationId = newId(), clock = fixedClock();
  const value = randomBytes(24).toString("hex"), encoded = Buffer.from(value).toString("base64");
  const repo = join(dir, "repo");
  mkdirSync(repo);
  raw.prepare("INSERT INTO projects (id,revision,name,workspace_kind,workspace_root) VALUES (?,1,'Fixture','git',?)").run(projectId, repo);
  const store = createIntegrationStore(raw, () => credentialCrypto(Buffer.alloc(32)), clock);
  store.createCredential(credentialId, "Fixture credential", null, value);
  store.save(integrationId, { kind: "http-api", name: "fixture-portal", scopeGroupId: null,
    config: { baseUrl: "http://127.0.0.1:1", auth: { bearer: credentialId }, operations: [operation] } });
  const integration = store.get(integrationId);
  assert.ok(integration?.kind === "http-api");
  let calls = 0;
  const bundle = createBundleEffects({ raw, store, hub: new EventHub(raw), newId, clock, stateDir: dir, projectRootFor: () => repo,
    cache: { prepare: async () => ({ used: false }), close: async () => {} },
    processes: {
      git: async (_root, args) => {
        if (args[0] === "worktree") mkdirSync(args.at(-2)!);
        return { stdout: args.includes("--show-toplevel") ? repo : "a".repeat(40), stderr: "", exitCode: 0 };
      },
      start: ({ cwd, args, env }) => {
        assert.ok(!Object.values(env).some((entry) => entry.includes(value)));
        if (args.includes("npm")) mkdirSync(join(cwd, "dist"));
        if (args.includes("tar")) writeFileSync(args[args.indexOf("-czf") + 1]!, "fixture archive");
        return { pid: 0, stop: async () => {}, result: Promise.resolve({ exitCode: 0, signal: null, timedOut: false, stopped: false,
          stdout: args.includes("npm") ? `Build output: ${value}` : "", stderr: "", truncated: false, durationMs: 0, groupGone: true }) };
      },
    },
    fetch: async (_url, options) => {
      calls++;
      assert.ok(new Headers(options?.headers).get("authorization") === `Bearer ${value}`);
      return Response.json({ nested: { [value]: encoded } });
    },
  });
  const input = { projectId, caller: "fixture", nodeAttempt: 1, integration, operation, scripts: ["build"], args: { channel: "fixture" } };
  const [first, second] = await Promise.all([bundle.submit(input), bundle.submit(input)]);
  assert.equal(calls, 1);
  assert.equal(first.id, second.id);
  assert.equal(first.state, "done");
  assert.match(first.log, /Build output: \[redacted\]/);
  assert.deepEqual(first.response, { nested: { "[redacted]": "[redacted]" } });
  const persisted = JSON.stringify(raw.prepare("SELECT * FROM effects").all());
  assert.ok(!persisted.includes(value) && !persisted.includes(encoded));
});
