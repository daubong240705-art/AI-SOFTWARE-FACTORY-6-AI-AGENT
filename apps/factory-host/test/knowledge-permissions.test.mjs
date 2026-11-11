import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openStorage } from "../dist/storage/database.js";
import { createKnowledgeIndex, visibleToScope, listKnowledgeArtifacts, getKnowledgeArtifact } from "../dist/knowledge/index.js";

const migrationsDir=fileURLToPath(new URL("../migrations/",import.meta.url));
function fixture(t) {
  const storage=openStorage(":memory:"); t.after(()=>storage.close()); storage.migrate({migrationsDir,backupDir:null});
  const raw=storage.raw; const bytes=Buffer.from("Permission body"); const hash=createHash("sha256").update(bytes).digest("hex"); let reads=0;
  const store={get(){reads++;return bytes;},put(){return {hash,size:bytes.length};},has(){return true;},size(){return bytes.length;}};
  const index=createKnowledgeIndex({raw,store});
  for(const project of ["p1","p2"]) {
    raw.prepare("INSERT INTO projects VALUES (?,1,'Project','artifact','unused','active')").run(project);
    raw.prepare(`INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,origin_kind,state,required_capabilities_json,acceptance_json,inputs_json)
      VALUES (?,'task',1,'DOC-001','Task','Goal','Brief','operator','draft','[]','[]','[]')`).run(project);
  }
  for(const team of ["t1","t2"]) {
    raw.prepare("INSERT INTO teams (id,revision,name,charter,pack_key,pack_version,lifecycle) VALUES (?,1,?,'Charter',NULL,NULL,'active')").run(team,team);
    raw.prepare("INSERT INTO seats VALUES (?,?,1,?,'Writer','profile',1,'fake',1,'elastic',NULL,0)").run(`s-${team}`,team,team);
    for(const project of ["p1","p2"]) {
      raw.prepare(`INSERT INTO attempts (project_id,id,task_id,revision,epoch,state,outcome,runtime,provider,model,effort,ended_at)
        VALUES (?,?,'task',1,?,'succeeded','known','fake','fake','fake','medium','2026-11-08T00:00:00.000Z')`)
        .run(project,`${project}-${team}`,team==="t1"?1:2);
      raw.prepare("INSERT INTO attempt_seats VALUES (?,?,?)").run(project,`${project}-${team}`,`s-${team}`);
    }
  }
  const add=(data={})=>{
    const row={projectId:"p1",artifactId:randomUUID(),version:1,status:"draft",visibility:"project",producer:"p1-t1",title:"Permissionmarker",...data};
    raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,
      abstract_l0,produced_by_attempt_id,visibility,created_at) VALUES (?,?,?,'requirements',?,'text/plain',?,?,?,'Abstract',?,?,?)`)
      .run(row.projectId,row.artifactId,row.version,row.title,hash,bytes.length,row.status,row.producer,row.visibility,"2026-11-08T00:00:00.000Z");
    index.indexVersion(row.projectId,row.artifactId,row.version); return row;
  };
  return {raw,index,add,reads:()=>reads};
}
const statuses=["draft","in-review","reviewed","approved","rejected","superseded","withdrawn"];
for(const visibility of ["team-draft","project","organization"]) for(const status of statuses)
  for(const viewer of ["operator","agent"]) for(const projectId of ["p1","p2"]) for(const teamId of ["t1","t2",null]) {
    test(`read policy ${visibility} ${status} ${viewer} ${projectId==="p1"?"same":"other"} team ${teamId??"none"}`,(t)=>{
      const f=fixture(t); const scope={projectId,teamId,viewer};
      if(status==="approved"&&visibility==="team-draft") { assert.throws(()=>f.add({visibility,status}),/CHECK/); return; }
      const row=f.add({visibility,status});
      const expected=projectId==="p1" ? viewer==="operator" || (!["rejected","withdrawn"].includes(status)
        && (visibility!=="team-draft"||teamId==="t1")) : visibility==="organization"&&status==="approved";
      const rule=visibleToScope(scope);
      const visible=f.raw.prepare(`SELECT v.artifact_id FROM artifact_versions v WHERE ${rule.sql}`).all(...rule.params);
      assert.equal(visible.length,expected?1:0);
      assert.equal(f.index.get(scope,{artifactId:row.artifactId})!==null,expected);
      assert.equal(f.index.search(scope,{query:"permissionmarker",latestOnly:false}).length,expected?1:0);
      assert.equal(f.index.get(scope,{artifactId:row.artifactId,version:1})!==null,expected);
    });
  }
for(const viewer of ["operator","agent"]) for(const teamId of ["t1","t2",null]) test(`operator upload draft ${viewer} ${teamId??"none"}`,(t)=>{
  const f=fixture(t); const row=f.add({visibility:"team-draft",producer:null}); const scope={projectId:"p1",viewer,teamId};
  assert.equal(f.index.get(scope,{artifactId:row.artifactId})!==null,viewer==="operator");
});
test("permission is applied before limit and offset, hidden best matches do not consume pages",(t)=>{
  const f=fixture(t); const scope={projectId:"p1",teamId:"t1",viewer:"agent"};
  const visible=[f.add(),f.add(),f.add()];
  const ids=()=>f.index.search(scope,{query:"permissionmarker",limit:2,offset:1}).map(r=>r.artifactId);
  const before=ids();
  for(let i=0;i<25;i++) f.add({visibility:"team-draft",producer:"p1-t2",title:"Permissionmarker Permissionmarker Permissionmarker"});
  assert.deepEqual(ids(),before); assert.equal(f.index.search(scope,"permissionmarker").length,visible.length);
  assert.equal(f.index.search(scope,{query:"permissionmarker",offset:3}).length,0);
});
test("hidden latest versions never hide or shift older visible versions",(t)=>{
  const f=fixture(t); const scope={projectId:"p1",teamId:"t1",viewer:"agent"}; const row=f.add();
  f.add({artifactId:row.artifactId,version:2,visibility:"team-draft",producer:"p1-t2"});
  assert.equal(f.index.search(scope,"permissionmarker")[0].version,1);
  assert.equal(f.index.get(scope,{artifactId:row.artifactId}).version,1);
});
test("hidden and missing IDs use the same metadata path and never read content",(t)=>{
  const f=fixture(t); const row=f.add({projectId:"p2",producer:"p2-t1"}); const scope={projectId:"p1",teamId:"t1",viewer:"agent"};
  const before=f.reads();
  assert.equal(f.index.get(scope,{artifactId:row.artifactId,level:"l2"}),null);
  assert.equal(f.index.get(scope,{artifactId:randomUUID(),level:"l2"}),null); assert.equal(f.reads(),before);
});
test("approved organization sharing is the only cross-project read",(t)=>{
  const f=fixture(t); const scope={projectId:"p1",teamId:"t1",viewer:"agent"};
  for(const status of statuses) f.add({projectId:"p2",producer:"p2-t2",status,visibility:"organization"});
  const results=f.index.search(scope,{query:"permissionmarker",latestOnly:false}); assert.equal(results.length,1);
  assert.equal(results[0].status,"approved"); assert.equal(results[0].visibility,"shared");
});
test("operator artifact browsing cannot cross projects through shared IDs",(t)=>{
  const f=fixture(t); const row=f.add({projectId:"p2",producer:"p2-t2",status:"approved",visibility:"organization"});
  const scope={projectId:"p1",teamId:null,viewer:"operator"};
  assert.deepEqual(listKnowledgeArtifacts(f.raw,scope),[]); assert.equal(getKnowledgeArtifact(f.raw,scope,row.artifactId),null);
});
test("ownership requires a producing attempt in the version's project",(t)=>{
  const f=fixture(t); const row=f.add({visibility:"team-draft",producer:"p1-t2"});
  f.raw.prepare("DELETE FROM attempt_seats WHERE project_id='p1' AND attempt_id='p1-t2'").run();
  assert.equal(f.index.get({projectId:"p1",viewer:"agent",teamId:"t2"},{artifactId:row.artifactId}),null);
});
