import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { buildSandboxCommand, SandboxError, isSandboxAvailable, startSandboxed, SANDBOX_RELAY_PORT } from "../dist/sandbox/index.js";

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-sandbox-builder-")));
  t.after(() => { assert.ok(root.includes("factory-sandbox-builder-")); fs.rmSync(root, { recursive: true, force: true }); });
  const spec = {
    bwrapPath: join(root, "bwrap"), workspace: join(root, "worktrees", "attempt"),
    roots: { worktreesRoot: join(root, "worktrees"), projectsRoot: join(root, "projects"), stateDir: join(root, "state") },
    readOnlyBinds: [{ host: join(root, "node"), guest: "/opt/node" }], env: { ATTEMPT: "one" },
    command: "/opt/node/bin/node", args: ["-e", "process.stdout.write('ok')"],
  };
  fs.mkdirSync(spec.workspace, { recursive: true });
  return { root, spec };
}
function refusal(spec) {
  assert.throws(() => buildSandboxCommand(spec), (error) => {
    assert.ok(error instanceof SandboxError); assert.equal(error.code, "invalid-spec");
    assert.equal(error.message, "invalid-spec"); return true;
  });
}
function environment(args) {
  const env = {};
  for (let i = 0; i < args.indexOf("--"); i++) if (args[i] === "--setenv") { env[args[i + 1]] = args[i + 2]; i += 2; }
  return env;
}

test("builder emits the complete mount and environment layout in order", (t) => {
  const { root, spec } = fixture(t);
  spec.readOnlyBinds.push({ host: join(root, "opencode"), guest: "/opt/opencode" }, { host: join(root, "relay.js"), guest: "/opt/factory/relay.js" });
  spec.gitDirs = { common: join(spec.roots.projectsRoot, "clone", ".git"), worktree: join(spec.roots.projectsRoot, "clone", ".git", "worktrees", "attempt") };
  spec.socket = { host: join(root, "proxy", "model.sock"), guest: "/opt/factory/model.sock" };
  const expected = ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv", "--ro-bind", "/usr", "/usr"];
  for (const name of ["bin", "sbin", "lib", "lib64"])
    if (fs.existsSync(`/${name}`) && fs.lstatSync(`/${name}`).isSymbolicLink()) expected.push("--symlink", `usr/${name}`, `/${name}`);
  for (const name of ["passwd", "group", "nsswitch.conf", "ld.so.cache", "localtime"])
    if (fs.existsSync(`/etc/${name}`)) expected.push("--ro-bind", `/etc/${name}`, `/etc/${name}`);
  expected.push("--proc", "/proc", "--dev", "/dev", "--size", String(256 * 1024 * 1024), "--tmpfs", "/tmp", "--size", String(512 * 1024 * 1024), "--tmpfs", "/home/agent");
  for (const bind of spec.readOnlyBinds) expected.push("--ro-bind", bind.host, bind.guest);
  expected.push("--bind", spec.workspace, spec.workspace, "--ro-bind", spec.gitDirs.common, spec.gitDirs.common,
    "--bind", spec.gitDirs.worktree, spec.gitDirs.worktree, "--bind", spec.socket.host, spec.socket.guest, "--remount-ro", "/",
    "--setenv", "ATTEMPT", "one", "--setenv", "HOME", "/home/agent",
    "--setenv", "XDG_CONFIG_HOME", "/home/agent/config", "--setenv", "XDG_DATA_HOME", "/home/agent/data",
    "--setenv", "XDG_STATE_HOME", "/home/agent/state", "--setenv", "XDG_CACHE_HOME", "/home/agent/cache",
    "--setenv", "TMPDIR", "/tmp", "--setenv", "LANG", "C.UTF-8", "--setenv", "PATH", "/opt/node/bin:/opt/opencode/bin:/usr/bin:/bin",
    "--chdir", spec.workspace, "--", spec.command, ...spec.args);
  assert.deepEqual(buildSandboxCommand(spec), { command: spec.bwrapPath, args: expected });
});

