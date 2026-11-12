import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { openStorage } from "../dist/storage/database.js";
import { createKnowledgeIndex, listKnowledgeArtifacts, getKnowledgeArtifact } from "../dist/knowledge/index.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture(t, extra = {}) {
  const storage = openStorage(":memory:"); t.after(() => storage.close());
  storage.migrate({ migrationsDir, backupDir: null }); const raw = storage.raw; const objects = new Map();
  const store = { put(input) { const bytes = Buffer.from(input); const digest = hash(bytes); objects.set(digest, bytes); return { hash: digest, size: bytes.length }; },
    get(key) { return objects.get(key) ?? null; }, has(key) { return objects.has(key); }, size(key) { return objects.get(key)?.length ?? null; }, ...extra };
  const index = createKnowledgeIndex({ raw, store });
  for (const id of ["p1", "p2"]) raw.prepare("INSERT INTO projects VALUES (?,1,'Knowledge','artifact','unused','active')").run(id);
  const scope = { projectId: "p1", teamId: null, viewer: "operator" };
  const add = (data = {}) => {
    const bytes = Buffer.from(data.body ?? "Body text"); const content = store.put(bytes);
    const row = { projectId: "p1", artifactId: randomUUID(), version: 1, kind: "requirements", title: "Document",
      status: "draft", visibility: "project", abstractL0: "Original abstract.", abstractL1: null, mediaType: "text/markdown", ...data };
    raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,
      status,abstract_l0,abstract_l1,visibility,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(row.projectId,row.artifactId,row.version,row.kind,row.title,row.mediaType,content.hash,bytes.length,
        row.status,row.abstractL0,row.abstractL1,row.visibility,`2026-11-08T10:00:${String(row.version).padStart(2,"0")}.000Z`);
    if (data.index !== false) index.indexVersion(row.projectId,row.artifactId,row.version);
    return { ...row, contentHash: content.hash };
  };
  return { storage, raw, index, scope, add, objects, store, search: (query, options = {}) => index.search(scope, { query, ...options }) };
}

test("migration reaches five with both knowledge tables and a foreign key", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.raw.prepare("SELECT version FROM migration_ledger ORDER BY version").all().map((r) => r.version), [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]);
  for (const name of ["knowledge_index", "knowledge_indexed"]) assert.ok(f.raw.prepare("SELECT name FROM sqlite_master WHERE name=?").get(name));
  assert.equal(f.raw.prepare("SELECT strict FROM pragma_table_list WHERE name='knowledge_indexed'").get().strict, 1);
  assert.throws(() => f.raw.prepare("INSERT INTO knowledge_indexed VALUES ('p1','absent',1,1,'now')").run(), /FOREIGN KEY/);
});
for (const [query, title] of [["thiet ke","Thiết kế"],["dang nhap","Đăng nhập"],["dac ta","Đặc tả"],["nghien cu","Nghiên cứu"],["ENGLISH","English report"]])
  test(`normalized search finds ${query}`, (t) => {
    const f = fixture(t); const row = f.add({ title });
    assert.deepEqual(f.search(query).map((r) => r.artifactId), [row.artifactId]);
    assert.equal(f.search(title)[0].title, title);
  });
for (const mediaType of ["text/markdown","text/plain","application/json","text/x-diff","image/png","application/pdf","application/octet-stream","text/html"])
  test(`body policy for ${mediaType}`, (t) => {
    const f = fixture(t); f.add({ mediaType, title: "Searchable title", abstractL0: "Metadata abstract", abstractL1: "L1 searchable", body: "uniquebody" });
    const readable = ["text/markdown","text/plain","application/json"].includes(mediaType);
    assert.equal(f.search("uniquebody").length, readable ? 1 : 0);
    assert.equal(f.raw.prepare("SELECT body_indexed FROM knowledge_indexed").get().body_indexed, readable ? 1 : 0);
    assert.equal(f.search("searchable title").length, 1); assert.equal(f.search("metadata").length, 1); assert.equal(f.search("L1").length, 1);
  });
