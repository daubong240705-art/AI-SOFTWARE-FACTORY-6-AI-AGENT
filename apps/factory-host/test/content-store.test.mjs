import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Worker } from "node:worker_threads";
import { test } from "node:test";
import { syncBuiltinESMExports } from "node:module";
import { createContentStore } from "../dist/artifacts/content-store.js";

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), "factory-content-"));
  const dir = join(root, "objects");
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + "factory-content-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const store = createContentStore({ dir, ...options });
  const path = (hash) => join(dir, hash.slice(0, 2), hash);
  return { root, dir, store, path };
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const generic = (error) => error instanceof Error && error.message === "Content unavailable";
const posix = { skip: process.platform === "win32" && "POSIX permissions require POSIX" };
const links = { skip: process.platform === "win32" && "Symlink fixtures require POSIX" };

for (const [name, bytes] of [
  ["ASCII text", "hello\n"], ["Unicode text", "Résumé 🌏\n"], ["empty string", ""],
  ["empty bytes", new Uint8Array()], ["binary bytes", Uint8Array.from([0, 255, 128, 10])],
  ["carriage returns", "line\r\nnext\r\n"], ["embedded NUL", "a\0b"], ["byte view", new Uint8Array([1, 2, 3, 4]).subarray(1, 3)],
]) test(`content round trip preserves ${name}`, (t) => {
  const { store } = fixture(t); const result = store.put(bytes); const expected = Buffer.from(bytes);
  assert.equal(result.hash, digest(expected)); assert.equal(result.size, expected.length);
  assert.deepEqual(store.get(result.hash), expected); assert.equal(store.has(result.hash), true);
  assert.equal(store.size(result.hash), expected.length);
});

test("put retains the existing object and inode", (t) => {
  const { store, path } = fixture(t); const first = store.put("same"); const before = fs.statSync(path(first.hash));
  assert.deepEqual(store.put("same"), first); const after = fs.statSync(path(first.hash));
  assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs);
});
test("different bytes produce different objects", (t) => {
  const { store } = fixture(t); assert.notEqual(store.put("a").hash, store.put("b").hash);
});
test("objects live in their two digit shard", (t) => {
  const { store, dir } = fixture(t); const { hash } = store.put("sharded");
  assert.deepEqual(fs.readdirSync(dir), [hash.slice(0, 2)]);
  assert.deepEqual(fs.readdirSync(join(dir, hash.slice(0, 2))), [hash]);
});
test("missing objects return null and false", (t) => {
  const { store } = fixture(t); const hash = "a".repeat(64);
  assert.equal(store.get(hash), null); assert.equal(store.has(hash), false); assert.equal(store.size(hash), null);
});
test("exact byte limit is accepted", (t) => {
  const { store } = fixture(t, { maxObjectBytes: 4 }); assert.equal(store.put("1234").size, 4);
});
test("byte limit counts UTF-8 bytes", (t) => {
  const { store, dir } = fixture(t, { maxObjectBytes: 3 }); assert.throws(() => store.put("🌏"), generic);
  assert.deepEqual(fs.readdirSync(dir), []);
});
test("zero byte limit still allows empty content", (t) => {
  const { store } = fixture(t, { maxObjectBytes: 0 }); assert.equal(store.put("").size, 0);
  assert.throws(() => store.put("a"), generic);
});
test("default limit refuses objects larger than eight MiB", (t) => {
  const { store, dir } = fixture(t); assert.throws(() => store.put(Buffer.alloc(8 * 1024 * 1024 + 1)), generic);
  assert.deepEqual(fs.readdirSync(dir), []);
});
for (const [name, limit] of [["negative", -1], ["fractional", 1.5], ["infinite", Infinity], ["not numeric", NaN]])
  test(`refuses ${name} size limit`, (t) => {
    const { root } = fixture(t); assert.throws(() => createContentStore({ dir: join(root, "invalid"), maxObjectBytes: limit }), generic);
  });

for (const [name, hash] of [
  ["uppercase", "A".repeat(64)], ["short", "a".repeat(63)], ["long", "a".repeat(65)],
  ["traversal", "../" + "a".repeat(61)], ["NUL", "\0" + "a".repeat(63)],
  ["newline suffix", "a".repeat(64) + "\n"], ["non hex", "g".repeat(64)],
  ["empty", ""], ["non string", null],
]) test(`invalid ${name} hash is refused before filesystem access`, (t) => {
  const { store } = fixture(t); const original = fs.lstatSync; let calls = 0;
  fs.lstatSync = () => { calls++; throw new Error("unexpected access"); }; syncBuiltinESMExports();
  try {
    for (const fn of [store.get, store.has, store.size]) assert.throws(() => fn(hash), generic);
    assert.equal(calls, 0);
  } finally { fs.lstatSync = original; syncBuiltinESMExports(); }
});

