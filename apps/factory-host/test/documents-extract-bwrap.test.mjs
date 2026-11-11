import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDocumentCommand, WORKER_STDOUT_BYTES, WORKER_TIMEOUT_MS } from "../dist/documents/bwrap.js";
import { docWorkerConfig } from "../dist/documents/config.js";

test("pure document bubblewrap builder isolates network, environment and writable mounts on every platform", () => {
  const result = buildDocumentCommand({ python: "/home/test/venv/bin/python", script: "/srv/workers/doc_worker.py", input: "/private/input", media: "application/pdf" });
  assert.equal(result.command, "/usr/bin/bwrap"); assert.equal(result.timeoutMs, 120000); assert.equal(WORKER_TIMEOUT_MS, 120000);
  assert.equal(WORKER_STDOUT_BYTES, 8 * 1024 * 1024);
  const args = result.args;
  for (const flag of ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv"]) assert.ok(args.includes(flag));
  for (const flag of ["--share-net", "--bind", "--bind-try"]) assert.equal(args.includes(flag), false);
  const sequence = expected => assert.ok(args.some((_, i) => expected.every((part, j) => args[i + j] === part)), expected.join(" "));
  for (const [src, dst] of [["/usr", "/usr"], ["/home/test/venv", "/home/test/venv"], ["/srv/workers", "/worker"], ["/private/input", "/in/input"]]) sequence(["--ro-bind", src, dst]);
  sequence(["--tmpfs", "/tmp"]); sequence(["--remount-ro", "/"]);
  assert.deepEqual(args.slice(-5), ["/home/test/venv/bin/python", "-I", "/worker/doc_worker.py", "/in/input", "application/pdf"]);
  assert.equal(args.includes("--as=2147483648"), false);
  const limited = buildDocumentCommand({ python: "/venv/bin/python", script: "/srv/doc_worker.py", input: "/private/input", media: "text/csv", prlimit: true });
  assert.ok(limited.args.join(" ").includes("/usr/bin/prlimit --as=2147483648 -- /venv/bin/python"));
});
test("document configuration parses only the explicit command hook and safe defaults", () => {
  const defaults = docWorkerConfig({}); assert.equal(defaults.enabled, true);
  assert.ok(defaults.python.replaceAll("\\", "/").endsWith("factory-v2/doc-worker/venv/bin/python"));
  assert.ok(defaults.script.replaceAll("\\", "/").endsWith("factory-host/workers/doc_worker.py"));
  const config = docWorkerConfig({ FACTORY_DOC_WORKER: "off", FACTORY_DOC_WORKER_PYTHON: "python-test", FACTORY_DOC_WORKER_SCRIPT: "script-test", FACTORY_DOC_WORKER_COMMAND: '["node-test","worker-test"]' });
  assert.deepEqual(config, { enabled: false, python: "python-test", script: "script-test", command: ["node-test", "worker-test"] });
  for (const input of ["[", "[]", '[""]', "{}", '[1]']) assert.throws(() => docWorkerConfig({ FACTORY_DOC_WORKER_COMMAND: input }), /^Error: Invalid FACTORY_DOC_WORKER_COMMAND$/);
});