for (const mode of ["missing", "throws", "invalid UTF8"]) test(`unverifiable body ${mode} preserves metadata`, (t) => {
  const f = fixture(t); const row = f.add({ title: "Thiết kế", body: mode === "invalid UTF8" ? Buffer.from([0xff,0x80]) : "hiddenbody", index: false });
  if (mode === "missing") f.objects.clear();
  if (mode === "throws") f.store.get = () => { throw new Error("unavailable"); };
  assert.equal(f.index.indexVersion("p1",row.artifactId,1), true);
  assert.equal(f.search("thiet ke").length, 1); assert.equal(f.search("hiddenbody").length, 0);
  assert.equal(f.index.stats().bodyIndexed, 0);
});
test("long bodies truncate at 256 KiB and keep an intact multibyte prefix", (t) => {
  const f = fixture(t); f.add({ body: `beginmarker ${" ".repeat(256 * 1024 - 13)}Đ endmarker` });
  assert.equal(f.search("beginmarker").length, 1); assert.equal(f.search("endmarker").length, 0); assert.equal(f.index.stats().bodyIndexed, 1);
});
test("strict decoding also rejects invalid bytes beyond the index limit", (t) => {
  const f = fixture(t); f.add({ body: Buffer.concat([Buffer.from("bodymarker "),Buffer.alloc(256 * 1024,32),Buffer.from([0xff])]) });
  assert.equal(f.search("bodymarker").length, 0); assert.equal(f.index.stats().bodyIndexed, 0);
});
test("reindex replaces existing rows and is idempotent", (t) => {
  const f = fixture(t); const row = f.add({ title: "Originalmarker" });
  f.index.indexVersion("p1",row.artifactId,1); f.index.indexVersion("p1",row.artifactId,1);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM knowledge_index").get().n, 1);
  f.raw.prepare("UPDATE artifact_versions SET title='Replacementmarker' WHERE artifact_id=?").run(row.artifactId);
  f.index.indexVersion("p1",row.artifactId,1);
  assert.equal(f.search("originalmarker").length, 0); assert.equal(f.search("replacementmarker").length, 1);
  assert.equal(f.index.stats().indexed, 1); assert.equal(f.index.indexVersion("p1","absent",1), false);
});
test("index changes share the outer transaction and roll back with it", (t) => {
  const f = fixture(t); const row = f.add({ index: false });
  assert.throws(() => f.raw.transaction(() => {
    assert.equal(f.raw.inTransaction, true); f.index.indexVersion("p1",row.artifactId,1);
    assert.equal(f.index.stats().indexed, 1); throw new Error("rollback");
  })(), /rollback/);
  assert.equal(f.index.stats().indexed, 0); assert.equal(f.raw.prepare("SELECT count(*) AS n FROM knowledge_index").get().n, 0);
});
test("failed index replacement keeps the old index and marker atomically", (t) => {
  const f = fixture(t); const row = f.add({ title: "Originalmarker" });
  f.raw.exec("CREATE TRIGGER reject_index BEFORE UPDATE ON knowledge_indexed BEGIN SELECT RAISE(ABORT,'index failure'); END");
  f.raw.prepare("UPDATE artifact_versions SET title='Replacementmarker' WHERE artifact_id=?").run(row.artifactId);
  assert.throws(() => f.index.indexVersion("p1",row.artifactId,1), /index failure/);
  assert.equal(f.search("originalmarker").length, 1); assert.equal(f.search("replacementmarker").length, 0);
});
test("backfill indexes only missing rows in bounded batches", (t) => {
  const f = fixture(t); for (let i=0;i<7;i++) f.add({ title: "Backfillmarker", index: false });
  assert.deepEqual(f.index.indexAllMissing({limit:2}), { indexed:2, remaining:5 });
  assert.deepEqual(f.index.indexAllMissing({limit:3}), { indexed:3, remaining:2 });
  assert.deepEqual(f.index.indexAllMissing(), { indexed:2, remaining:0 });
  assert.deepEqual(f.index.indexAllMissing(), { indexed:0, remaining:0 }); assert.equal(f.search("backfillmarker").length,7);
});
test("rebuild removes stale rows and indexes every version", async (t) => {
  const f = fixture(t); for(let i=0;i<205;i++) f.add({ title:"Rebuildmarker", index:false });
  f.raw.prepare("INSERT INTO knowledge_index VALUES ('stray','','','p1','stray',1)").run();
  const stats = await f.index.rebuild(); assert.equal(stats.indexed,205); assert.equal(stats.missing,0); assert.equal(f.search("stray").length,0);
});
test("title ranks ahead of body with otherwise equal documents", (t) => {
  const f = fixture(t); const body = f.add({ title:"Other", body:"rankingmarker" });
  const title = f.add({ title:"rankingmarker", body:"Other" });
  const results = f.search("rankingmarker"); assert.deepEqual(results.map((r)=>r.artifactId),[title.artifactId,body.artifactId]);
  assert.ok(results[0].rank < results[1].rank);
});
test("kind and status filters are combined before pagination", (t) => {
  const f = fixture(t); f.add({title:"Filtermarker", kind:"plan"}); const expected=f.add({title:"Filtermarker",status:"approved"});
  f.add({title:"Filtermarker",status:"rejected"});
  assert.deepEqual(f.search("filtermarker",{kinds:["requirements"],statuses:["approved"]}).map((r)=>r.artifactId),[expected.artifactId]);
  assert.equal(f.search("filtermarker",{kinds:[]}).length,0); assert.equal(f.search("filtermarker",{statuses:[]}).length,0);
});
test("latestOnly uses newest non-withdrawn and can be disabled", (t) => {
  const f = fixture(t); const first=f.add({title:"Versionmarker",status:"approved"});
  f.add({artifactId:first.artifactId,version:2,title:"Versionmarker",status:"draft"});
  f.add({artifactId:first.artifactId,version:3,title:"Versionmarker",status:"withdrawn"});
  assert.deepEqual(f.search("versionmarker").map((r)=>r.version),[2]);
  assert.deepEqual(f.search("versionmarker",{latestOnly:false}).map((r)=>r.version),[3,2,1]);
});
test("pagination is stable, bounded and does not include bodies", (t) => {
  const f = fixture(t); for(let i=0;i<25;i++) f.add({title:"Paginationmarker",body:"Bodysecret"});
  const all=f.search("paginationmarker",{limit:100}); assert.equal(all.length,20);
  const first=f.search("paginationmarker",{limit:5}); const next=f.search("paginationmarker",{limit:5,offset:5});
  assert.deepEqual([...first,...next],all.slice(0,10)); assert.equal(f.search("paginationmarker",{offset:100}).length,0);
  assert.equal(JSON.stringify(all).includes("Bodysecret"),false); assert.equal(all[0].snippet, "Original abstract.");
});
for(const input of ['title:secret','a OR b','NEAR(a b)','"unbalanced','x*','-y','^z',"' OR 1=1 --"])
  test(`MATCH accepts literal normalized input ${input}`, (t) => { const f=fixture(t); f.add(); assert.doesNotThrow(()=>f.search(input)); });
