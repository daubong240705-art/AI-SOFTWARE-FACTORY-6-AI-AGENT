import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { describe, test } from "node:test";
import { ExecError, startProcess, runToCompletion, buildSafeEnv, scrubForLog } from "../dist/exec/index.js";

const linux = process.platform === "linux";
const cwd = fs.realpathSync(process.cwd());
const defaults = { command: process.execPath, args: [], cwd, env: {} };
const validationDefaults = { ...defaults, command: "/bin/sh" };
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const errorCode = (code) => (error) => error instanceof ExecError && error.code === code;

function temp(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "factory-exec-test-"));
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + "factory-exec-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return fs.realpathSync(root);
}

// Only invalid inputs are run with this override: no Linux child can be launched on Windows.
function validateAsLinux(t) {
  if (linux) return;
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "linux" });
  t.after(() => Object.defineProperty(process, "platform", descriptor));
}

function launch(t, options) {
  const handle = startProcess({ ...defaults, killGraceMs: 120, killDeadlineMs: 3000, ...options });
  t.after(async () => { await handle.stop().catch(() => undefined); await handle.result; });
  return handle;
}
const node = (t, source, options = {}) => launch(t, { command: process.execPath, args: ["-e", source], ...options });
const sh = (t, source, options = {}) => launch(t, { command: "/bin/sh", args: ["-c", source], env: { PATH: "/usr/bin:/bin" }, ...options });

async function until(predicate, timeoutMs = 3000) {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, "condition did not become true before the deadline");
    await delay(10);
  }
}

function gone(pid) {
  assert.ok(pid > 0);
  assert.throws(() => process.kill(-pid, 0), (error) => error.code === "ESRCH");
}

function members(pgid) {
  const found = [];
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${entry}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(fields[2]) === pgid) found.push(Number(entry));
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
    }
  }
  return found;
}

test("runner refuses the current non-Linux platform with a typed error", (t) => {
  if (linux) {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });
    t.after(() => Object.defineProperty(process, "platform", descriptor));
  }
  assert.throws(() => startProcess(defaults), errorCode("unsupported-platform"));
});

for (const [name, patch] of [
  ["empty command", { command: "" }],
  ["whitespace command", { command: "  " }],
  ["command NUL", { command: "bad\0name" }],
  ["relative command containing slash", { command: "bin/sh" }],
  ["command traversal", { command: "../sh" }],
  ["absolute command traversal", { command: "/bin/../bin/sh" }],
  ["backslash tricks", { command: "bad\\name" }],
  ["bare name without explicit PATH", { command: "sh" }],
  ["args not an array", { args: "bad" }],
  ["non-string argument", { args: [5] }],
  ["argument NUL", { args: ["a\0b"] }],
  ["sparse arguments", { args: Array(1) }],
  ["257 arguments", { args: Array(257).fill("a") }],
  ["relative cwd", { cwd: "relative" }],
  ["missing cwd", { cwd: join(cwd, "missing-exec-cwd") }],
  ["cwd NUL", { cwd: `${cwd}\0` }],
  ["invalid env name", { env: { "BAD-NAME": "value" } }],
  ["empty env name", { env: { "": "value" } }],
  ["env name starting with a digit", { env: { "9NAME": "value" } }],
  ["non-string env value", { env: { VALUE: 7 } }],
  ["env NUL", { env: { VALUE: "a\0b" } }],
  ["env missing", { env: undefined }],
  ["env array", { env: [] }],
  ["env over 64 KiB", { env: { VALUE: "x".repeat(65536) } }],
  ["env byte limit includes UTF-8", { env: { VALUE: "€".repeat(22000) } }],
  ["zero timeout", { timeoutMs: 0 }],
  ["negative timeout", { timeoutMs: -1 }],
  ["timeout over six hours", { timeoutMs: 21_600_001 }],
  ["infinite timeout", { timeoutMs: Infinity }],
  ["NaN timeout", { timeoutMs: NaN }],
  ["fractional timeout", { timeoutMs: 1.5 }],
  ["null timeout", { timeoutMs: null }],
  ["negative output cap", { maxOutputBytes: -1 }],
  ["output cap over 16 MiB", { maxOutputBytes: 16 * 1024 * 1024 + 1 }],
  ["fractional output cap", { maxOutputBytes: 1.5 }],
  ["negative kill grace", { killGraceMs: -1 }],
  ["NaN kill grace", { killGraceMs: NaN }],
  ["overflowing kill grace", { killGraceMs: 2_147_483_648 }],
  ["zero kill deadline", { killDeadlineMs: 0 }],
  ["infinite kill deadline", { killDeadlineMs: Infinity }],
  ["non-string stdin", { stdin: 12 }],
  ["non-function observer", { onOutput: "bad" }],
]) test(`invalid options: ${name} (also checked on Windows)`, (t) => {
  validateAsLinux(t);
  assert.throws(() => startProcess({ ...validationDefaults, ...patch }), errorCode("invalid-options"));
});

