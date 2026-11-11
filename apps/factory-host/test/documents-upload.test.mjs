import assert from "node:assert/strict";
import { test } from "node:test";
import { documentsFixture, samples } from "./documents-fixture.mjs";

for (const [mediaType, extension, bytes] of samples) test(`upload accepts ${extension} and returns public version metadata`, async t => {
  const f = documentsFixture(t), response = await f.upload({ filename: `file.${extension}`, mediaType }, bytes);
  assert.equal(response.statusCode, 201, response.body); const { apiVersion, ok, artifact: row } = response.json();
  assert.equal(apiVersion, 1); assert.equal(ok, true); assert.equal(row.origin, "upload"); assert.equal(row.fileName, `file.${extension}`);
  assert.equal(row.mediaType, mediaType); assert.equal(row.sizeBytes, bytes.length); assert.equal(row.title, "file"); assert.equal(row.kind, "other");
  assert.equal(row.visibility, "project"); assert.equal(row.status, "draft"); assert.equal(row.version, 1);
  assert.equal(row.producedByAttemptId, null); assert.equal(row.supersedesVersion, null); assert.equal(row.abstractL1, null);
  assert.equal(row.projectId, f.projectId); assert.equal(row.stale.length, 0); assert.equal(row.isStale, false);
  assert.ok(row.abstractL0.includes(`file.${extension}`)); assert.ok(row.abstractL0.length <= 400); assert.ok(row.createdAt);
  assert.doesNotMatch(response.body, /contentHash|content_hash|workspacePath/); assert.equal(f.observations.length, 1);
  const event = f.raw.prepare("SELECT body_json FROM event_log ORDER BY sequence DESC LIMIT 1").get();
  assert.deepEqual(JSON.parse(event.body_json).payload.entity, { kind: "artifact-version", id: row.artifactId, revision: 1 });
});
for (const query of [
  { filename: "" }, { filename: "x".repeat(201) }, { filename: "../bad.txt" }, { filename: "folder\\bad.txt" },
  { filename: "bad\x00.txt" }, { filename: "bad\n.txt" }, { filename: "bad\x7f.txt" }, { title: "x".repeat(201) },
  { artifactId: "invalid" }, { kind: "invalid" }, { unexpected: "value" },
]) test(`upload rejects malformed query ${JSON.stringify(query)}`, async t => {
  const f = documentsFixture(t); assert.equal((await f.upload(query)).statusCode, 400); assert.equal(f.objects.size, 0);
});
for (const [label, query, bytes] of [
  ["disallowed type", { mediaType: "text/html" }, Buffer.from("<html/>")],
  ["no default media", { filename: "unknown" }, samples[0][2]],
  ["wrong signature", { mediaType: "image/png" }, samples[0][2]],
  ["empty content", {}, Buffer.alloc(0)], ["invalid JSON", { filename: "bad.json" }, Buffer.from("{")],
  ["NUL text", { filename: "bad.txt" }, Buffer.from("bad\x00text")],
]) test(`upload refuses ${label} with 415`, async t => {
  const f = documentsFixture(t); assert.equal((await f.upload(query, bytes)).statusCode, 415); assert.equal(f.objects.size, 0);
});
for (const mode of ["no csrf", "bad csrf", "no origin", "foreign origin", "bad host"]) test(`upload write guard enforces ${mode}`, async t => {
  const f = documentsFixture(t), headers = { ...f.headers, "content-type": "application/octet-stream" };
  if (mode === "no csrf") delete headers["x-csrf-token"];
  if (mode === "bad csrf") headers["x-csrf-token"] = "wrong";
  if (mode === "no origin") delete headers.origin;
  if (mode === "foreign origin") headers.origin = "http://attacker.invalid";
  if (mode === "bad host") headers.host = "attacker.invalid";
  const response = await f.app.inject({ method: "POST", url: `/projects/${f.projectId}/documents?filename=x.pdf`, headers, payload: samples[0][2] });
  assert.equal(response.statusCode, 403); assert.equal(f.objects.size, 0);
});
test("upload raw parser leaves command JSON and global body limit unchanged", async t => {
  const f = documentsFixture(t); const headers = { ...f.headers, "content-type": "application/octet-stream" };
  assert.equal((await f.app.inject({ method: "POST", url: "/commands", headers, payload: samples[0][2] })).statusCode, 415);
  assert.equal((await f.upload({}, Buffer.from("{}"), { headers: { "content-type": "application/json" } })).statusCode, 415);
  assert.equal((await f.app.inject({ method: "POST", url: "/commands", headers: { ...f.headers, "content-type": "application/json" }, payload: { text: "a".repeat(262144) } })).statusCode, 413);
  const bytes = Buffer.alloc(300000, 32); bytes.write("%PDF-"); assert.equal((await f.upload({}, bytes)).statusCode, 201);
});
test("upload validates duplicate metadata keys and required filename", async t => {
  const f = documentsFixture(t);
  for (const query of ["filename=a.pdf&filename=b.pdf", "title=x", "filename=x.pdf&kind=other&kind=plan"])
    assert.equal((await f.app.inject({ method: "POST", url: `/projects/${f.projectId}/documents?${query}`, headers: { ...f.headers, "content-type": "application/octet-stream" }, payload: samples[0][2] })).statusCode, 400);
});
test("upload refuses agent artifacts, kind changes, and unknown artifact ids", async t => {
  const f = documentsFixture(t), agent = f.add();
  const first = (await f.upload({ kind: "media" })).json().artifact;
  for (const query of [{ artifactId: agent.artifactId }, { artifactId: first.artifactId }, { artifactId: "00000000-0000-4000-8000-000000000001" }])
    assert.equal((await f.upload(query)).statusCode, 409);
  assert.equal((await f.upload({ artifactId: first.artifactId, kind: "media" })).statusCode, 201);
});
test("upload store failure rolls back versions, status, index, events and notifications", async t => {
  const f = documentsFixture(t), first = (await f.upload()).json().artifact; const cursor = f.hub.currentCursor(f.projectId); let notices = 0;
  f.hub.subscribe(f.projectId, () => { notices++; }); f.store.put = () => { throw new Error("private filesystem error"); };
  const response = await f.upload({ artifactId: first.artifactId }); assert.equal(response.statusCode, 500); assert.doesNotMatch(response.body, /private|filesystem/);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM artifact_versions").get().n, 1);
  assert.equal(f.raw.prepare("SELECT status FROM artifact_versions").get().status, "draft"); assert.equal(f.knowledge.stats().indexed, 1);
  assert.deepEqual(f.hub.currentCursor(f.projectId), cursor); assert.equal(notices, 0);
});
test("upload event failure also rolls back metadata, lifecycle and indexing", async t => {
  const f = documentsFixture(t), first = (await f.upload()).json().artifact; const cursor = f.hub.currentCursor(f.projectId);
  f.hub.append = () => { throw new Error("event failure"); };
  assert.equal((await f.upload({ artifactId: first.artifactId })).statusCode, 500);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM artifact_versions").get().n, 1); assert.equal(f.raw.prepare("SELECT status FROM artifact_versions").get().status, "draft");
  assert.equal(f.knowledge.stats().indexed, 1); assert.deepEqual(f.hub.currentCursor(f.projectId), cursor);
});
test("upload quota counts all versions and agent rows per project, even duplicate bytes", async t => {
  const bytes = samples[0][2], f = documentsFixture(t, { quotaBytes: bytes.length * 3 }); f.add({ status: "superseded" });
  f.add({ projectId: f.otherProject, bytes: Buffer.alloc(10000) }); const first = (await f.upload()).json().artifact;
  assert.equal((await f.upload({ artifactId: first.artifactId })).statusCode, 201);
  assert.equal((await f.upload({ artifactId: first.artifactId })).statusCode, 409);
  assert.equal(f.raw.prepare("SELECT status FROM artifact_versions WHERE artifact_id=? AND version=2").get(first.artifactId).status, "draft");
});
test("upload sanitizes names, abstracts and titles and preserves filename maximum", async t => {
  const f = documentsFixture(t), filename = `${"a".repeat(196)}.pdf`;
  const response = await f.upload({ filename, title: "Safe\x00\u202etitle /private/hidden" }); assert.equal(response.statusCode, 201);
  assert.equal(response.json().artifact.fileName, filename); assert.doesNotMatch(response.body, /\\u0000|\u202e|private|hidden/);
});
