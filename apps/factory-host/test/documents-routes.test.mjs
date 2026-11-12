import assert from "node:assert/strict";
import { test } from "node:test";
import { documentsFixture, samples } from "./documents-fixture.mjs";

test("document upload requires session and CSRF and validates project/query/signature", async t => {
  const f = documentsFixture(t);
  assert.equal((await f.app.inject({ method: "POST", url: `/projects/${f.projectId}/documents?filename=x.pdf`, payload: samples[0][2], headers: { host: "127.0.0.1:18787", "content-type": "application/octet-stream" } })).statusCode, 401);
  const noOrigin = { ...f.headers }; delete noOrigin.origin;
  assert.equal((await f.app.inject({ method: "POST", url: `/projects/${f.projectId}/documents?filename=x.pdf`, payload: samples[0][2], headers: { ...noOrigin, "content-type": "application/octet-stream" } })).statusCode, 403);
  assert.equal((await f.upload({ filename: "../bad.pdf" })).statusCode, 400);
  assert.equal((await f.upload({ filename: "x.pdf", mediaType: "image/png" })).statusCode, 415);
  assert.equal((await f.upload({}, samples[0][2], { projectId: f.otherProject })).statusCode, 201);
  assert.equal((await f.upload({}, samples[0][2], { projectId: "00000000-0000-0000-0000-000000000000" })).statusCode, 404);
});

test("document upload stores metadata, indexes text, and binary body is not searchable", async t => {
  const f = documentsFixture(t);
  const pdf = await f.upload({ filename: "spec.pdf", title: "Spec" }, samples[0][2]); assert.equal(pdf.statusCode, 201);
  assert.equal(pdf.json().artifact.origin, "upload"); assert.equal(pdf.json().artifact.fileName, "spec.pdf"); assert.equal(pdf.json().artifact.mediaType, "application/pdf");
  const txt = await f.upload({ filename: "notes.txt" }, Buffer.from("searchable-upload-marker")); assert.equal(txt.statusCode, 201);
  assert.equal(f.knowledge.search({ projectId: f.projectId, teamId: null, viewer: "operator" }, { query: "searchable-upload-marker" }).length, 1);
  assert.equal(f.knowledge.search({ projectId: f.projectId, teamId: null, viewer: "operator" }, { query: "bodysecretmarker" }).length, 0);
});

test("document upload versions only same-project uploads and supersedes", async t => {
  const f = documentsFixture(t); const first = await f.upload({ filename: "one.pdf" }); const artifactId = first.json().artifact.artifactId;
  const second = await f.upload({ filename: "two.pdf", artifactId }); assert.equal(second.statusCode, 201); assert.equal(second.json().artifact.version, 2);
  assert.equal(f.raw.prepare("SELECT status FROM artifact_versions WHERE artifact_id=? AND version=1").get(artifactId).status, "superseded");
  const other = await f.upload({ filename: "bad.pdf", artifactId }, samples[0][2], { projectId: f.otherProject }); assert.equal(other.statusCode, 409);
});

test("document quota and body limit refuse without partial rows", async t => {
  const f = documentsFixture(t, { quotaBytes: 5, maxBytes: 1024 * 1024 });
  const response = await f.upload({ filename: "too.pdf" }, samples[0][2]); assert.equal(response.statusCode, 409);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM artifact_versions").get().n, 0);
  const limited = documentsFixture(t, { maxBytes: 1024 * 1024 });
  const over = await limited.upload({ filename: "large.pdf" }, Buffer.concat([samples[0][2], Buffer.alloc(1024 * 1024)])); assert.equal(over.statusCode, 413);
});

test("raw route applies safe headers, disposition, and visibility", async t => {
  const f = documentsFixture(t); const uploaded = await f.upload({ filename: "é \"report.pdf" }); const id = uploaded.json().artifact.artifactId;
  const inline = await f.read(f.rawUrl(id)); assert.equal(inline.statusCode, 200); assert.equal(inline.headers["content-type"], "application/pdf");
  assert.equal(inline.headers["content-disposition"].startsWith("inline;"), true); assert.match(inline.headers["content-disposition"], /filename\*=UTF-8''/);
  for (const name of ["x-content-type-options", "content-security-policy", "cache-control"]) assert.ok(inline.headers[name]);
  assert.equal((await f.read(`${f.rawUrl(id)}?download=1`)).headers["content-disposition"].startsWith("attachment;"), true);
  const missing = await f.read(f.rawUrl("00000000-0000-0000-0000-000000000000")); assert.equal(missing.statusCode, 404);
  const other = f.add({ projectId: f.otherProject }); assert.equal((await f.read(f.rawUrl(other.artifactId, 1, f.otherProject))).statusCode, 200);
});

test("origin filter is accepted and strict", async t => {
  const f = documentsFixture(t); await f.upload({ filename: "origin.pdf" });
  assert.equal((await f.read(`/projects/${f.projectId}/knowledge/artifacts?origin=upload`)).statusCode, 200);
  assert.equal((await f.read(`/projects/${f.projectId}/knowledge/artifacts?origin=nope`)).statusCode, 400);
});