test("invalid options: missing options object", (t) => {
  validateAsLinux(t);
  assert.throws(() => startProcess(null), errorCode("invalid-options"));
});

test("invalid options: cwd is a file", (t) => {
  const root = temp(t); const file = join(root, "file"); fs.writeFileSync(file, "fixture");
  validateAsLinux(t);
  assert.throws(() => startProcess({ ...validationDefaults, cwd: file }), errorCode("invalid-options"));
});

test("safe env contains only fixed defaults and a new private temporary HOME", (t) => {
  const env = buildSafeEnv();
  t.after(() => {
    assert.ok(resolve(env.HOME).startsWith(resolve(tmpdir()) + sep + "factory-exec-home-"));
    fs.rmSync(env.HOME, { recursive: true, force: true });
  });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH"]);
  assert.equal(env.PATH, "/usr/local/bin:/usr/bin:/bin"); assert.equal(env.LANG, "C.UTF-8");
  assert.ok(isAbsolute(env.HOME)); assert.ok(fs.statSync(env.HOME).isDirectory());
  if (linux) assert.equal(fs.statSync(env.HOME).mode & 0o777, 0o700);
});

test("safe env accepts caller HOME and explicit overrides without mutating input", () => {
  const extra = Object.freeze({ HOME: cwd, LANG: "en_US.UTF-8", PATH: "/bin", CUSTOM: "yes" });
  assert.deepEqual(buildSafeEnv(extra), extra);
});

for (const key of ["API_KEY", "token", "MY_SECRET", "PASSWORD", "PASSWD", "CREDENTIALS", "AUTHORIZATION", "COOKIE_JAR"])
  test(`safe env refuses secret carrier ${key}`, () => {
    assert.throws(() => buildSafeEnv({ HOME: cwd, [key]: "synthetic" }), errorCode("invalid-options"));
  });

test("safe env allow-list requires exact opt-in by name", () => {
  assert.equal(buildSafeEnv({ HOME: cwd, API_KEY: "synthetic" }, ["API_KEY"]).API_KEY, "synthetic");
  assert.throws(() => buildSafeEnv({ HOME: cwd, API_KEY: "synthetic" }, ["api_key"]), errorCode("invalid-options"));
  assert.throws(() => buildSafeEnv({ HOME: cwd, API_KEY: "synthetic", TOKEN: "synthetic" }, ["API_KEY"]), errorCode("invalid-options"));
});

test("safe env rejects malformed entries and relative HOME", () => {
  for (const extra of [null, [], { "BAD-NAME": "x" }, { NAME: 1 }, { NAME: "x\0y" }, { HOME: "relative" }])
    assert.throws(() => buildSafeEnv(extra), errorCode("invalid-options"));
});

test("scrub replaces every literal occurrence and ignores short or empty values", () => {
  assert.equal(scrubForLog("abc123 abc123 .*+?() safe short", ["abc123", ".*+?()", "", "short"]),
    "[redacted] [redacted] [redacted] safe short");
});

test("scrub covers overlapping occurrences and leaves unrelated text alone", () => {
  assert.equal(scrubForLog("longsecret-more longsecret", ["longsecret", "longsecret-more", "longsecret"]), "[redacted] [redacted]");
  assert.equal(scrubForLog("start abc123overlap end", ["abc123", "123overlap"]), "start [redacted] end");
  assert.equal(scrubForLog("aaaaaaa", ["aaaaaa"]), "[redacted]");
  assert.equal(scrubForLog("unchanged", []), "unchanged");
});