const invalidSpecs = [
  ["missing spec", () => null], ["missing roots", (s) => ({ ...s, roots: undefined })],
  ["workspace outside boundary", (s, r) => ({ ...s, workspace: join(r, "other") })],
  ["workspace equals boundary", (s) => ({ ...s, workspace: s.roots.worktreesRoot })],
  ["workspace sibling prefix", (s) => ({ ...s, workspace: `${s.roots.worktreesRoot}-other/attempt` })],
  ["workspace traversal", (s) => ({ ...s, workspace: `${s.workspace}/../escape` })],
  ["workspace relative", (s) => ({ ...s, workspace: "relative" })],
  ["workspace zero byte", (s) => ({ ...s, workspace: `${s.workspace}\0` })],
  ["workspace dot component", (s) => ({ ...s, workspace: `${s.workspace}/.` })],
  ["workspace trailing separator", (s) => ({ ...s, workspace: `${s.workspace}/` })],
  ["binary relative", (s) => ({ ...s, bwrapPath: "bwrap" })],
  ["binary traversal", (s) => ({ ...s, bwrapPath: `${s.bwrapPath}/../bwrap` })],
  ["binary zero byte", (s) => ({ ...s, bwrapPath: `${s.bwrapPath}\0` })],
  ["state overlaps worktrees", (s) => ({ ...s, roots: { ...s.roots, stateDir: s.workspace } })],
  ["projects overlaps worktrees", (s) => ({ ...s, roots: { ...s.roots, projectsRoot: s.roots.worktreesRoot } })],
  ["workdir outside", (s, r) => ({ ...s, workdir: r })],
  ["workdir relative", (s) => ({ ...s, workdir: "relative" })],
  ["workdir traversal", (s) => ({ ...s, workdir: `${s.workspace}/../other` })],
  ["missing binds", (s) => ({ ...s, readOnlyBinds: undefined })],
  ["too many binds", (s, r) => ({ ...s, readOnlyBinds: Array.from({ length: 17 }, (_, i) => ({ host: join(r, `tool-${i}`), guest: `/opt/tool-${i}` })) })],
  ["duplicate guests", (s) => ({ ...s, readOnlyBinds: [s.readOnlyBinds[0], s.readOnlyBinds[0]] })],
  ["relative host bind", (s) => ({ ...s, readOnlyBinds: [{ host: "relative", guest: "/opt/tool" }] })],
  ["zero byte host bind", (s, r) => ({ ...s, readOnlyBinds: [{ host: `${r}\0`, guest: "/opt/tool" }] })],
  ["parent host bind", (s, r) => ({ ...s, readOnlyBinds: [{ host: r, guest: "/opt/tool" }] })],
  ["state host bind", (s) => ({ ...s, readOnlyBinds: [{ host: s.roots.stateDir, guest: "/opt/tool" }] })],
  ["state descendant bind", (s) => ({ ...s, readOnlyBinds: [{ host: join(s.roots.stateDir, "data"), guest: "/opt/tool" }] })],
  ["worktrees host bind", (s) => ({ ...s, readOnlyBinds: [{ host: s.roots.worktreesRoot, guest: "/opt/tool" }] })],
  ["other worktree bind", (s) => ({ ...s, readOnlyBinds: [{ host: join(s.roots.worktreesRoot, "other"), guest: "/opt/tool" }] })],
  ["projects host bind", (s) => ({ ...s, readOnlyBinds: [{ host: s.roots.projectsRoot, guest: "/opt/tool" }] })],
  ["other project bind", (s) => ({ ...s, readOnlyBinds: [{ host: join(s.roots.projectsRoot, "other"), guest: "/opt/tool" }] })],
  ["home host bind", (s) => ({ ...s, readOnlyBinds: [{ host: fs.realpathSync(homedir()), guest: "/opt/tool" }] })],
  ["missing environment", (s) => ({ ...s, env: undefined })], ["array environment", (s) => ({ ...s, env: [] })],
  ["oversized environment", (s) => ({ ...s, env: { LARGE: "x".repeat(65536) } })],
  ["empty command", (s) => ({ ...s, command: "" })], ["relative command", (s) => ({ ...s, command: "bin/tool" })],
  ["parent command", (s) => ({ ...s, command: "/opt/../bin/tool" })], ["dot command", (s) => ({ ...s, command: "/opt/./tool" })],
  ["zero byte command", (s) => ({ ...s, command: "tool\0" })], ["newline command", (s) => ({ ...s, command: "tool\n" })],
  ["backslash command", (s) => ({ ...s, command: "bin\\tool" })], ["flag command", (s) => ({ ...s, command: "--tool" })],
  ["missing arguments", (s) => ({ ...s, args: undefined })], ["non-string argument", (s) => ({ ...s, args: [1] })],
  ["zero byte argument", (s) => ({ ...s, args: ["value\0"] })],
  ["git common outside", (s, r) => ({ ...s, gitDirs: { common: r, worktree: join(r, "worktrees", "attempt") } })],
  ["git common equals boundary", (s) => ({ ...s, gitDirs: { common: s.roots.projectsRoot, worktree: join(s.roots.projectsRoot, "worktrees", "attempt") } })],
  ["git writable directory outside", (s) => ({ ...s, gitDirs: { common: join(s.roots.projectsRoot, "clone", ".git"), worktree: s.workspace } })],
  ["git writable directory from another project", (s) => ({ ...s, gitDirs: { common: join(s.roots.projectsRoot, "clone", ".git"), worktree: join(s.roots.projectsRoot, "other", ".git") } })],
  ["socket directory bind", (s, r) => ({ ...s, socket: { host: r, guest: "/opt/model.sock" } })],
  ["relative socket host", (s) => ({ ...s, socket: { host: "relative", guest: "/opt/model.sock" } })],
  ["socket duplicate guest", (s, r) => ({ ...s, socket: { host: join(r, "proxy", "socket"), guest: "/opt/node" } })],
];
for (const [label, change] of invalidSpecs) test(`builder refuses ${label} generically`, (t) => {
  const { spec, root } = fixture(t); refusal(change(spec, root));
});

