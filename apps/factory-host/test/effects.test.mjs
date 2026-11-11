import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Database from "better-sqlite3";
import { parsePushRemotes, describeRemote } from "../dist/effects/config.js";
import { createEffectExecutor, PushError } from "../dist/effects/executor.js";
import { parseEnv } from "../dist/host.js";
import { openStorage } from "../dist/storage/database.js";
import { EventHub } from "../dist/events/hub.js";
import { appendAttemptEvent } from "../dist/dispatch/attempts.js";
import { createRoutes } from "../dist/api/routes.js";
import { createApiServer, originsFor } from "../dist/api/index.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const tip = "1".repeat(40);
const branch = "factory/push-001-e1";
const remoteUrl = "https://example.invalid/operator/repository.git";
const sshCommand = "ssh -i /private/synthetic-key -o IdentitiesOnly=yes";
const privateText = "sk-synthetic-never-persist /private/synthetic-output";
const clock = () => new Date("2026-11-08T00:00:00.000Z");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const code = (expected) => (error) => error instanceof PushError && error.code === expected && error.message === expected;
const result = (override = {}) => ({ exitCode: 0, signal: null, timedOut: false, stopped: false, groupGone: true,
  truncated: false, durationMs: 1, stdout: `*\trefs/heads/${branch}:refs/heads/${branch}\t[new branch]\n`, stderr: "", ...override });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

