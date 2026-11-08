import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { openStorage } from "../dist/storage/database.js";
import { createKnowledgeIndex } from "../dist/knowledge/index.js";
import { registerKnowledgeRoutes } from "../dist/knowledge/routes.js";
import { createApiServer } from "../dist/api/server.js";
import { createSessionStore } from "../dist/identity/index.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
function fixture(t) {
  const storage=openStorage(":memory:"); storage.migrate({migrationsDir,backupDir:null}); const raw=storage.raw;
  const projectId=randomUUID(); const otherProject=randomUUID();
  for(const id of [projectId,otherProject]) raw.prepare("INSERT INTO projects VALUES (?,1,'Knowledge','artifact','unused','active')").run(id);
  const objects=new Map(); const store={
    put(value) { const bytes=Buffer.from(value); const hash=createHash("sha256").update(bytes).digest("hex"); objects.set(hash,bytes); return {hash,size:bytes.length}; },
    get(hash) { return objects.get(hash)??null; },
  };
  const knowledge=createKnowledgeIndex({raw,store}); const sessions=createSessionStore(); const session=sessions.create();
  const app=createApiServer({origins:["http://127.0.0.1:18787"],sessions,gate:{consume(){return "invalid";}},
    register(app,guards) { registerKnowledgeRoutes(app,guards,{raw,knowledge}); } });
  t.after(async()=>{await app.close(); storage.close();});
  const base=`/projects/${projectId}/knowledge`;
  const read=(suffix,cookie=`factory_session=${session.id}`)=>app.inject({method:"GET",url:suffix.startsWith("/projects/")?suffix:base+suffix,
    headers:{host:"127.0.0.1:18787",...(cookie===null?{}:{cookie})}});
  const add=(extra={})=>{
    const row={projectId,artifactId:randomUUID(),version:1,title:"Thiết kế marker",kind:"requirements",status:"draft",visibility:"project",
      abstractL0:"Short abstract",abstractL1:"Detailed abstract",createdAt:"2026-11-08T00:00:00.000Z",...extra};
    const content=store.put(row.body??`Body ${row.artifactId}`);
    raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,
      abstract_l0,abstract_l1,visibility,created_at) VALUES (?,?,?,?,?,'text/markdown',?,?,?,?,?,?,?)`)
      .run(row.projectId,row.artifactId,row.version,row.kind,row.title,content.hash,content.size,row.status,row.abstractL0,row.abstractL1,row.visibility,row.createdAt);
    knowledge.indexVersion(row.projectId,row.artifactId,row.version); return {...row,contentHash:content.hash};
  };
  return {raw,projectId,otherProject,base,read,add,knowledge};
}

for(const suffix of ["/search?q=marker","/artifacts","/artifacts/absent"]) test(`operator requires session for ${suffix.split("?")[0]}`,async(t)=>{
  const f=fixture(t); const response=await f.read(suffix,null); assert.equal(response.statusCode,401); assert.equal(response.json().ok,false);
});
for(const suffix of ["/search?q=marker","/artifacts","/artifacts/absent"]) test(`operator rejects unknown project for ${suffix.split("?")[0]}`,async(t)=>{
  const f=fixture(t); const response=await f.read(`/projects/${randomUUID()}/knowledge${suffix}`); assert.equal(response.statusCode,404);
  assert.equal(response.json().error.message,"Project not found.");
});
test("operator rejects an unknown artifact",async(t)=>{
  const f=fixture(t); const response=await f.read(`/artifacts/${randomUUID()}`); assert.equal(response.statusCode,404); assert.equal(response.json().error.message,"Artifact not found.");
});
for(const [label,query] of [["missing query",""],["empty query","q="],["long query",`q=${"a".repeat(201)}`],["repeated query","q=marker&q=other"]])
  test(`operator validates search ${label}`,async(t)=>{
    const f=fixture(t); const response=await f.read(`/search?${query}`); assert.equal(response.statusCode,400); assert.equal(response.json().error.message,"Invalid knowledge query.");
  });
for(const route of ["search","artifacts"]) for(const [label,query] of [
  ["invalid kind","kind=invalid"],["invalid status","status=invalid"],["zero limit","limit=0"],["large limit","limit=51"],
  ["negative offset","offset=-1"],["fractional limit","limit=1.5"],["text offset","offset=abc"],["repeated limit","limit=1&limit=2"],
  ["invalid repeated kind","kind=plan&kind=invalid"],["invalid comma status","status=draft,invalid"],
]) test(`operator validates ${route} ${label}`,async(t)=>{
  const f=fixture(t); const response=await f.read(`/${route}?q=marker&${query}`); assert.equal(response.statusCode,400); assert.equal(response.json().error.message,"Invalid knowledge query.");
});
for(const route of ["search","artifacts"]) for(const format of ["repeated","comma separated"])
  test(`operator accepts ${format} filters on ${route}`,async(t)=>{
    const f=fixture(t); const first=f.add(); const second=f.add({kind:"plan",status:"approved"}); f.add({kind:"other",status:"reviewed"});
    const filters=format==="repeated"?"kind=requirements&kind=plan&status=draft&status=approved":"kind=requirements,plan&status=draft,approved";
    const response=await f.read(`/${route}?q=marker&${filters}`); assert.equal(response.statusCode,200);
    const body=response.json(); assert.deepEqual(new Set((body.results??body.items).map(row=>row.artifactId)),new Set([first.artifactId,second.artifactId]));
  });
test("operator search returns Vietnamese metadata and paginates",async(t)=>{
  const f=fixture(t); for(let i=0;i<3;i++) f.add();
  const first=await f.read("/search?q=thiet%20ke&limit=2"); const last=await f.read("/search?q=thiet%20ke&limit=2&offset=2");
  assert.equal(first.statusCode,200); assert.equal(first.json().apiVersion,1); assert.equal(first.json().ok,true);
  const rows=[...first.json().results,...last.json().results]; assert.equal(rows.length,3); assert.equal(new Set(rows.map(row=>row.artifactId)).size,3);
  for(const row of rows) { assert.equal(row.title,"Thiết kế marker"); assert.equal(row.snippet,"Short abstract"); }
});
test("operator supports fifty results and offset on both listings",async(t)=>{
  const f=fixture(t); for(let i=0;i<51;i++) f.add();
  for(const route of ["search?q=marker&","artifacts?"]) {
    const first=await f.read(`/${route}limit=50`); const last=await f.read(`/${route}limit=50&offset=50`);
    assert.equal((first.json().results??first.json().items).length,50); assert.equal((last.json().results??last.json().items).length,1);
  }
});
test("operator artifact list returns one latest row per artifact newest first",async(t)=>{
  const f=fixture(t); const old=f.add(); f.add({artifactId:old.artifactId,version:2,title:"Updated",createdAt:"2026-11-08T01:00:00.000Z"});
  const newest=f.add({title:"Newest",createdAt:"2026-11-08T02:00:00.000Z"});
  const response=await f.read("/artifacts"); assert.equal(response.statusCode,200); const rows=response.json().items;
  assert.deepEqual(rows.map(row=>row.artifactId),[newest.artifactId,old.artifactId]); assert.equal(rows[1].version,2); assert.equal(rows[1].versionCount,2);
});
test("operator artifact detail includes inputs dependants and shared visibility",async(t)=>{
  const f=fixture(t); const input=f.add({title:"Input",visibility:"organization",status:"approved"}); const main=f.add({title:"Main"}); const output=f.add({title:"Output"});
  f.add({artifactId:main.artifactId,version:2,title:"Main updated"});
  f.raw.prepare("INSERT INTO artifact_inputs VALUES (?,?,2,?,1)").run(f.projectId,main.artifactId,input.artifactId);
  f.raw.prepare("INSERT INTO artifact_inputs VALUES (?,?,1,?,2)").run(f.projectId,output.artifactId,main.artifactId);
  const response=await f.read(`/artifacts/${main.artifactId}`); assert.equal(response.statusCode,200); const doc=response.json().artifact;
  assert.deepEqual(doc.versions.map(row=>row.version),[2,1]); assert.deepEqual(doc.inputs,[{artifactId:input.artifactId,version:1,title:"Input"}]);
  assert.deepEqual(doc.dependants,[{artifactId:output.artifactId,version:1,title:"Output"}]);
  const shared=(await f.read(`/artifacts/${input.artifactId}`)).json().artifact; assert.equal(shared.versions[0].visibility,"shared");
});
for(const visibility of ["project","organization","team-draft"]) test(`operator never sees another project's ${visibility} rows`,async(t)=>{
  const f=fixture(t); const local=f.add(); const hidden=f.add({projectId:f.otherProject,visibility,status:visibility==="team-draft"?"draft":"approved",body:"Other private bytes"});
  for(const suffix of ["/search?q=marker","/artifacts",`/artifacts/${hidden.artifactId}`,`/artifacts/${local.artifactId}`]) {
    const response=await f.read(suffix); assert.equal(response.statusCode,suffix.endsWith(hidden.artifactId)?404:200);
    for(const value of [f.otherProject,hidden.artifactId,hidden.contentHash]) assert.equal(response.body.includes(value),false);
    assert.doesNotMatch(response.body,/contentHash|content_hash|workspace_root|Other private bytes/);
  }
});
for(const field of ["title","abstractL0","abstractL1"]) test(`operator sanitizes ${field} across routes`,async(t)=>{
  const f=fixture(t); const row=f.add({[field]:"marker /private/fixture C:\\private\\fixture fpx_synthetic_value\u0000\u202e"});
  for(const suffix of ["/search?q=marker","/artifacts",`/artifacts/${row.artifactId}`]) {
    const response=await f.read(suffix); assert.equal(response.statusCode,200); assert.doesNotMatch(response.body,/private|fpx_|\\u0000|\u202e|contentHash/);
  }
});
test("operator search failure is a fixed service error",async(t)=>{
  const f=fixture(t); f.raw.exec("DROP TABLE knowledge_index"); const response=await f.read("/search?q=marker");
  assert.equal(response.statusCode,503); assert.equal(response.json().error.message,"Search is temporarily unavailable."); assert.doesNotMatch(response.body,/SELECT|SQLITE|knowledge_index/);
});
