import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openStorage } from "../dist/storage/database.js";
import { EventHub } from "../dist/events/hub.js";
import { createApiServer } from "../dist/api/server.js";
import { createSessionStore } from "../dist/identity/index.js";
import { createKnowledgeIndex } from "../dist/knowledge/index.js";
import { registerKnowledgeRoutes } from "../dist/knowledge/routes.js";
import { registerDocumentRoutes } from "../dist/artifacts/routes.js";
import { DEFAULT_DOCUMENT_CONFIG } from "../dist/artifacts/limits.js";

export const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
export const samples = [
  ["application/pdf", "pdf", Buffer.from("%PDF-1.7\nbodysecretmarker"), true],
  ["image/png", "png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]), true],
  ["image/jpeg", "jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]), true],
  ["image/gif", "gif", Buffer.from("GIF89a"), true],
  ["image/webp", "webp", Buffer.from("RIFF0000WEBP"), true],
  ["image/svg+xml", "svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), false],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx", Buffer.from("PK\x03\x04word/document.xml"), false],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx", Buffer.from("PK\x03\x04xl/workbook.xml"), false],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx", Buffer.from("PK\x03\x04ppt/presentation.xml"), false],
  ["text/plain", "txt", Buffer.from("textbodymarker"), false],
  ["text/markdown", "md", Buffer.from("# textbodymarker"), false],
  ["text/csv", "csv", Buffer.from("name,value\ntextbodymarker,2"), false],
  ["application/json", "json", Buffer.from('{"textbodymarker":true}'), false],
];

export function documentsFixture(t, config = {}, register) {
  const storage = openStorage(":memory:"); storage.migrate({ migrationsDir, backupDir: null }); const raw = storage.raw;
  const hub = new EventHub(raw); const projectId = randomUUID(); const otherProject = randomUUID();
  for (const id of [projectId, otherProject]) {
    raw.prepare("INSERT INTO projects VALUES (?,1,'Documents','artifact','unused','active')").run(id);
    hub.ensureStream(id);
  }
  const objects = new Map(); const store = {
    put(input) { const bytes = Buffer.from(input), hash = createHash("sha256").update(bytes).digest("hex"); objects.set(hash, bytes); return { hash, size: bytes.length }; },
    get(hash) { return objects.get(hash) ?? null; }, has(hash) { return objects.has(hash); }, size(hash) { return objects.get(hash)?.length ?? null; },
  };
  const knowledge = createKnowledgeIndex({ raw, store }); const observations = [];
  const afterRegister = ref => { assert.equal(raw.inTransaction, true); knowledge.indexVersion(ref.projectId, ref.artifactId, ref.version); observations.push(ref); };
  const deps = { raw, store, hub, config: { ...DEFAULT_DOCUMENT_CONFIG, ...config }, now: () => new Date(), afterRegister };
  const sessions = createSessionStore(); const session = sessions.create(); const host = "127.0.0.1:18787";
  const app = createApiServer({ origins: [`http://${host}`], sessions, gate: { consume() { return "invalid"; } }, register(app, guards) {
    registerKnowledgeRoutes(app, guards, { raw, store, knowledge }); registerDocumentRoutes(app, guards, deps);
    register?.(app, guards, { ...deps, knowledge });
    app.post("/commands", { preHandler: guards.write }, async () => ({ ok: true }));
  } });
  t.after(async () => { await app.close(); storage.close(); });
  const headers = { host, cookie: `factory_session=${session.id}`, origin: `http://${host}`, "x-csrf-token": session.csrfToken };
  const upload = (query = {}, bytes = samples[0][2], options = {}) => app.inject({ method: "POST",
    url: `/projects/${options.projectId ?? projectId}/documents?${new URLSearchParams({ filename: "report.pdf", ...query })}`,
    payload: bytes, headers: { ...headers, "content-type": "application/octet-stream", ...options.headers } });
  const read = (url, extra = {}) => app.inject({ method: "GET", url, headers: { ...headers, ...extra } });
  const rawUrl = (artifactId, version = 1, project = projectId) => `/projects/${project}/knowledge/artifacts/${artifactId}/versions/${version}/raw`;
  const add = (data = {}) => {
    const row = { projectId, artifactId: randomUUID(), version: 1, mediaType: "application/pdf", bytes: samples[0][2],
      origin: "agent", fileName: null, kind: "other", status: "draft", visibility: "project", title: "Document", abstractL0: "Document abstract", ...data };
    const content = store.put(row.bytes);
    raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,visibility,
      abstract_l0,created_at,origin,file_name,produced_by_attempt_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.projectId, row.artifactId, row.version, row.kind, row.title,
      row.mediaType, content.hash, content.size, row.status, row.visibility, row.abstractL0, new Date().toISOString(), row.origin, row.fileName, row.producedByAttemptId ?? null);
    knowledge.indexVersion(row.projectId, row.artifactId, row.version); return { ...row, hash: content.hash };
  };
  return { ...deps, storage, objects, projectId, otherProject, app, headers, upload, read, rawUrl, add, knowledge, observations };
}