const cleanups = new WeakMap();
function temp(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-effect-test-")));
  t.after(async () => {
    for (const close of [...(cleanups.get(t) ?? [])].reverse()) await close();
    assert.ok(resolve(root).startsWith(resolve(fs.realpathSync(tmpdir())) + sep + "factory-effect-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function fixture(t, options = {}) {
  const root = temp(t);
  const storage = openStorage(options.file ? join(root, "state.db") : ":memory:");
  storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw; const hub = new EventHub(raw, { clock }); const calls = [];
  const projectId = randomUUID(); const taskId = randomUUID(); const attemptId = randomUUID();
  const seedProject = (id, clone) => {
    raw.prepare("INSERT INTO projects VALUES (?, 1, 'Push project', 'git', ?, 'active')").run(id, clone);
    hub.ensureStream(id);
  };
  const seedAttempt = (scope, id, task, candidate = branch, state = "done", clone = root) => {
    raw.prepare(`INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,origin_kind,state,required_capabilities_json,acceptance_json,inputs_json)
      VALUES (?, ?, 1, ?, 'Push task', 'Deliver', '', 'operator', ?, '[]', '[]', '[]')`)
      .run(scope, task, `PUSH-${String(raw.prepare("SELECT COUNT(*) AS n FROM tasks").get().n + 100)}`, state);
    raw.prepare(`INSERT INTO attempts (project_id,id,task_id,revision,epoch,state,outcome,runtime,provider,model,effort)
      VALUES (?, ?, ?, 1, 1, 'queued', 'known', 'fake', 'fake', 'fake', 'low')`).run(scope, id, task);
    if (candidate !== null) appendAttemptEvent(raw, { projectId: scope, attemptId: id, kind: "state",
      body: { to: "workspace-ready", branch: candidate, baseSha: tip }, at: clock().toISOString() });
    if (typeof candidate === "string" && candidate.startsWith("factory/") && !/[\s;|&`$\\]|\.\./.test(candidate)
      && !candidate.endsWith("/")) {
      const file = join(clone, ".git", "refs", "heads", candidate);
      fs.mkdirSync(join(file, ".."), { recursive: true }); fs.writeFileSync(file, `${tip}\n`);
    }
  };
  fs.mkdirSync(join(root, ".git")); fs.writeFileSync(join(root, ".git", "config"), "[core]\n\tbare = false\n");
  seedProject(projectId, root);
  seedAttempt(projectId, attemptId, taskId, options.branch === undefined ? branch : options.branch, options.taskState ?? "done");
  const remotes = options.remotes ?? [{ name: "operator", url: remoteUrl }];
  const runGit = async (input) => {
    calls.push(input);
    assert.equal(raw.inTransaction, false);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM effects").get().n > 0, true);
    if (input.args.includes("rev-parse")) return result({ stdout: `${options.verifiedTip ?? tip}\n` });
    return options.runGit ? options.runGit(input, calls) : result();
  };
  const make = (overrides = {}) => createEffectExecutor({ raw, hub, clock, newId: randomUUID, remotes,
    runGit, projectRootFor: () => options.noRoot ? null : root, ...overrides });
  const executor = make();
  cleanups.set(t, [async () => { await executor.close(); storage.close(); }]);
  const input = { projectId, attemptId, remote: "operator" };
  const push = (override = {}) => executor.requestPush({ ...input, ...override });
  const effects = () => raw.prepare("SELECT * FROM effects ORDER BY rowid").all();
  const events = () => raw.prepare("SELECT body_json FROM event_log").all().map((row) => JSON.parse(row.body_json));
  const unsafe = (value) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    for (const secret of [remoteUrl, sshCommand, root, privateText, "sk-synthetic-never-persist", "/private/synthetic-output"])
      assert.equal(text.includes(secret), false);
  };
  return { root, storage, raw, hub, projectId, taskId, attemptId, input, executor, make, push, effects, events, calls,
    seedProject, seedAttempt, unsafe };
}
async function api(t, f, enabled = true) {
  const sessions = createSessionStore(); const session = sessions.create();
  const app = createApiServer({ origins: originsFor(8787), sessions, gate: createBootstrapGate(), register(app, guards) {
    createRoutes({ storage: f.storage, hub: f.hub, pipeline: { execute() { throw new Error("unused"); } },
      ...(enabled ? { effects: f.executor } : {}) })(app, guards);
  } });
  cleanups.get(t).push(() => app.close());
  const headers = { host: "127.0.0.1:8787", cookie: `factory_session=${session.id}`, origin: "http://127.0.0.1:8787",
    "x-csrf-token": session.csrfToken, "content-type": "application/json" };
  const request = async (url, options = {}) => {
    const response = await app.inject({ url, ...options, headers: { ...headers, ...options.headers } });
    f.unsafe(response.body); f.unsafe(f.events()); return response;
  };
  return { app, request, headers, pushUrl: `/projects/${f.projectId}/attempts/${f.attemptId}/push`,
    reconcileUrl: (id) => `/projects/${f.projectId}/effects/${id}/reconcile` };
}

const accepted = [
  ["secure transport", remoteUrl], ["secure username", "https://operator@example.invalid/repo.git"],
  ["secure port", "https://example.invalid:8443/repo.git"], ["secure escaped path", "https://example.invalid/a%20b.git"],
  ["ssh transport", "ssh://example.invalid/repo.git"], ["ssh username", "ssh://git@example.invalid/repo.git"],
  ["ssh port", "ssh://git@example.invalid:2222/repo.git"], ["local transport", "file:///srv/mirrors/repo.git"],
  ["local escaped path", "file:///srv/mirrors/a%20b.git"], ["IPv6 transport", "ssh://git@[::1]/repo.git"],
];
for (const [label, url] of accepted) test(`remote config accepts ${label}`, () => {
  const parsed = parsePushRemotes(`operator=${url}`); assert.deepEqual(parsed, [{ name: "operator", url }]);
  assert.equal(describeRemote(parsed[0]), "operator");
});
const refused = [
  ["unknown transport", "custom://example.invalid/repo"], ["insecure transport", "http://example.invalid/repo"],
  ["transfer transport", "ftp://example.invalid/repo"], ["native transport", "git://example.invalid/repo"],
  ["short ssh syntax", "git@example.invalid:repo"], ["password", "https://user:synthetic@example.invalid/repo"],
  ["empty password", "ssh://git:@example.invalid/repo"], ["encoded password separator", "ssh://git%3Asecret@example.invalid/repo"],
  ["query", `${remoteUrl}?private`], ["empty query", `${remoteUrl}?`], ["fragment", `${remoteUrl}#private`],
  ["empty fragment", `${remoteUrl}#`], ["space", `${remoteUrl} private`], ["leading space", ` ${remoteUrl}`],
  ["tab", `${remoteUrl}\t`], ["line break", `${remoteUrl}\n`], ["carriage return", `${remoteUrl}\r`],
  ["zero byte", `${remoteUrl}\0`], ["delete control", `${remoteUrl}\x7f`], ["format control", `${remoteUrl}\u200b`],
  ["relative local path", "file:relative/repo"], ["local host", "file://example.invalid/repo"],
  ["local normalized host", "file://localhost/srv/repo"], ["local drive relative", "file:///C:relative"],
  ["missing host", "ssh:///repo"], ["dash host", "ssh://-option/repo"], ["backslash", "https://example.invalid/a\\b"],
  ["oversized URL", `https://example.invalid/${"a".repeat(300)}`], ["missing URL", ""],
];
for (const [label, value] of refused) test(`remote config refuses ${label} generically`, () => {
  assert.throws(() => parsePushRemotes(`operator=${value}`), (error) => {
    assert.equal(error.message, "FACTORY_PUSH_REMOTES must contain unique valid named remotes");
    if (value) assert.equal(error.message.includes(value), false); return true;
  });
});
for (const [label, value] of [
  ["duplicate names", `a=${remoteUrl},a=file:///srv/repo`], ["duplicate destinations", `a=${remoteUrl},b=${remoteUrl}`],
  ["normalized duplicate destinations", "a=https://EXAMPLE.invalid/repo,b=https://example.invalid/repo"],
  ["uppercase name", `Operator=${remoteUrl}`], ["underscore name", `a_b=${remoteUrl}`], ["dash prefix", `-a=${remoteUrl}`],
  ["long name", `${"a".repeat(41)}=${remoteUrl}`], ["missing name", `=${remoteUrl}`], ["missing separator", remoteUrl],
  ["empty configuration", ""], ["leading empty entry", `,a=${remoteUrl}`], ["trailing empty entry", `a=${remoteUrl},`],
  ["middle empty entry", `a=${remoteUrl},,b=file:///srv/repo`], ["name whitespace", ` a=${remoteUrl}`],
]) test(`remote config refuses ${label}`, () => {
  assert.throws(() => parsePushRemotes(value), { message: "FACTORY_PUSH_REMOTES must contain unique valid named remotes" });
});
test("remote config accepts boundary length names and ordered remotes", () => {
  const parsed = parsePushRemotes(`${"a".repeat(40)}=${remoteUrl},backup=file:///srv/backup`);
  assert.deepEqual(parsed.map(describeRemote), ["a".repeat(40), "backup"]);
});
test("environment parsing disables pushes by default", () => { assert.equal(parseEnv({}).pushRemotes, null); });
test("environment parsing carries operator configuration", () => {
  const parsed = parseEnv({ FACTORY_PUSH_REMOTES: `operator=${remoteUrl}`, FACTORY_PUSH_SSH_COMMAND: sshCommand });
  assert.deepEqual(parsed.pushRemotes, [{ name: "operator", url: remoteUrl }]); assert.equal(parsed.pushSshCommand, sshCommand);
});
for (const [label, value] of [["line break", "ssh\nprivate"], ["carriage return", "ssh\rprivate"], ["zero byte", "ssh\0private"]])
  test(`environment parsing refuses ssh command ${label}`, () => {
    assert.throws(() => parseEnv({ FACTORY_PUSH_SSH_COMMAND: value }),
      { message: "FACTORY_PUSH_SSH_COMMAND must not contain line breaks or NUL" });
  });

for (const [label, candidate] of [["default branch", "main"], ["uppercase default", "MAIN"], ["qualified default", "refs/heads/master"],
  ["unscoped branch", "feature/work"], ["parent traversal", "factory/a..b"], ["dash prefix", "-factory/work"],
  ["whitespace", "factory/a b"], ["command separator", "factory/a;b"], ["pipe", "factory/a|b"],
  ["substitution", "factory/$(private)"], ["backtick", "factory/`private`"], ["newline", "factory/a\nb"],
  ["hidden component", "factory/.hidden"], ["lock component", "factory/a.lock"], ["trailing dot", "factory/a."],
  ["empty component", "factory/a//b"], ["oversized branch", `factory/${"a".repeat(160)}`], ["nonstring branch", 42]])
  test(`push refuses ${label} before recording or executing`, async (t) => {
    const f = fixture(t, { branch: candidate }); await assert.rejects(f.push(), code("invalid-branch"));
    assert.equal(f.effects().length, 0); assert.equal(f.calls.length, 0);
  });
for (const [label, options, override, expected] of [
  ["unconfigured remote", {}, { remote: "unknown" }, "unknown-remote"],
  ["unknown attempt", {}, { attemptId: randomUUID() }, "not-found"],
  ["other project", {}, { projectId: randomUUID() }, "not-found"],
  ["unaccepted task", { taskState: "in-review" }, {}, "task-not-done"],
  ["missing workspace event", { branch: null }, {}, "workspace-not-ready"],
  ["unavailable clone", { noRoot: true }, {}, "workspace-unavailable"],
]) test(`push refuses ${label} without a record or process`, async (t) => {
  const f = fixture(t, options); await assert.rejects(f.push(override), code(expected));
  assert.equal(f.effects().length, 0); assert.equal(f.calls.length, 0);
});
test("push refuses a missing local branch before recording or executing", async (t) => {
  const f = fixture(t); fs.unlinkSync(join(f.root, ".git", "refs", "heads", branch));
  await assert.rejects(f.push(), code("branch-missing")); assert.equal(f.effects().length, 0); assert.equal(f.calls.length, 0);
});
test("write ahead is visible from a separate connection before every process", async (t) => {
  let f; f = fixture(t, { file: true, runGit: async () => {
    const reader = new Database(f.storage.file, { readonly: true });
    try { const row = reader.prepare("SELECT * FROM effects").get(); assert.equal(row.state, "pending");
      assert.equal(JSON.parse(row.target_json).tipSha, tip); } finally { reader.close(); }
    return result();
  } });
  assert.equal((await f.push()).state, "done"); assert.equal(f.events().length, 2);
});
test("idempotency during a pending push returns immediately", async (t) => {
  const gate = deferred(); const started = deferred(); const f = fixture(t, { runGit: async () => { started.resolve(); await gate.promise; return result(); } });
  const first = f.push(); await started.promise;
  const pending = await f.push(); assert.equal(pending.state, "pending"); assert.equal(f.calls.length, 2);
  gate.resolve(); assert.equal((await first).id, pending.id); assert.equal(f.effects().length, 1);
});
for (const state of ["done", "unknown"]) test(`idempotency preserves ${state} without another process`, async (t) => {
  const f = fixture(t, { runGit: async () => result(state === "unknown" ? { timedOut: true } : {}) });
  const first = await f.push(); const second = await f.push();
  assert.equal(first.state, state); assert.deepEqual(second, first); assert.equal(f.calls.length, 2); assert.equal(f.effects().length, 1);
});
test("failed effects get a fresh numbered idempotency key", async (t) => {
  const f = fixture(t, { runGit: async () => result({ exitCode: 1, stderr: "authentication failed" }) });
  const first = await f.push(); const second = await f.push(); assert.notEqual(first.id, second.id);
  assert.deepEqual(f.effects().map((row) => row.idempotency_key), [1, 2].map((n) => hash(`git.push-branch|${f.attemptId}|operator|${branch}|${n}`)));
});
test("push arguments use one explicit destination and one exact refspec", async (t) => {
  const f = fixture(t); await f.push(); const command = f.calls[1];
  const hooks = command.args[3].slice("core.hooksPath=".length);
  assert.deepEqual(command.args, ["-c", "credential.helper=", "-c", `core.hooksPath=${hooks}`, "-c", "core.fsmonitor=false",
    "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "push", "--porcelain", "--no-verify", "--no-follow-tags",
    remoteUrl, `refs/heads/${branch}:refs/heads/${branch}`]);
  assert.equal(command.command, "/usr/bin/git"); assert.equal(command.cwd, f.root); assert.equal(command.timeoutMs, 120_000);
  assert.equal(command.maxOutputBytes, 65536); assert.equal(fs.existsSync(hooks), false);
});
for (const [label, url, command] of [["secure", remoteUrl, sshCommand], ["local", "file:///srv/repo", sshCommand],
  ["ssh without command", "ssh://git@example.invalid/repo", undefined], ["ssh with command", "ssh://git@example.invalid/repo", sshCommand]])
  test(`push uses an exact clean environment for ${label}`, async (t) => {
    const f = fixture(t, { remotes: [{ name: "operator", url }] });
    const executor = f.make(command === undefined ? {} : { sshCommand: command }); t.after(() => executor.close());
    process.env.NINE_ROUTER_API_KEY = "synthetic-uninherited"; process.env.FACTORY_EFFECT_PRIVATE_TEST = "synthetic-uninherited";
    process.env.GIT_CONFIG_COUNT = "4"; process.env.SSH_ASKPASS = "synthetic-uninherited";
    try { await executor.requestPush(f.input); } finally {
      delete process.env.NINE_ROUTER_API_KEY; delete process.env.FACTORY_EFFECT_PRIVATE_TEST; delete process.env.GIT_CONFIG_COUNT; delete process.env.SSH_ASKPASS;
    }
    const env = f.calls[1].env;
    assert.deepEqual({ ...env }, { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: env.HOME, LANG: "C.UTF-8", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "",
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", ...(label === "ssh with command" ? { GIT_SSH_COMMAND: sshCommand } : {}) });
    assert.equal(f.calls[0].env.GIT_SSH_COMMAND, undefined); assert.equal(fs.existsSync(env.HOME), false);
  });
for (const [label, output, expected] of [
  ["authentication", "authentication failed", "auth"], ["permission", "Permission denied (publickey)", "auth"],
  ["access", "returned error: 403", "auth"], ["divergence", "[rejected] non-fast-forward", "rejected"],
  ["protected branch", "protected branch", "rejected"], ["remote rejection", "[remote rejected]", "rejected"],
  ["resolution", "Could not resolve host", "network"], ["connection", "connection refused", "network"],
  ["missing repository", "does not appear to be a git repository", "network"], ["unclassified", "synthetic refusal", "other"],
]) test(`push classifies ${label} and discards all raw output`, async (t) => {
  const f = fixture(t, { runGit: async () => result({ exitCode: 1, stdout: `${remoteUrl} ${privateText}`, stderr: `${output} ${sshCommand}` }) });
  const effect = await f.push(); assert.equal(effect.state, "failed"); assert.equal(effect.error, expected); assert.ok(effect.completedAt);
  f.unsafe(effect); f.unsafe(f.effects()); f.unsafe(f.events());
});
for (const [label, override, expected] of [["deadline", { timedOut: true }, "timeout"], ["interruption", { stopped: true }, "other"],
  ["surviving process", { groupGone: false }, "other"], ["missing exit", { exitCode: null }, "other"],
  ["bounded output", { truncated: true }, "other"], ["missing porcelain", { stdout: "" }, "other"]])
  test(`push preserves uncertainty after ${label}`, async (t) => {
    const f = fixture(t, { runGit: async () => result(override) }); const effect = await f.push();
    assert.equal(effect.state, "unknown"); assert.equal(effect.error, expected); assert.equal(effect.completedAt, null);
  });
test("exception after remote contact remains unknown and private", async (t) => {
  const f = fixture(t, { runGit: async () => { throw new Error(`${remoteUrl} ${privateText}`); } });
  const effect = await f.push(); assert.equal(effect.state, "unknown"); f.unsafe(effect); f.unsafe(f.effects()); f.unsafe(f.events());
});
test("up to date porcelain is a completed push", async (t) => {
  const f = fixture(t, { runGit: async () => result({ stdout: `=\trefs/heads/${branch}:refs/heads/${branch}\t[up to date]\n` }) });
  assert.equal((await f.push()).state, "done");
});
test("tip changed before local verification never contacts the remote", async (t) => {
  const f = fixture(t, { verifiedTip: "2".repeat(40) }); assert.equal((await f.push()).state, "failed"); assert.equal(f.calls.length, 1);
});
for (const [label, text, state, error] of [["matching tip", `${tip}\trefs/heads/${branch}\n`, "done", null],
  ["absent ref", "", "failed", "not-pushed"], ["different tip", `${"2".repeat(40)}\trefs/heads/${branch}\n`, "failed", "not-pushed"]])
  test(`reconcile resolves ${label}`, async (t) => {
    const f = fixture(t, { runGit: async (input) => result(input.args.includes("ls-remote") ? { stdout: text } : { timedOut: true }) });
    const pushed = await f.push(); const effect = await f.executor.reconcile({ projectId: f.projectId, effectId: pushed.id });
    assert.equal(effect.state, state); assert.equal(effect.error, error); assert.ok(effect.completedAt);
    const args = f.calls[2].args; assert.deepEqual(args.slice(-3), ["ls-remote", remoteUrl, `refs/heads/${branch}`]);
  });
for (const [label, override] of [["failed lookup", { exitCode: 1 }], ["lookup deadline", { timedOut: true }],
  ["truncated lookup", { truncated: true }], ["malformed lookup", { stdout: "untrusted output" }]])
  test(`reconcile leaves the row untouched for ${label}`, async (t) => {
    const f = fixture(t, { runGit: async (input) => result(input.args.includes("ls-remote") ? override : { timedOut: true }) });
    const effect = await f.push(); const before = f.effects(); const eventCount = f.events().length;
    await assert.rejects(f.executor.reconcile({ projectId: f.projectId, effectId: effect.id }), code("unreachable"));
    assert.deepEqual(f.effects(), before); assert.equal(f.events().length, eventCount);
  });
for (const state of ["pending", "done", "failed"]) test(`reconcile refuses ${state}`, async (t) => {
  const f = fixture(t, { runGit: async () => result(state === "failed" ? { exitCode: 1 } : {}) }); const effect = await f.push();
  if (state === "pending") {
    const other = randomUUID(); f.raw.prepare("INSERT INTO effects SELECT project_id, ?, attempt_id, kind, ?, target_json, 'pending', NULL, created_at, NULL FROM effects WHERE id = ?")
      .run(other, hash(other), effect.id);
    await assert.rejects(f.executor.reconcile({ projectId: f.projectId, effectId: other }), code("not-unknown"));
  } else await assert.rejects(f.executor.reconcile({ projectId: f.projectId, effectId: effect.id }), code("not-unknown"));
  assert.equal(f.calls.length, 2);
});
test("recovery changes only pending rows and publishes once", async (t) => {
  const f = fixture(t); await f.push(); const source = f.effects()[0];
  for (const state of ["pending", "unknown", "failed"]) f.raw.prepare(`INSERT INTO effects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(f.projectId, randomUUID(), f.attemptId, source.kind, hash(state), source.target_json, state,
      state === "failed" ? "other" : null, source.created_at, state === "failed" ? source.created_at : null);
  const before = f.effects(); const events = f.events().length; f.executor.recoverAtStart();
  assert.deepEqual(f.effects().map((row) => row.state), ["done", "unknown", "unknown", "failed"]);
  for (const index of [0, 2, 3]) assert.deepEqual(f.effects()[index], before[index]);
  assert.equal(f.events().length, events + 1); f.executor.recoverAtStart(); assert.equal(f.events().length, events + 1);
});
test("pushes in a project serialize across different attempts", async (t) => {
  const gate = deferred(); const started = deferred(); let running = 0; let max = 0;
  const f = fixture(t, { runGit: async (input) => { running++; max = Math.max(max, running); started.resolve(); await gate.promise; running--;
    const ref = input.args.at(-1); return result({ stdout: `*\t${ref}\t[new branch]\n` }); } });
  const another = randomUUID(); f.seedAttempt(f.projectId, another, randomUUID(), "factory/push-002-e1");
  const first = f.push(); await started.promise; const second = f.push({ attemptId: another });
  await new Promise(setImmediate); assert.equal(f.calls.length, 2); gate.resolve();
  assert.equal((await first).state, "done"); assert.equal((await second).state, "done"); assert.equal(max, 1);
});
test("shutdown rejects new pushes and waits for the in flight push", async (t) => {
  const gate = deferred(); const started = deferred(); const f = fixture(t, { runGit: async () => { started.resolve(); await gate.promise; return result(); } });
  const push = f.push(); await started.promise; let closed = false; const close = f.executor.close().then(() => { closed = true; });
  await assert.rejects(f.push(), code("not-available")); await new Promise(setImmediate); assert.equal(closed, false);
  gate.resolve(); await push; await close; assert.equal(closed, true);
});
test("effects expose only the documented public fields", async (t) => {
  const f = fixture(t); const effect = await f.push(); assert.deepEqual(Object.keys(effect).sort(),
    ["id", "attemptId", "kind", "remote", "branch", "state", "error", "createdAt", "completedAt"].sort());
  assert.deepEqual(f.executor.getEffect(f.projectId, effect.id), effect);
  assert.deepEqual(f.executor.listEffects(f.projectId, { attemptId: f.attemptId }), [effect]);
  assert.deepEqual(f.executor.listEffects(f.projectId, { attemptId: randomUUID() }), []);
  assert.equal(f.executor.getEffect(randomUUID(), effect.id), null); f.unsafe(effect);
});
for (const section of ["url", "include", "includeIf", "http", "credential", "protocol"]) test(`clone config refuses ${section} overrides`, async (t) => {
  const f = fixture(t); fs.appendFileSync(join(f.root, ".git", "config"), `[${section} "synthetic"]\n\tvalue = private\n`);
  await assert.rejects(f.push(), code("workspace-unavailable")); assert.equal(f.effects().length, 0); assert.equal(f.calls.length, 0);
});
test("packed local refs can supply the recorded tip", async (t) => {
  const f = fixture(t); fs.unlinkSync(join(f.root, ".git", "refs", "heads", branch));
  fs.writeFileSync(join(f.root, ".git", "packed-refs"), `# pack-refs with: peeled\n${tip} refs/heads/${branch}\n`);
  assert.equal((await f.push()).state, "done");
});
test("an enclosing transaction cannot start an effect", async (t) => {
  const f = fixture(t); let promise; f.raw.transaction(() => { promise = f.push(); promise.catch(() => {}); })();
  await assert.rejects(promise, code("not-available")); assert.equal(f.effects().length, 0); assert.equal(f.calls.length, 0);
});
for (const candidate of ["main", "MAIN", "master", "refs/heads/master"]) test(`database rejects forbidden branch variant ${candidate.replaceAll("/", " ")}`, async (t) => {
  const f = fixture(t); await f.push(); const row = f.effects()[0];
  assert.throws(() => f.raw.prepare("INSERT INTO effects VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)")
    .run(f.projectId, randomUUID(), f.attemptId, row.kind, hash(candidate), JSON.stringify({ remote: "operator", branch: candidate }), row.created_at));
});
test("database refuses reopening unknown and completed effects", async (t) => {
  const f = fixture(t, { runGit: async () => result({ timedOut: true }) }); const effect = await f.push();
  assert.throws(() => f.raw.prepare("UPDATE effects SET state = 'pending' WHERE id = ?").run(effect.id));
  f.raw.prepare("UPDATE effects SET state = 'done', completed_at = ? WHERE id = ?").run(clock().toISOString(), effect.id);
  assert.throws(() => f.raw.prepare("UPDATE effects SET state = 'unknown' WHERE id = ?").run(effect.id));
});

for (const route of ["remotes", "project list", "attempt list", "push", "reconcile"]) test(`operator ${route} route requires a session`, async (t) => {
  const f = fixture(t); const a = await api(t, f); const url = { remotes: "/effects/remotes", "project list": `/projects/${f.projectId}/effects`,
    "attempt list": `/projects/${f.projectId}/attempts/${f.attemptId}/effects`, push: a.pushUrl, reconcile: a.reconcileUrl(randomUUID()) }[route];
  const response = await a.request(url, { ...(route === "push" || route === "reconcile" ? { method: "POST", payload: {} } : {}), headers: { cookie: "" } });
  assert.equal(response.statusCode, 401);
});
for (const [label, headers] of [["missing origin", { origin: "" }], ["foreign origin", { origin: "https://foreign.invalid" }],
  ["missing csrf", { "x-csrf-token": "" }], ["wrong csrf", { "x-csrf-token": "synthetic-wrong" }]])
  for (const route of ["push", "reconcile"]) test(`operator ${route} refuses ${label}`, async (t) => {
    const f = fixture(t); const a = await api(t, f); const response = await a.request(route === "push" ? a.pushUrl : a.reconcileUrl(randomUUID()),
      { method: "POST", payload: { remote: "operator" }, headers });
    assert.equal(response.statusCode, 403); assert.equal(f.effects().length, 0); assert.equal(f.calls.length, 0);
  });
for (const [label, payload] of [["extra fields", { remote: "operator", url: remoteUrl }], ["missing remote", {}],
  ["nonstring remote", { remote: 1 }], ["array body", []], ["URL as name", { remote: remoteUrl }]])
  test(`push route validates ${label} without echoes`, async (t) => {
    const f = fixture(t); const a = await api(t, f); const response = await a.request(a.pushUrl, { method: "POST", payload });
    assert.equal(response.statusCode, 400); assert.equal(f.effects().length, 0); assert.equal(f.calls.length, 0);
  });
for (const route of ["push", "reconcile"]) test(`feature off makes ${route} unavailable`, async (t) => {
  const f = fixture(t); const a = await api(t, f, false); const response = await a.request(route === "push" ? a.pushUrl : a.reconcileUrl(randomUUID()),
    { method: "POST", payload: { remote: "operator" } });
  assert.equal(response.statusCode, 404); assert.equal(response.json().error.message, "not-available"); assert.equal(f.calls.length, 0);
});
for (const enabled of [true, false]) test(`remote names route with feature ${enabled ? "on" : "off"} exposes names only`, async (t) => {
  const f = fixture(t); const a = await api(t, f, enabled); const response = await a.request("/effects/remotes");
  assert.deepEqual(response.json(), { apiVersion: 1, ok: true, remotes: enabled ? ["operator"] : [] });
});
test("push and list routes are idempotent and private", async (t) => {
  const f = fixture(t); const a = await api(t, f); const response = await a.request(a.pushUrl, { method: "POST", payload: { remote: "operator" } });
  assert.equal(response.statusCode, 200); const again = await a.request(a.pushUrl, { method: "POST", payload: { remote: "operator" } });
  assert.deepEqual(again.json(), response.json());
  for (const url of [`/projects/${f.projectId}/effects`, `/projects/${f.projectId}/attempts/${f.attemptId}/effects`]) {
    const list = await a.request(url); assert.equal(list.statusCode, 200); assert.deepEqual(list.json().effects, [response.json().effect]);
  }
  f.unsafe(f.effects()); assert.equal(f.calls.length, 2);
});
test("reconcile route resolves uncertainty without exposing raw output", async (t) => {
  const f = fixture(t, { runGit: async (input) => result(input.args.includes("ls-remote") ? { stdout: `${tip}\trefs/heads/${branch}\n` } : { timedOut: true }) });
  const effect = await f.push(); const a = await api(t, f); const response = await a.request(a.reconcileUrl(effect.id), { method: "POST", payload: {} });
  assert.equal(response.statusCode, 200); assert.equal(response.json().effect.state, "done");
});
test("reconcile route reports unreachable without changing the row", async (t) => {
  const f = fixture(t, { runGit: async (input) => result(input.args.includes("ls-remote") ? { exitCode: 1, stderr: privateText } : { timedOut: true }) });
  const effect = await f.push(); const before = f.effects(); const a = await api(t, f);
  const response = await a.request(a.reconcileUrl(effect.id), { method: "POST", payload: {} });
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.message, "unreachable"); assert.deepEqual(f.effects(), before);
});
for (const [label, options, remote, status, expected] of [["unknown remote", {}, "unknown", 400, "unknown-remote"],
  ["unaccepted task", { taskState: "in-review" }, "operator", 409, "task-not-done"],
  ["missing event", { branch: null }, "operator", 409, "workspace-not-ready"]])
  test(`push route maps ${label} to a fixed failure`, async (t) => {
    const f = fixture(t, options); const a = await api(t, f); const response = await a.request(a.pushUrl, { method: "POST", payload: { remote } });
    assert.equal(response.statusCode, status); assert.equal(response.json().error.message, expected);
  });
test("reconcile refuses when the remote name now points to a different destination than the one pushed to", async (t) => {
  const f = fixture(t, { runGit: async (input) => result(input.args.includes("ls-remote") ? { stdout: `${tip}\trefs/heads/${branch}\n` } : { timedOut: true }) });
  const effect = await f.push(); assert.equal(effect.state, "unknown");
  const repointed = f.make({ remotes: [{ name: "operator", url: "https://example.invalid/someone-else/repository.git" }] });
  const before = f.effects(); const calls = f.calls.length;
  await assert.rejects(repointed.reconcile({ projectId: f.projectId, effectId: effect.id }), code("unreachable"));
  assert.equal(f.calls.length, calls, "the other destination must never be contacted"); assert.deepEqual(f.effects(), before);
  const removed = f.make({ remotes: [{ name: "elsewhere", url: remoteUrl }] });
  await assert.rejects(removed.reconcile({ projectId: f.projectId, effectId: effect.id }), code("unreachable")); assert.equal(f.calls.length, calls);
});
for (const [section, key] of [["core", "sshCommand"], ["core", "gitProxy"], ["core", "askPass"], ["core", "alternateRefsCommand"],
  ["core", "pager"], ["core", "editor"], ["user", "signingKey"], ["remote \"origin\"", "proxy"], ["remote \"origin\"", "receivepack"],
  ["remote \"origin\"", "uploadpack"], ["remote \"origin\"", "pushInsteadOf"], ["branch \"main\"", "pushRemote"]])
  test(`clone config refuses the key ${section.split(" ")[0]}.${key} inside an allowed section`, async (t) => {
    const f = fixture(t); fs.appendFileSync(join(f.root, ".git", "config"), `[${section}]\n\t${key} = synthetic\n`);
    await assert.rejects(f.push(), code("workspace-unavailable")); assert.equal(f.effects().length, 0); assert.equal(f.calls.length, 0);
  });
for (const [section, key] of [["core", "filemode"], ["user", "email"], ["remote \"origin\"", "url"], ["branch \"main\"", "merge"]])
  test(`clone config still accepts the harmless key ${section.split(" ")[0]}.${key}`, async (t) => {
    const f = fixture(t); fs.appendFileSync(join(f.root, ".git", "config"), `[${section}]\n\t${key} = value\n`);
    assert.equal((await f.push()).state, "done");
  });