test("status hook sees live status and maps organization to shared", (t) => {
  const f=fixture(t); const row=f.add({title:"Sharedmarker",status:"reviewed",visibility:"organization"});
  assert.equal(f.index.search({projectId:"p2",teamId:null,viewer:"agent"},"sharedmarker").length,0);
  f.raw.prepare("UPDATE artifact_versions SET status='approved' WHERE artifact_id=?").run(row.artifactId);
  const result=f.index.search({projectId:"p2",teamId:null,viewer:"agent"},"sharedmarker")[0];
  assert.equal(result.visibility,"shared"); assert.equal(result.status,"approved");
  f.index.afterStatusChange("p1",row.artifactId,1); assert.equal(f.index.stats().indexed,1);
});
test("get defaults to newest approved, explicit version and levels work", (t) => {
  const f=fixture(t); const first=f.add({status:"approved",abstractL0:"L0",abstractL1:"L1",body:"Original body"});
  f.add({artifactId:first.artifactId,version:2,abstractL0:"New draft"});
  assert.equal(f.index.get(f.scope,{artifactId:first.artifactId}).text,"L1");
  assert.equal(f.index.get(f.scope,{artifactId:first.artifactId,level:"l0"}).text,"L0");
  assert.equal(f.index.get(f.scope,{artifactId:first.artifactId,level:"l2"}).text,"Original body");
  assert.equal(f.index.get(f.scope,{artifactId:first.artifactId,version:2}).text,"New draft");
  assert.equal(f.index.get(f.scope,{artifactId:"missing"}),null);
});
test("get truncates text at 32 KiB, reports real size and preserves newlines", (t) => {
  const f=fixture(t); const body="a\n\tb\u0000"+"Đ".repeat(20000); const row=f.add({body});
  const doc=f.index.get(f.scope,{artifactId:row.artifactId,level:"l2"});
  assert.equal(doc.truncated,true); assert.equal(doc.sizeBytes,Buffer.byteLength(body)); assert.ok(Buffer.byteLength(doc.text)<=32768);
  assert.ok(doc.text.startsWith("a\n\tb ")); assert.equal(doc.text.includes("�"),false);
});
test("get refuses non-text content and missing verified content", (t) => {
  const f=fixture(t); const row=f.add({mediaType:"text/x-diff"});
  assert.throws(()=>f.index.get(f.scope,{artifactId:row.artifactId,level:"l2"}),/content is not readable as text/);
  const text=f.add(); f.objects.clear(); assert.throws(()=>f.index.get(f.scope,{artifactId:text.artifactId,level:"l2"}),/not found/);
});
test("operator browsing returns latest versions, counts and provenance without content identities", (t) => {
  const f=fixture(t); const input=f.add({title:"Input",visibility:"organization"}); const output=f.add({title:"Output"});
  f.add({artifactId:output.artifactId,version:2,title:"Output version two"});
  f.raw.prepare("INSERT INTO artifact_inputs VALUES ('p1',?,2,?,1)").run(output.artifactId,input.artifactId);
  const listing=listKnowledgeArtifacts(f.raw,f.scope); assert.equal(listing[0].versionCount,2);
  const doc=getKnowledgeArtifact(f.raw,f.scope,output.artifactId); assert.deepEqual(doc.inputs,[{artifactId:input.artifactId,version:1,title:"Input"}]);
  assert.deepEqual(getKnowledgeArtifact(f.raw,f.scope,input.artifactId).dependants,[{artifactId:output.artifactId,version:2,title:"Output version two"}]);
  assert.equal(getKnowledgeArtifact(f.raw,f.scope,input.artifactId).versions[0].visibility,"shared");
  assert.equal(JSON.stringify(doc).includes("contentHash"),false); assert.equal(getKnowledgeArtifact(f.raw,f.scope,"missing"),null);
});