test("corrupted object is never returned by any reader", (t) => {
  const { store, path } = fixture(t); const { hash } = store.put("bytes");
  fs.writeFileSync(path(hash), "Bytes");
  assert.equal(store.get(hash), null); assert.equal(store.has(hash), false); assert.equal(store.size(hash), null);
});
test("put refuses to overwrite a corrupted object", (t) => {
  const { store, path } = fixture(t); const { hash } = store.put("bytes"); fs.writeFileSync(path(hash), "other");
  assert.throws(() => store.put("bytes"), generic); assert.equal(fs.readFileSync(path(hash), "utf8"), "other");
  assert.deepEqual(fs.readdirSync(join(path(hash), "..")), [hash]);
});
test("a replaced object that exceeds the limit is unverified", (t) => {
  const { store, path } = fixture(t, { maxObjectBytes: 4 }); const { hash } = store.put("ok");
  fs.writeFileSync(path(hash), "oversized"); assert.equal(store.get(hash), null);
});
for (const scope of ["object", "shard", "root"]) test(`refuses symlinks at the ${scope}`, links, (t) => {
  const { store, dir, root, path } = fixture(t); const { hash } = store.put("link");
  const target = scope === "object" ? path(hash) : scope === "shard" ? join(dir, hash.slice(0, 2)) : dir;
  const relocated = join(root, "relocated"); fs.renameSync(target, relocated);
  fs.symlinkSync(relocated, target, scope === "object" ? "file" : "dir");
  assert.throws(() => store.get(hash), generic); assert.throws(() => store.put("link"), generic);
});
test("refuses a symlink chosen as the store root", links, (t) => {
  const { dir, root } = fixture(t); const link = join(root, "link"); fs.symlinkSync(dir, link, "dir");
  assert.throws(() => createContentStore({ dir: link }), generic);
});
test("directories are private", posix, (t) => {
  const { store, dir } = fixture(t); const { hash } = store.put("private");
  for (const directory of [dir, join(dir, hash.slice(0, 2))]) assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
});
test("object files are private", posix, (t) => {
  const { store, path } = fixture(t); const { hash } = store.put("private"); assert.equal(fs.statSync(path(hash)).mode & 0o777, 0o600);
});
for (const dir of ["/mnt", "/mnt/content", "relative", "../escape", "bad\0root"]) {
  test(`refuses invalid store root ${["/mnt", "/mnt/content", "relative", "../escape", "bad\0root"].indexOf(dir) + 1}`, () => {
    assert.throws(() => createContentStore({ dir }), generic);
  });
}
test("publish errors remove temporary and lock files", (t) => {
  const { store, dir } = fixture(t); const original = fs.renameSync;
  fs.renameSync = () => { throw new Error(dir); }; syncBuiltinESMExports();
  try { assert.throws(() => store.put("fail rename"), generic); }
  finally { fs.renameSync = original; syncBuiltinESMExports(); }
  for (const shard of fs.readdirSync(dir)) assert.deepEqual(fs.readdirSync(join(dir, shard)), []);
});
test("concurrent publishers retain one verified object and no temporary files", async (t) => {
  const { dir, store } = fixture(t); const moduleUrl = new URL("../dist/artifacts/content-store.js", import.meta.url).href;
  const code = `const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.moduleUrl).then(({createContentStore}) => {
      parentPort.postMessage(createContentStore({dir:workerData.dir}).put('concurrent'));
    }).catch(() => { throw new Error('publisher failed'); });`;
  const results = await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
    const worker = new Worker(code, { eval: true, workerData: { dir, moduleUrl } });
    worker.once("message", resolve); worker.once("error", reject);
  })));
  assert.equal(new Set(results.map((r) => r.hash)).size, 1);
  const hash = results[0].hash; assert.equal(store.get(hash).toString(), "concurrent");
  assert.deepEqual(fs.readdirSync(join(dir, hash.slice(0, 2))), [hash]);
});
test("an existing store root with wider permissions is tightened to owner-only", posix, (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "factory-content-")); const dir = join(root, "objects");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(dir, { mode: 0o755 }); fs.chmodSync(dir, 0o755);
  createContentStore({ dir }); assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
});
test("a stale lock left by a crashed publisher does not block the same content forever", (t) => {
  const { dir, store, path } = fixture(t); const bytes = "same content twice"; const hash = digest(bytes);
  fs.mkdirSync(join(dir, hash.slice(0, 2)), { mode: 0o700 });
  const lock = join(dir, hash.slice(0, 2), `${hash}.lock`); fs.writeFileSync(lock, "", { mode: 0o600 });
  const old = new Date(Date.now() - 120_000); fs.utimesSync(lock, old, old);
  assert.deepEqual(store.put(bytes), { hash, size: Buffer.byteLength(bytes) });
  assert.equal(fs.existsSync(lock), false); assert.equal(store.get(hash).toString(), bytes); assert.ok(fs.existsSync(path(hash)));
});
test("a fresh lock held by a live publisher is respected and then times out generically", { timeout: 15_000 }, (t) => {
  const { dir, store } = fixture(t); const bytes = "contended content"; const hash = digest(bytes);
  fs.mkdirSync(join(dir, hash.slice(0, 2)), { mode: 0o700 });
  fs.writeFileSync(join(dir, hash.slice(0, 2), `${hash}.lock`), "", { mode: 0o600 });
  assert.throws(() => store.put(bytes), generic);
});
test("a lock released between the failed open and the lstat is retried instead of failing the publisher", (t) => {
  const { dir, store } = fixture(t); const bytes = "raced publisher"; const hash = digest(bytes);
  fs.mkdirSync(join(dir, hash.slice(0, 2)), { mode: 0o700 });
  const lock = join(dir, hash.slice(0, 2), `${hash}.lock`); fs.writeFileSync(lock, "", { mode: 0o600 });
  const real = fs.lstatSync; let injected = false;
  t.mock.method(fs, "lstatSync", (path, ...rest) => {
    if (!injected && String(path) === lock) { injected = true; fs.unlinkSync(lock); throw Object.assign(new Error("released"), { code: "ENOENT" }); }
    return real(path, ...rest);
  });
  assert.deepEqual(store.put(bytes), { hash, size: Buffer.byteLength(bytes) }); assert.equal(injected, true);
});
