import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { extractionFixture, extractionHost, eventually, workerConfig } from "./documents-extract-fixture.mjs";
import { samples } from "./documents-fixture.mjs";

const url = row => `/projects/${row.projectId}/knowledge/artifacts/${row.artifactId}/versions/${row.version}/extraction`;
test("all extraction routes enforce session and return 404 for absent extraction", async t => {
  const f = extractionFixture(t), row = f.add();
  for (const suffix of ["", "/text", "/retry"]) {
    const method = suffix === "/retry" ? "POST" : "GET";
    assert.equal((await f.app.inject({ method, url: url(row) + suffix, headers: { host: f.headers.host, "content-type": "application/json" } })).statusCode, 401);
    assert.equal((await f.app.inject({ method, url: url(row) + suffix, headers: f.headers, ...(method === "POST" ? { payload: {} } : {}) })).statusCode, 404);
  }
});
test("extraction metadata and bounded text are sanitized, use original offsets and omit storage fields", async t => {
  const f = extractionFixture(t), text = "# Heading\n" + "x".repeat(21000) + "\n/private/hidden\u0000\u202e";
  const row = f.add({ mediaType: "text/plain", bytes: Buffer.from(text) }); f.enqueue(row); await f.completed(row);
  const metadata = await f.read(url(row)); assert.equal(metadata.statusCode, 200);
  assert.deepEqual(Object.keys(metadata.json().extraction).sort(), ["status", "pages", "chars", "outline", "converter", "errorCode", "updatedAt"].sort());
  const first = (await f.read(url(row) + "/text?from=0&limit=20000")).json();
  assert.equal(first.text.length, 20000); assert.equal(first.from, 0); assert.equal(first.next, 20000); assert.equal(first.total, text.length);
  const last = (await f.read(url(row) + `/text?from=${first.next}&limit=20000`)).json();
  assert.equal(last.next, null); assert.doesNotMatch(last.text, /hidden|private|\u0000|\u202e/);
  const beyond = (await f.read(url(row) + "/text?from=999999")).json(); assert.equal(beyond.text, ""); assert.equal(beyond.from, text.length); assert.equal(beyond.next, null);
  assert.doesNotMatch(metadata.body, /content_hash|text_hash|metadata_json/);
});
for (const query of ["limit=20001", "limit=0", "limit=-1", "from=-1", "from=0.1", "from=abc", "from=9007199254740992", "limit=1&unknown=x", "from=0&from=1"]) {
  test(`extraction text rejects invalid bounds ${query}`, async t => {
    const f = extractionFixture(t), row = f.add(); assert.equal((await f.read(url(row) + "/text?" + query)).statusCode, 400);
  });
}
test("retry permits failed/unavailable rows, conflicts on other states and enforces three retries", async t => {
  const f = extractionFixture(t, workerConfig('process.stdout.write(JSON.stringify({error:"failed"}));process.exitCode=1')), row = f.add();
  f.enqueue(row); await f.completed(row);
  for (let i = 0; i < 3; i++) {
    assert.equal((await f.app.inject({ method: "POST", url: url(row) + "/retry", headers: f.headers, payload: {} })).statusCode, 202); await f.completed(row);
  }
  assert.equal((await f.app.inject({ method: "POST", url: url(row) + "/retry", headers: f.headers, payload: {} })).statusCode, 409);
  for (const [status, errorCode, allowed] of [["done", null, false], ["pending", null, false], ["running", null, false], ["skipped", "not-text", false], ["skipped", "worker-disabled", false], ["skipped", "worker-unavailable", true]]) {
    f.raw.prepare("UPDATE document_extractions SET status=?,error_code=?,attempts=1").run(status, errorCode);
    assert.equal((await f.app.inject({ method: "POST", url: url(row) + "/retry", headers: f.headers, payload: {} })).statusCode, allowed ? 202 : 409);
  }
});
for (const missing of ["origin", "x-csrf-token", "cookie"]) test(`retry write guard rejects missing ${missing}`, async t => {
  const f = extractionFixture(t), row = f.add(), headers = { ...f.headers }; delete headers[missing];
  f.enqueue(row);
  assert.equal((await f.app.inject({ method: "POST", url: url(row) + "/retry", headers, payload: {} })).statusCode, missing === "cookie" ? 401 : 403);
});
test("pending text returns conflict and knowledge list/get tolerate missing rows", async t => {
  const f = extractionFixture(t), row = f.add(); f.enqueue(row);
  assert.equal((await f.read(url(row) + "/text")).statusCode, 409); await f.completed(row);
  const base = `/projects/${f.projectId}/knowledge/artifacts`;
  const list = (await f.read(base)).json(); assert.deepEqual(list.items[0].extraction, { status: "done", pages: null });
  const get = (await f.read(base + "/" + row.artifactId)).json(); assert.deepEqual(get.artifact.versions[0].extraction, { status: "done", pages: null });
  const absent = f.add(); const unextracted = (await f.read(base + "/" + absent.artifactId)).json(); assert.equal(unextracted.artifact.versions[0].extraction, null);
});
test("real Host upload hooks enqueue and asynchronously process PDF/Office and in-process text", async t => {
  const host = await extractionHost(t), raw = host.storage.raw, projectId = randomUUID();
  raw.prepare("INSERT INTO projects VALUES (?,1,'Extraction','artifact','unused','active')").run(projectId);
  host.hub.ensureStream(projectId);
  const enqueueSql = `CREATE TRIGGER observe_document_pending AFTER INSERT ON document_extractions WHEN NEW.status!='pending' BEGIN SELECT RAISE(ABORT,'must enqueue pending'); END`;
  raw.exec(enqueueSql);
  for (const [mediaType, extension, bytes] of samples.filter(([type]) => type === "application/pdf" || type.includes("openxml") || type.startsWith("text/"))) {
    const response = await host.app.inject({ method: "POST", url: `/projects/${projectId}/documents?filename=file.${extension}&mediaType=${encodeURIComponent(mediaType)}`, headers: { ...host.headers, "content-type": "application/octet-stream" }, payload: bytes });
    assert.equal(response.statusCode, 201, response.body); const row = response.json().artifact;
    const key = [projectId, row.artifactId, row.version];
    assert.ok(raw.prepare("SELECT 1 FROM document_extractions WHERE project_id=? AND artifact_id=? AND version=?").get(...key));
    await eventually(() => raw.prepare("SELECT status FROM document_extractions WHERE project_id=? AND artifact_id=? AND version=?").get(...key)?.status === "done");
    const extraction = await host.app.inject({ method: "GET", url: url(row), headers: host.headers }); assert.equal(extraction.json().extraction.status, "done");
    const text = await host.app.inject({ method: "GET", url: url(row) + "/text", headers: host.headers }); assert.equal(text.statusCode, 200); assert.ok(text.json().text.length);
  }
  const row = raw.prepare("SELECT project_id AS projectId, artifact_id AS artifactId,version FROM document_extractions LIMIT 1").get();
  raw.exec("UPDATE document_extractions SET status='failed',attempts=1,error_code='failed'");
  assert.equal((await host.app.inject({ method: "POST", url: url(row) + "/retry", headers: host.headers, payload: {} })).statusCode, 202);
  await eventually(() => raw.prepare("SELECT status FROM document_extractions WHERE artifact_id=?").get(row.artifactId).status === "done");
  raw.exec("UPDATE document_extractions SET status='running'");
  const restarted = await host.restart();
  await eventually(() => restarted.storage.raw.prepare("SELECT count(*) AS n FROM document_extractions WHERE status!='done'").get().n === 0);
});
