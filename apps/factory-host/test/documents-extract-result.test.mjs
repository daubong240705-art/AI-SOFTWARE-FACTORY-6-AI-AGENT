import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { captureWorker, runDocumentWorker } from "../dist/documents/runner.js";
import { fitResult, workerResultSchema } from "../dist/documents/result.js";
import { temporary, workerConfig, workerResult } from "./documents-extract-fixture.mjs";

for (const [label, extra] of [
  ["oversize markdown", { markdown: "x".repeat(2000001) }], ["wrong pages type", { pages: "1" }],
  ["negative pages", { pages: -1 }], ["too many pages", { pages: 100001 }],
  ["unknown warning", { warnings: ["private-input"] }], ["too many outline entries", { outline: Array.from({ length: 501 }, () => ({ level: 1, title: "x", page: null, offset: 0 })) }],
  ["invalid offset", { outline: [{ level: 1, title: "x", page: null, offset: 999999 }] }],
  ["invalid outline page", { pages: 1, outline: [{ level: 1, title: "x", page: 2, offset: 0 }] }],
  ["unknown metadata field", { metadata: { title: null, author: null, language: null, secret: "x" } }],
  ["unknown top level field", { extra: "x" }], ["wrong markdown type", { markdown: 5 }],
]) test(`worker strict result rejects ${label}`, () => assert.equal(workerResultSchema.safeParse(workerResult("text", extra)).success, false));

test("worker result sanitizes and caps outline titles and metadata", () => {
  const result = workerResultSchema.parse(workerResult("text", {
    outline: [{ level: 2, title: "\u0000\u202e" + "a".repeat(250), page: null, offset: 0 }],
    metadata: { title: "Title /private/hidden", author: "Author\u0000", language: null },
    warnings: ["truncated-pages", "truncated-text"],
  }));
  assert.equal(result.outline[0].title.length, 200); assert.doesNotMatch(JSON.stringify(result), /hidden|private|\\u0000|\u202e/);
});
test("Markdown storage limit truncates multibyte text and drops out-of-range headings", () => {
  const result = fitResult(workerResult("😀é漢字", { outline: [{ level: 1, title: "Late", page: null, offset: 4 }] }), 5);
  assert.equal(result.markdown, "😀"); assert.deepEqual(result.outline, []); assert.deepEqual(result.warnings, ["truncated-text"]);
  assert.equal(fitResult(result, 5), result);
});
for (const [label, source, code] of [
  ["malformed JSON", 'process.stdout.write("{private-input")', "invalid-result"],
  ["wrong result type", 'process.stdout.write("[]")', "invalid-result"],
  ["invalid UTF8", 'process.stdout.write(Buffer.from([255]))', "invalid-result"],
  ["nonzero with safe code", 'process.stdout.write(JSON.stringify({error:"encrypted"}));process.exitCode=1', "encrypted"],
  ["nonzero with arbitrary error", 'process.stdout.write(JSON.stringify({error:"private-input"}));process.exitCode=1', "failed"],
  ["nonzero without JSON", 'process.stderr.write("private-input");process.exitCode=2', "failed"],
]) test(`runner rejects ${label} with a code only`, async () => {
  await assert.rejects(captureWorker(process.execPath, ["-e", source]), error => error.code === code && error.message === code);
});
test("runner timeout kills the process and enforces stdout cap", async () => {
  const start = Date.now();
  await assert.rejects(captureWorker(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 100 }), { code: "timeout" });
  assert.ok(Date.now() - start < 5000);
  await assert.rejects(captureWorker(process.execPath, ["-e", 'process.stdout.write("x".repeat(8*1024*1024+1));setInterval(()=>{},1000)']), { code: "stdout-limit" });
});
test("runner hook receives private input bytes and always removes temporary input", async t => {
  const root = temporary(t), report = join(root, "report.json");
  const source = `const fs=require('node:fs'); const input=process.argv[1]; fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({input,match:fs.readFileSync(input).equals(Buffer.from('private sample')),media:process.argv[2]})); process.stdout.write(${JSON.stringify(JSON.stringify(workerResult()))});`;
  assert.equal((await runDocumentWorker(Buffer.from("private sample"), "application/pdf", workerConfig(source))).status, "done");
  const result = JSON.parse(readFileSync(report, "utf8")); assert.equal(result.match, true); assert.equal(result.media, "application/pdf"); assert.equal(existsSync(result.input), false);
  const failureSource = `require('node:fs').writeFileSync(${JSON.stringify(report)},JSON.stringify({input:process.argv[1]}));process.stdout.write('{')`;
  await assert.rejects(runDocumentWorker(Buffer.from("sample"), "application/pdf", workerConfig(failureSource)), { code: "invalid-result" });
  assert.equal(existsSync(JSON.parse(readFileSync(report, "utf8")).input), false);
});
test("runner unavailable executable is skipped and worker off takes priority over command", async () => {
  assert.deepEqual(await runDocumentWorker(Buffer.from("x"), "application/pdf", { enabled: true, python: "missing", script: "missing", command: ["factory-worker-does-not-exist"] }), { status: "skipped", errorCode: "worker-unavailable" });
  assert.deepEqual(await runDocumentWorker(Buffer.from("x"), "application/pdf", { ...workerConfig(), enabled: false }), { status: "skipped", errorCode: "worker-disabled" });
});
test("Linux timeout kills the entire child process group", { skip: process.platform !== "linux" && "Process group signals require Linux" }, async t => {
  const file = join(temporary(t), "survivor");
  const childCode = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(file)},'survived'),700)`;
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
  await assert.rejects(captureWorker(process.execPath, ["-e", parent], { timeoutMs: 300 }), { code: "timeout" });
  await new Promise(done => setTimeout(done, 900)); assert.equal(existsSync(file), false);
});