for (const [label, path] of [["root", "/"], ["configuration", "/etc"], ["root home", "/root"], ["drive mount", "/mnt"],
  ["runtime", "/run"], ["process filesystem", "/proc"], ["system filesystem", "/sys"], ["devices", "/dev"]])
  test(`builder refuses protected host ${label}`, (t) => {
    const { spec } = fixture(t); spec.readOnlyBinds = [{ host: resolve(path), guest: "/opt/tool" }]; refusal(spec);
  });
for (const [label, path] of [["relative", "relative"], ["root", "/"], ["configuration", "/etc/tool"], ["system", "/usr/tool"],
  ["devices", "/dev/tool"], ["processes", "/proc/tool"], ["temporary", "/tmp/tool"], ["agent home", "/home/agent/tool"],
  ["home ancestor", "/home"], ["traversal", "/opt/../tool"], ["dot", "/opt/./tool"], ["zero byte", "/opt/to\0ol"],
  ["duplicate separator", "/opt//tool"], ["trailing separator", "/opt/tool/"], ["backslash", "/opt\\tool"]])
  test(`builder refuses guest ${label}`, (t) => {
    const { spec } = fixture(t); spec.readOnlyBinds[0].guest = path; refusal(spec);
  });
for (const [label, name, value] of [["empty name", "", "x"], ["numeric name", "1NAME", "x"], ["punctuation", "BAD-NAME", "x"],
  ["key name", "API_KEY", "x"], ["token name", "ACCESS_TOKEN", "x"], ["secret name", "secret", "x"],
  ["password name", "PASSWORD", "x"], ["passwd name", "PASSWD", "x"], ["credential name", "CREDENTIAL", "x"],
  ["auth name", "AUTHORIZATION", "x"], ["cookie name", "COOKIE", "x"], ["newline value", "VALUE", "x\ny"],
  ["carriage return value", "VALUE", "x\ry"], ["zero byte value", "VALUE", "x\0y"], ["non-string value", "VALUE", 1]])
  test(`builder refuses environment ${label}`, (t) => {
    const { spec } = fixture(t); spec.env = { [name]: value }; refusal(spec);
  });
for (const name of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "TMPDIR", "LANG", "PATH"])
  test(`builder owns fixed variable ${name}`, (t) => {
    const { spec } = fixture(t); const baseline = environment(buildSandboxCommand(spec).args);
    spec.env[name] = "override"; const args = buildSandboxCommand(spec).args;
    assert.equal(environment(args)[name], baseline[name]);
    assert.equal(args.filter((value, i) => value === name && args[i - 1] === "--setenv").length, 1);
  });