describe("Linux process-group integration", { skip: !linux && "requires Linux process groups and /proc; run in WSL" }, () => {
  test("happy path captures both streams, leader exit code, duration, and group disappearance", async (t) => {
    const handle = sh(t, "printf hello; printf problem >&2; sleep 0.03");
    assert.ok(handle.pid > 0); assert.ok(handle.result instanceof Promise);
    const result = await handle.result;
    assert.equal(result.stdout, "hello"); assert.equal(result.stderr, "problem");
    assert.equal(result.exitCode, 0); assert.equal(result.signal, null);
    assert.equal(result.timedOut, false); assert.equal(result.stopped, false);
    assert.equal(result.truncated, false); assert.equal(result.groupGone, true);
    assert.ok(result.durationMs >= 20); gone(handle.pid);
  });

  test("non-zero leader exit is preserved", async (t) => {
    assert.equal((await sh(t, "exit 27").result).exitCode, 27);
  });

  test("leader killed by a signal reports that signal", async (t) => {
    const result = await sh(t, "kill -KILL $$").result;
    assert.equal(result.exitCode, null); assert.equal(result.signal, "SIGKILL"); assert.equal(result.groupGone, true);
  });

  test("stdin delivers UTF-8 and closes at EOF", async (t) => {
    const result = await node(t, "process.stdin.pipe(process.stdout)", { stdin: "input €\n" }).result;
    assert.equal(result.stdout, "input €\n");
  });

  test("absent stdin closes immediately", async (t) => {
    const result = await node(t, "process.stdin.resume(); process.stdin.on('end', () => console.log('eof'))").result;
    assert.equal(result.stdout, "eof\n");
  });

  test("early child exit tolerates a broken stdin pipe", async (t) => {
    const result = await node(t, "process.exit(0)", { stdin: "x".repeat(2 * 1024 * 1024) }).result;
    assert.equal(result.exitCode, 0);
  });

  test("child receives exactly the explicit environment", async (t) => {
    const env = { ONLY_THIS: "value", LANG: "C.UTF-8" };
    const result = await node(t, "process.stdout.write(JSON.stringify(process.env))", { env }).result;
    assert.deepEqual(JSON.parse(result.stdout), env);
  });

  test("synthetic HOME and NINE_ROUTER_API_KEY in a Host process never leak into its child", async (t) => {
    // This nested Host receives only synthetic values; the real Host environment is never read.
    const moduleUrl = new URL("../dist/exec/index.js", import.meta.url).href;
    const source = `import { runToCompletion } from ${JSON.stringify(moduleUrl)};
      const result = await runToCompletion({command: process.execPath, args: ['-e',
        'process.stdout.write(JSON.stringify(process.env))'], cwd: process.cwd(), env: {}});
      process.stdout.write(result.stdout);`;
    const result = await node(t, source, { env: { HOME: "/synthetic-home", NINE_ROUTER_API_KEY: "synthetic-key" } }).result;
    assert.deepEqual(JSON.parse(result.stdout), {});
  });

  test("Node's implicit NODE_V8_COVERAGE propagation cannot add Host environment to the child", async (t) => {
    const root = temp(t);
    const moduleUrl = new URL("../dist/exec/index.js", import.meta.url).href;
    const source = `import { runToCompletion } from ${JSON.stringify(moduleUrl)};
      const result = await runToCompletion({command: process.execPath, args: ['-e',
        'process.stdout.write(JSON.stringify(process.env))'], cwd: process.cwd(), env: {}});
      process.stdout.write(result.stdout);`;
    const result = await node(t, source, { env: { NODE_V8_COVERAGE: root } }).result;
    assert.equal(result.exitCode, 0); assert.deepEqual(JSON.parse(result.stdout), {});
  });

  test("prototype properties are never handed to the child as environment entries", async (t) => {
    const env = Object.assign(Object.create({ INHERITED: "synthetic" }), { EXPLICIT: "yes" });
    const result = await node(t, "process.stdout.write(JSON.stringify(process.env))", { env }).result;
    assert.deepEqual(JSON.parse(result.stdout), { EXPLICIT: "yes" });
  });

  test("cwd is honored", async (t) => {
    const root = temp(t);
    assert.equal((await node(t, "process.stdout.write(process.cwd())", { cwd: root }).result).stdout, root);
  });

  test("cwd symlink escaping the requested directory is refused", (t) => {
    const root = temp(t); const outside = temp(t); const link = join(root, "escape");
    fs.symlinkSync(outside, link, "dir");
    assert.throws(() => startProcess({ ...defaults, cwd: link }), errorCode("invalid-options"));
  });

  test("a symlink in any cwd ancestor is refused", (t) => {
    const root = temp(t); fs.mkdirSync(join(root, "actual")); fs.mkdirSync(join(root, "actual", "nested"));
    fs.symlinkSync(join(root, "actual"), join(root, "link"), "dir");
    assert.throws(() => startProcess({ ...defaults, cwd: join(root, "link", "nested") }), errorCode("invalid-options"));
  });

  test("bare executable resolves only through the child's PATH", async (t) => {
    const root = temp(t); fs.symlinkSync(process.execPath, join(root, "factory-test-node"));
    const result = await launch(t, { command: "factory-test-node", args: ["-e", "console.log('child-path')"], env: { PATH: root } }).result;
    assert.equal(result.stdout, "child-path\n"); assert.equal(result.exitCode, 0);
  });

  test("child PATH without the executable does not fall back to Host PATH", async (t) => {
    const root = temp(t);
    const result = await launch(t, { command: "sh", env: { PATH: root } }).result;
    assert.equal(result.exitCode, null); assert.equal(result.stderr, "failed to start");
  });

  test("absolute executable works without any PATH", async (t) => {
    const result = await launch(t, { command: "/bin/sh", args: ["-c", "printf absolute"], env: {} }).result;
    assert.equal(result.stdout, "absolute");
  });

  test("empty child PATH searches only the explicit cwd", async (t) => {
    const root = temp(t);
    const result = await launch(t, { command: "sh", cwd: root, env: { PATH: "" } }).result;
    assert.equal(result.stderr, "failed to start");
  });

  test("arguments remain literal with shell disabled", async (t) => {
    const args = ["$(touch forbidden)", "; echo injected", "space value", "€"];
    const result = await launch(t, { args: ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...args] }).result;
    assert.deepEqual(JSON.parse(result.stdout), args);
  });

  test("256 arguments and maximum configured limits are accepted", async (t) => {
    const result = await launch(t, { command: "/bin/true", args: Array(256).fill("arg"), timeoutMs: 21_600_000,
      maxOutputBytes: 16 * 1024 * 1024 }).result;
    assert.equal(result.exitCode, 0);
  });

  test("5 MiB output is drained without deadlock and kept text is bounded", async (t) => {
    const result = await node(t, "process.stdout.write('x'.repeat(5 * 1024 * 1024))", { maxOutputBytes: 4096 }).result;
    assert.equal(result.exitCode, 0); assert.equal(Buffer.byteLength(result.stdout), 4096); assert.equal(result.truncated, true);
  });

  test("default output limit is 1 MiB per stream", async (t) => {
    const result = await node(t, "process.stdout.write('x'.repeat(2 * 1024 * 1024)); process.stderr.write('y'.repeat(2 * 1024 * 1024))").result;
    assert.equal(result.stdout.length, 1024 * 1024); assert.equal(result.stderr.length, 1024 * 1024); assert.equal(result.truncated, true);
  });

  test("stdout and stderr large interleaving have independent caps", async (t) => {
    const result = await node(t, "for(let i=0;i<100;i++){process.stdout.write('a'.repeat(65536));process.stderr.write('b'.repeat(65536));}",
      { maxOutputBytes: 8192 }).result;
    assert.equal(result.stdout, "a".repeat(8192)); assert.equal(result.stderr, "b".repeat(8192));
    assert.equal(result.truncated, true); assert.equal(result.exitCode, 0);
  });

  test("zero cap discards everything and still drains both streams", async (t) => {
    const result = await node(t, "process.stdout.write('out'); process.stderr.write('err')", { maxOutputBytes: 0 }).result;
    assert.equal(result.stdout, ""); assert.equal(result.stderr, ""); assert.equal(result.truncated, true); assert.equal(result.exitCode, 0);
  });

  test("output exactly at the cap is not truncated", async (t) => {
    const result = await sh(t, "printf 123456", { maxOutputBytes: 6 }).result;
    assert.equal(result.stdout, "123456"); assert.equal(result.truncated, false);
  });

  test("UTF-8 is decoded incrementally when printf emits a three-byte character one byte at a time", async (t) => {
    const chunks = [];
    const result = await sh(t, "printf '\\342'; sleep 0.03; printf '\\202'; sleep 0.03; printf '\\254'", {
      onOutput(stream, chunk) { if (stream === "stdout") chunks.push(chunk); },
    }).result;
    assert.equal(result.stdout, "€"); assert.equal(chunks.join(""), "€");
    for (const chunk of chunks) assert.equal(chunk.includes("�"), false);
  });

  test("a byte cap never keeps part of a multi-byte character", async (t) => {
    const result = await node(t, "process.stdout.write('a€€')", { maxOutputBytes: 5 }).result;
    assert.equal(result.stdout, "a€"); assert.ok(Buffer.byteLength(result.stdout) <= 5); assert.equal(result.truncated, true);
  });

  test("output observers receive only kept text from the correct stream", async (t) => {
    const seen = { stdout: "", stderr: "" };
    const result = await sh(t, "printf 123456789; printf abcdefghi >&2", { maxOutputBytes: 4,
      onOutput(stream, chunk) { seen[stream] += chunk; } }).result;
    assert.deepEqual(seen, { stdout: result.stdout, stderr: result.stderr }); assert.deepEqual(seen, { stdout: "1234", stderr: "abcd" });
  });

  test("throwing onOutput cannot break output draining or the runner", async (t) => {
    const result = await node(t, "process.stdout.write('x'.repeat(5 * 1024 * 1024))", {
      maxOutputBytes: 1000, onOutput() { throw new Error("observer failure"); },
    }).result;
    assert.equal(result.stdout.length, 1000); assert.equal(result.exitCode, 0); assert.equal(result.groupGone, true);
  });

  test("timeout kills the whole group and /proc contains none of the children", async (t) => {
    const handle = sh(t, "sleep 300 & sleep 300 & wait", { timeoutMs: 300 });
    await until(() => members(handle.pid).length >= 3);
    const children = members(handle.pid).filter((pid) => pid !== handle.pid);
    const result = await handle.result;
    assert.equal(result.timedOut, true); assert.equal(result.stopped, false); assert.equal(result.groupGone, true);
    gone(handle.pid); assert.deepEqual(members(handle.pid), []);
    for (const pid of children) assert.equal(fs.existsSync(`/proc/${pid}`), false);
  });

  test("stop kills grandchildren as well as the group leader", async (t) => {
    const handle = sh(t, "/bin/sh -c 'sleep 300 & wait' & wait");
    await until(() => members(handle.pid).length >= 3);
    const pids = members(handle.pid);
    await handle.stop(); gone(handle.pid);
    const result = await handle.result;
    assert.equal(result.stopped, true); assert.equal(result.groupGone, true);
    for (const pid of pids) assert.equal(fs.existsSync(`/proc/${pid}`), false);
  });

  test("stop resolves only after a TERM-ignoring child is SIGKILLed and the group is gone", async (t) => {
    let ready = false;
    const handle = sh(t, "trap '' TERM; printf ready; while :; do sleep 300; done", {
      killGraceMs: 150, onOutput(_stream, chunk) { if (chunk.includes("ready")) ready = true; },
    });
    await until(() => ready);
    const started = performance.now(); const stopping = handle.stop();
    let done = false; void stopping.then(() => { done = true; });
    await delay(40); assert.equal(done, false);
    await stopping; assert.ok(performance.now() - started >= 130); gone(handle.pid);
    assert.equal((await handle.result).signal, "SIGKILL");
  });

  test("stop is idempotent and concurrent callers receive the same promise", async (t) => {
    const handle = node(t, "setInterval(() => {}, 1000)");
    const first = handle.stop("operator"); const second = handle.stop("shutdown");
    assert.equal(first, second); await Promise.all([first, second]);
    assert.equal(handle.stop(), first); gone(handle.pid); assert.equal((await handle.result).stopped, true);
  });

  test("stop after natural exit resolves and preserves the natural outcome", async (t) => {
    const handle = sh(t, "exit 0"); const result = await handle.result;
    await handle.stop(); await handle.stop(); gone(handle.pid);
    assert.equal(result.stopped, false); assert.equal(result.exitCode, 0);
  });

  test("normal leader exit kills background children even when they hold output pipes open", async (t) => {
    const handle = sh(t, "sleep 300 & printf '%s' $!; exit 0");
    const result = await handle.result; const child = Number(result.stdout);
    assert.ok(child > 0); assert.equal(result.exitCode, 0); assert.equal(result.stopped, false); assert.equal(result.timedOut, false);
    assert.equal(result.groupGone, true); gone(handle.pid); assert.equal(fs.existsSync(`/proc/${child}`), false);
  });

  test("setsid escape is not contained by process groups; the later sandbox must contain it", async (t) => {
    const setsid = ["/usr/bin/setsid", "/bin/setsid"].find((file) => fs.existsSync(file));
    if (!setsid) { t.skip("setsid is unavailable"); return; }
    let escapedPid = 0;
    const source = `const { spawn } = require('node:child_process');
      const escaped = spawn(${JSON.stringify(setsid)}, ['/bin/sleep', '300'], {env: {}, stdio: 'ignore'});
      escaped.on('spawn', () => console.log(escaped.pid));
      setInterval(() => {}, 1000);`;
    // Keep the runner's leader alive until we have observed the child's new session.
    const handle = node(t, source, { onOutput(stream, chunk) {
      if (stream === "stdout") escapedPid = Number(chunk.trim());
    } });
    t.after(async () => {
      if (escapedPid > 0) {
        try { process.kill(escapedPid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
        await until(() => !fs.existsSync(`/proc/${escapedPid}`));
      }
    });
    await until(() => escapedPid > 0 && members(escapedPid).includes(escapedPid));
    await handle.stop(); const result = await handle.result;
    assert.equal(result.groupGone, true); gone(handle.pid);
    assert.doesNotThrow(() => process.kill(escapedPid, 0));
  });

  test("ENOENT resolves with a generic spawn message without the executable path", async (t) => {
    const path = join(temp(t), "private-executable-path");
    const handle = launch(t, { command: path }); const result = await handle.result;
    assert.equal(result.exitCode, null); assert.equal(result.signal, null); assert.equal(result.stderr, "failed to start");
    assert.equal(result.stderr.includes(path), false); assert.equal(result.groupGone, true); await handle.stop();
  });

  test("EACCES resolves with the same generic spawn message", async (t) => {
    const path = join(temp(t), "not-executable"); fs.writeFileSync(path, "fixture", { mode: 0o600 });
    const result = await launch(t, { command: path }).result;
    assert.equal(result.stderr, "failed to start"); assert.equal(result.exitCode, null); assert.equal(result.groupGone, true);
  });

  test("synchronous spawn exceptions become generic typed errors", (t) => {
    t.mock.method(childProcess, "spawn", () => { throw new Error("private raw spawn failure"); });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    assert.throws(() => startProcess(defaults), (error) => errorCode("spawn-failed")(error)
      && !error.message.includes("private"));
  });

  test("stop deadline rejects with stop-failed while result always resolves with groupGone false", async (t) => {
    // The leader exits naturally before probes are forced to fail; no real process is stranded.
    let pgid = 0; const kill = process.kill.bind(process);
    t.mock.method(process, "kill", (pid, signal) => {
      if (pid === -pgid) {
        if (signal === 0) { const error = new Error("permission denied"); error.code = "EPERM"; throw error; }
        return true;
      }
      return kill(pid, signal);
    });
    const handle = node(t, "setTimeout(() => {}, 60)", { killGraceMs: 10, killDeadlineMs: 100 }); pgid = handle.pid;
    const result = await handle.result;
    assert.equal(result.exitCode, 0); assert.equal(result.groupGone, false);
    const first = handle.stop(); assert.equal(handle.stop(), first);
    await assert.rejects(first, errorCode("stop-failed"));
    t.mock.restoreAll(); gone(handle.pid);
  });

  test("two concurrent runs have independent groups, output and cancellation", async (t) => {
    const first = node(t, "setInterval(() => {}, 1000)");
    const second = node(t, "setTimeout(() => console.log('second'), 150)");
    await first.stop(); const result = await second.result;
    assert.equal(result.stdout, "second\n"); assert.equal(result.stopped, false); assert.equal(result.exitCode, 0);
    gone(first.pid); gone(second.pid);
  });

  test("the leader is reaped and no zombie remains", async (t) => {
    const handle = sh(t, "exit 0"); await handle.result;
    assert.equal(fs.existsSync(`/proc/${handle.pid}`), false);
    assert.throws(() => process.kill(handle.pid, 0), (error) => error.code === "ESRCH");
  });

  test("twenty completed executions do not leak file descriptors", async (t) => {
    await sh(t, "exit 0").result; await delay(25);
    const before = fs.readdirSync("/proc/self/fd").length;
    for (let index = 0; index < 20; index++) await sh(t, "printf ok; printf err >&2").result;
    await delay(25);
    assert.ok(fs.readdirSync("/proc/self/fd").length <= before, "process runner leaked descriptors");
  });

  test("runToCompletion returns the always-resolving result convenience promise", async () => {
    const result = await runToCompletion({ ...defaults, command: "/bin/true" });
    assert.equal(result.exitCode, 0); assert.equal(result.groupGone, true);
  });
});
