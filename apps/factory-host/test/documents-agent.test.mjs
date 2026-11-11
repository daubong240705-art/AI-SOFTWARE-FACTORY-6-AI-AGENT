import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { registerAgentOutput } from "../dist/artifacts/service.js";
import { createContentStore } from "../dist/artifacts/content-store.js";
import { documentsFixture, samples } from "./documents-fixture.mjs";

function agent(t) {
  const f = documentsFixture(t); const workspacePath = realpathSync(mkdtempSync(join(tmpdir(), "factory-doc-agent-")));
  t.after(() => { assert.ok(resolve(workspacePath).startsWith(realpathSync(tmpdir()) + sep + "factory-doc-agent-")); rmSync(workspacePath, { recursive: true, force: true }); });
  const taskId = randomUUID(), attemptId = randomUUID();
  f.raw.prepare(`INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,origin_kind,state,required_capabilities_json,acceptance_json,inputs_json)
    VALUES (?,?,1,'DOC-001','Task','Goal','Brief','operator','active','[]','[]','[]')`).run(f.projectId, taskId);
  f.raw.prepare("INSERT INTO nodes (id,revision,name,platform,trust,state,slots_total,slots_used) VALUES ('local',1,'Local','linux','trusted-workstation','online',1,0)").run();
  f.raw.prepare(`INSERT INTO attempts (project_id,id,task_id,revision,epoch,state,outcome,runtime,provider,model,effort,node_id,lease_id,lease_expires_at)
    VALUES (?,?,?,1,1,'running','known','fake','fake','fake','medium','local','lease',?)`).run(f.projectId, attemptId, taskId, new Date(Date.now() + 600000).toISOString());
  const grant = { projectId: f.projectId, taskId, attemptId, epoch: 1, workspacePath, allowedModels: [], expiresAt: Infinity };
  const register = (type, bytes, documents) => {
    writeFileSync(join(workspacePath, "output"), bytes);
    return registerAgentOutput({ ...f, newId: randomUUID, ...(documents ? { documents } : {}) },
      { grant, title: type, kind: "other", mediaType: type, path: "output", abstractL0: "Agent document abstract", inputs: [] });
  };
  return { ...f, grant, register, workspacePath };
}
for (const [type, , bytes] of samples.filter(([type]) => ["application/pdf", "image/png"].includes(type))) test(`agent registers ${type} without indexing binary body`, t => {
  const f = agent(t), ref = f.register(type, bytes); assert.deepEqual(f.store.get(ref.contentHash), bytes);
  const row = f.raw.prepare("SELECT origin,file_name,abstract_l0 FROM artifact_versions WHERE artifact_id=?").get(ref.artifactId);
  assert.deepEqual(row, { origin: "agent", file_name: null, abstract_l0: "Agent document abstract" });
  assert.equal(f.raw.prepare("SELECT body_indexed FROM knowledge_indexed WHERE artifact_id=?").get(ref.artifactId).body_indexed, 0);
  assert.equal(f.knowledge.search({ projectId: f.projectId, teamId: null, viewer: "operator" }, "bodysecretmarker").length, 0);
});
for (const [type, bytes] of [["application/x-executable", Buffer.from("MZ")], ["image/png", Buffer.from("%PDF-1.7")], ["application/pdf", Buffer.alloc(0)]]) test(`agent rejects invalid or disallowed ${type}`, t => {
  const f = agent(t); assert.throws(() => f.register(type, bytes), { message: "output could not be registered" });
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM artifact_versions").get().n, 0);
});
test("agent binary maximum can exceed 8 MiB while text retains 8 MiB", t => {
  const f = agent(t); const size = 8 * 1024 * 1024 + 1, bytes = Buffer.alloc(size, 32); bytes.write("%PDF-");
  const documents = { maxBytes: size, quotaBytes: size * 2 }; const ref = f.register("application/pdf", bytes, documents);
  assert.equal(f.store.get(ref.contentHash).length, size);
  assert.throws(() => f.register("text/plain", Buffer.alloc(size, 32), documents), { message: "output could not be registered" });
  assert.throws(() => f.register("application/pdf", bytes, { ...documents, maxBytes: size - 1 }), { message: "output could not be registered" });
});
test("agent respects project quota counting upload and old versions", t => {
  const f = agent(t); f.add({ origin: "upload", bytes: Buffer.from("12345"), status: "superseded" });
  assert.throws(() => f.register("application/pdf", samples[0][2], { maxBytes: 1024, quotaBytes: samples[0][2].length + 4 }), { message: "output could not be registered" });
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM artifact_versions").get().n, 1);
});
test("content store accepts configured document bytes and keeps its default 8 MiB ceiling", t => {
  const f = agent(t); const bytes = Buffer.alloc(8 * 1024 * 1024 + 1, 32);
  const defaultStore = createContentStore({ dir: join(f.workspacePath, "default") }); assert.throws(() => defaultStore.put(bytes), /Content unavailable/);
  const store = createContentStore({ dir: join(f.workspacePath, "documents"), maxObjectBytes: bytes.length }); const content = store.put(bytes);
  assert.deepEqual(store.get(content.hash), bytes);
});
