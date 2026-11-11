import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startRelay } from "../dist/sandbox/index.js";

const unix = { skip: process.platform === "win32" ? "Unix sockets require POSIX" : false, timeout: 15_000 };
const cli = fileURLToPath(new URL("../dist/sandbox/relay-main.js", import.meta.url));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function fixture(t, handler = (socket) => socket.pipe(socket), maxConnections) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "factory-relay-")));
  const socketPath = join(root, "proxy.sock"); const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); handler(socket);
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(socketPath, done); });
  const relay = await startRelay({ listenPort: 0, socketPath, ...(maxConnections === undefined ? {} : { maxConnections }) });
  t.after(async () => {
    await relay.close(); for (const socket of sockets) socket.destroy();
    await new Promise((done) => server.close(done));
    assert.ok(root.includes("factory-relay-")); fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, socketPath, relay, server };
}
async function connect(t, port) {
  const socket = createConnection({ host: "127.0.0.1", port }); socket.on("error", () => {});
  t.after(() => socket.destroy()); await once(socket, "connect"); return socket;
}
const closed = (socket) => new Promise((done) => socket.once("close", done));
function run(args) {
  const child = spawn(process.execPath, [cli, ...args], { env: {}, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = []; const stderr = [];
  child.stdout.on("data", (data) => stdout.push(data)); child.stderr.on("data", (data) => stderr.push(data));
  return { child, result: new Promise((done) => child.once("close", (code, signal) => done({ code, signal,
    stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))) };
}
async function freePort() {
  const server = createServer(); await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port; await new Promise((done) => server.close(done)); return port;
}

test("relay transfers bidirectional binary bytes", unix, async (t) => {
  const { relay } = await fixture(t, (socket) => { socket.write(Buffer.from([0, 255, 4])); socket.pipe(socket); });
  const socket = await connect(t, relay.port); const chunks = []; const ended = once(socket, "end");
  socket.on("data", (chunk) => chunks.push(chunk)); socket.end(Buffer.from([128, 0, 42])); await ended;
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([0, 255, 4, 128, 0, 42]));
});
test("relay supports a response after the client half-closes its upload", unix, async (t) => {
  const { relay } = await fixture(t, (socket) => {
    socket.resume(); socket.once("end", () => socket.end("response after upload"));
  });
  const socket = await connect(t, relay.port); const chunks = []; socket.on("data", (chunk) => chunks.push(chunk));
  const ended = once(socket, "end"); socket.end("request"); await ended;
  assert.equal(Buffer.concat(chunks).toString(), "response after upload");
});
test("relay preserves an eight MiB payload under backpressure", unix, async (t) => {
  const { relay } = await fixture(t); const socket = await connect(t, relay.port);
  const payload = Buffer.alloc(8 * 1024 * 1024); for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
  const chunks = []; socket.on("data", (data) => chunks.push(data)); const ended = once(socket, "end");
  socket.end(payload); socket.pause(); await delay(100); socket.resume(); await ended;
  assert.deepEqual(Buffer.concat(chunks), payload);
});
test("relay delivers streamed chunks before the upstream ends", unix, async (t) => {
  let finish;
  const { relay } = await fixture(t, (socket) => { socket.write("data: first\n\n"); finish = () => socket.end("data: last\n\n"); });
  const socket = await connect(t, relay.port); const first = (await once(socket, "data"))[0].toString();
  assert.equal(first, "data: first\n\n"); const last = once(socket, "data"); finish();
  assert.equal((await last)[0].toString(), "data: last\n\n");
});
test("relay enforces its connection limit and releases capacity", unix, async (t) => {
  const { relay } = await fixture(t, () => {}, 1); const first = await connect(t, relay.port);
  const second = await connect(t, relay.port); await closed(second);
  const end = closed(first); first.destroy(); await end; await delay(30);
  const third = await connect(t, relay.port); third.write("still open"); await delay(20); assert.equal(third.destroyed, false);
});
test("relay closes clients when the socket is absent", unix, async (t) => {
  const { relay, root } = await fixture(t);
  const absent = await startRelay({ listenPort: 0, socketPath: join(root, "missing.sock") }); t.after(() => absent.close());
  const socket = await connect(t, absent.port); await closed(socket); assert.ok(relay.port > 0);
});
test("relay close destroys active connections and is idempotent", unix, async (t) => {
  const { relay } = await fixture(t); const socket = await connect(t, relay.port); const ended = closed(socket);
  await relay.close(); await ended; await relay.close();
  await assert.rejects(new Promise((done, reject) => { const s = createConnection(relay.port, "127.0.0.1"); s.once("error", reject); s.once("connect", () => { s.destroy(); done(); }); }));
});
test("relay binds only the IPv4 loopback interface", unix, async (t) => {
  const { relay } = await fixture(t);
  await assert.rejects(new Promise((done, reject) => { const socket = createConnection(relay.port, "::1"); socket.once("error", reject); socket.once("connect", () => { socket.destroy(); done(); }); }));
  // Inspect the actual listener rather than infer its interface from an accessible address.
  if (process.platform === "linux") {
    const rows = fs.readFileSync("/proc/net/tcp", "utf8").split("\n");
    assert.ok(rows.some((row) => row.includes(`0100007F:${relay.port.toString(16).toUpperCase().padStart(4, "0")}`)));
  }
});
test("relay destroys the peer after an upstream error", unix, async (t) => {
  const { relay } = await fixture(t, (socket) => socket.destroy());
  const socket = await connect(t, relay.port); await closed(socket);
});
for (const [label, options] of [["negative port", { listenPort: -1, socketPath: "/socket" }], ["fractional port", { listenPort: 1.5, socketPath: "/socket" }],
  ["oversized port", { listenPort: 65536, socketPath: "/socket" }], ["relative socket", { listenPort: 0, socketPath: "relative" }],
  ["zero connection limit", { listenPort: 0, socketPath: "/socket", maxConnections: 0 }]])
  test(`relay refuses invalid ${label} generically`, async () => {
    await assert.rejects(startRelay(options), { message: "Invalid relay configuration" });
  });
test("relay-main forwards command exit codes and closes its listener", unix, async (t) => {
  const { socketPath } = await fixture(t); const port = await freePort();
  const result = await run(["--listen", String(port), "--socket", socketPath, "--", process.execPath, "-e", "process.exit(23)"]).result;
  assert.equal(result.code, 23); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  const server = createServer(); await new Promise((done, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", done); });
  await new Promise((done) => server.close(done));
});
test("relay-main maps a command signal to its conventional exit code", unix, async (t) => {
  const { socketPath } = await fixture(t); const port = await freePort();
  const result = await run(["--listen", String(port), "--socket", socketPath, "--", process.execPath, "-e", "process.kill(process.pid,'SIGTERM')"]).result;
  assert.equal(result.code, 143);
});
for (const [label, signal, expected] of [["termination", "SIGTERM", 143], ["interrupt", "SIGINT", 130]])
  test(`relay-main forwards ${label} to its child`, unix, async (t) => {
    const { socketPath } = await fixture(t); const port = await freePort();
    const { child, result } = run(["--listen", String(port), "--socket", socketPath, "--", process.execPath, "-e", "process.stdout.write('ready');setInterval(()=>{},1000)"]);
    t.after(() => child.kill("SIGKILL")); await once(child.stdout, "data"); child.kill(signal);
    assert.equal((await result).code, expected);
  });
for (const [label, args] of [["unknown option", ["--unknown", "SYNTHETIC-PRIVATE"]], ["missing options", []],
  ["invalid port", ["--listen", "SYNTHETIC-PRIVATE", "--socket", "/socket", "--", "true"]],
  ["duplicate flag", ["--listen", "1234", "--listen", "1234", "--socket", "/socket", "--", "true"]],
  ["missing command", ["--listen", "1234", "--socket", "/socket", "--"]],
  ["relative socket", ["--listen", "1234", "--socket", "SYNTHETIC-PRIVATE", "--", "true"]],
  ["unknown trailing option", ["--listen", "1234", "--socket", "/socket", "--bad", "SYNTHETIC-PRIVATE", "--", "true"]]])
  test(`relay-main rejects ${label} without echoing values`, async () => {
    const result = await run(args).result; assert.equal(result.code, 2); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  });