test("builder permits the two explicit model configuration names", (t) => {
  const { spec } = fixture(t); spec.env = { FACTORY_MODEL_TOKEN: "synthetic", OPENCODE_CONFIG_CONTENT: "{}" };
  assert.equal(environment(buildSandboxCommand(spec).args).FACTORY_MODEL_TOKEN, "synthetic");
});
test("builder constructs PATH from mounted tool directories", (t) => {
  const { spec } = fixture(t); spec.readOnlyBinds = [];
  assert.equal(environment(buildSandboxCommand(spec).args).PATH, "/usr/bin:/bin");
});
test("builder keeps every caller supplied bind read-only", (t) => {
  const { spec } = fixture(t); const args = buildSandboxCommand(spec).args;
  assert.equal(args[args.indexOf(spec.readOnlyBinds[0].host) - 1], "--ro-bind");
  assert.ok(args.includes("--clearenv")); assert.equal(args.includes("/etc"), false);
});
test("builder allows exactly sixteen tool binds", (t) => {
  const { spec, root } = fixture(t);
  spec.readOnlyBinds = Array.from({ length: 16 }, (_, i) => ({ host: join(root, `tool-${i}`), guest: `/opt/tool-${i}` }));
  assert.doesNotThrow(() => buildSandboxCommand(spec));
});
test("builder leaves input objects unchanged and accepts bare commands and literal arguments", (t) => {
  const { spec } = fixture(t); spec.command = "node"; spec.args = ["", "line\nbreak", "$(literal)", "--"];
  const before = structuredClone(spec); const a = buildSandboxCommand(spec); const b = buildSandboxCommand(spec);
  assert.deepEqual(a, b); assert.deepEqual(spec, before); assert.deepEqual(a.args.slice(-5), ["node", ...spec.args]);
});
test("builder accepts a workdir inside the workspace", (t) => {
  const { spec } = fixture(t); spec.workdir = join(spec.workspace, "src");
  const args = buildSandboxCommand(spec).args; assert.equal(args[args.indexOf("--chdir") + 1], spec.workdir);
});
test("builder refuses symlink escapes in workspace and tool paths", (t) => {
  const { spec, root } = fixture(t); const outside = join(root, "outside"); fs.mkdirSync(outside);
  const alias = join(spec.roots.worktreesRoot, "alias"); fs.symlinkSync(outside, alias, process.platform === "win32" ? "junction" : "dir");
  refusal({ ...spec, workspace: alias });
  refusal({ ...spec, readOnlyBinds: [{ host: alias, guest: "/opt/tool" }] });
});
test("sandbox availability never throws for a missing binary", async () => {
  assert.equal(await isSandboxAvailable(resolve("nonexistent-sandbox-executable")), false);
});
test("sandbox runtime refuses unsupported platforms", { skip: process.platform === "linux" }, (t) => {
  const { spec } = fixture(t); assert.throws(() => startSandboxed({ spec }), (error) => error.code === "unavailable");
});
test("sandbox relay has a stable exported port", () => assert.equal(SANDBOX_RELAY_PORT, 18787));

test("builder allows a single socket capability in a dedicated private state directory", (t) => {
  const { spec } = fixture(t); spec.socket = { host: join(spec.roots.stateDir, "proxy", "model.sock"), guest: "/opt/factory/model.sock" };
  assert.doesNotThrow(() => buildSandboxCommand(spec));
});
for (const wrapped of [false, true]) test(`sandbox runner passes an exact host environment with relay wrapping ${wrapped}`,
  { skip: process.platform !== "linux" ? "Runner requires Linux" : false }, (t) => {
  const { spec, root } = fixture(t);
  if (wrapped) {
    spec.readOnlyBinds.push({ host: join(root, "relay.js"), guest: "/opt/factory/relay.js" });
    spec.socket = { host: join(root, "proxy", "model.sock"), guest: "/opt/factory/model.sock" };
  }
  let captured;
  t.mock.method(childProcess, "spawn", (command, args, options) => { captured = { command, args, options }; throw new Error("synthetic spawn failure"); });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.throws(() => startSandboxed({ spec }), (error) => error.code === "spawn-failed");
  assert.equal(captured.command, spec.bwrapPath); assert.deepEqual(Object.keys(captured.options.env), ["PATH"]);
  assert.equal(captured.options.env.PATH, "/usr/bin:/bin"); assert.equal(captured.options.cwd, spec.workspace);
  assert.equal(captured.options.detached, true); assert.equal(captured.options.shell, false);
  const tail = captured.args.slice(captured.args.indexOf("--") + 1);
  assert.deepEqual(tail, wrapped ? ["/opt/node/bin/node", "/opt/factory/relay.js", "--listen", "18787", "--socket",
    spec.socket.guest, "--", spec.command, ...spec.args] : [spec.command, ...spec.args]);
});
// A socket without the relay and node mounts would start a sandbox that silently has no model path.
for (const missing of ["/opt/node", "/opt/factory/relay.js"]) test(`sandbox runner refuses a socket spec without the ${missing} mount`,
  { skip: process.platform !== "linux" ? "Runner requires Linux" : false }, (t) => {
  const { spec, root } = fixture(t);
  spec.readOnlyBinds.push({ host: join(root, "relay.js"), guest: "/opt/factory/relay.js" });
  spec.readOnlyBinds = spec.readOnlyBinds.filter((bind) => bind.guest !== missing);
  spec.socket = { host: join(root, "proxy", "model.sock"), guest: "/opt/factory/model.sock" };
  let spawned = false;
  t.mock.method(childProcess, "spawn", () => { spawned = true; throw new Error("must not spawn"); });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.throws(() => startSandboxed({ spec }), (error) => error.code === "invalid-spec");
  assert.equal(spawned, false);
});
