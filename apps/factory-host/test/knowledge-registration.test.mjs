import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { openStorage } from "../dist/storage/database.js";
import { createContentStore } from "../dist/artifacts/content-store.js";
import { registerAgentOutput, registerAttemptResults } from "../dist/artifacts/service.js";
import { createKnowledgeIndex } from "../dist/knowledge/index.js";
import { appendAttemptEvent } from "../dist/dispatch/index.js";

const migrationsDir=fileURLToPath(new URL("../migrations/",import.meta.url));
function fixture(t) {
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),"factory-knowledge-registration-")));
  const storage=openStorage(":memory:"); storage.migrate({migrationsDir,backupDir:null}); const raw=storage.raw;
  t.after(()=>{storage.close(); assert.ok(resolve(root).startsWith(fs.realpathSync(tmpdir())+sep+"factory-knowledge-registration-")); fs.rmSync(root,{recursive:true,force:true});});
  const projectId=randomUUID(); const taskId=randomUUID(); const attemptId=randomUUID(); const now=()=>new Date();
  raw.prepare("INSERT INTO projects VALUES (?,1,'Knowledge','artifact','unused','active')").run(projectId);
  raw.prepare(`INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,origin_kind,state,required_capabilities_json,acceptance_json,inputs_json)
    VALUES (?,?,1,'KN-001','Task','Goal','Brief','operator','active','[]','[]','[]')`).run(projectId,taskId);
  raw.prepare("INSERT INTO nodes (id,revision,name,platform,trust,state,slots_total,slots_used) VALUES ('local',1,'Local','linux','trusted-workstation','online',1,0)").run();
  raw.prepare(`INSERT INTO attempts (project_id,id,task_id,revision,epoch,state,outcome,runtime,provider,model,effort,node_id,lease_id,lease_expires_at)
    VALUES (?,?,?,1,1,'running','known','fake','fake','fake','medium','local','lease',?)`)
    .run(projectId,attemptId,taskId,new Date(Date.now()+600000).toISOString());
  const workspacePath=join(root,"workspace"); const evidenceDir=join(root,"evidence"); fs.mkdirSync(workspacePath); fs.mkdirSync(evidenceDir);
  const store=createContentStore({dir:join(root,"content")}); const knowledge=createKnowledgeIndex({raw,store});
  const scope={projectId,teamId:null,viewer:"operator"}; const observations=[];
  const search=(query)=>knowledge.search(scope,{query,latestOnly:false});
  const afterRegister=(ref)=>{
    assert.equal(raw.inTransaction,true); assert.equal(knowledge.indexVersion(ref.projectId,ref.artifactId,ref.version),true);
    observations.push({ref,searchable:search("registrationmarker").some(row=>row.artifactId===ref.artifactId&&row.version===ref.version)});
  };
  const deps={raw,store,now,newId:randomUUID,afterRegister};
  const grant={projectId,taskId,attemptId,epoch:1,allowedModels:[],expiresAt:Infinity,workspacePath};
  const agent=(overrides={})=>{
    fs.writeFileSync(join(workspacePath,"result.md"),"# Registrationmarker\n\nDistinctbodymarker\n");
    return registerAgentOutput({...deps,...overrides},{grant,title:"Registrationmarker",kind:"requirements",mediaType:"text/markdown",
      path:"result.md",abstractL0:"Registered deliverable",inputs:[]});
  };
  const results=(overrides={})=>registerAttemptResults({...deps,...overrides},{projectId,taskId,attemptId,epoch:1,
    outcome:"completed",summary:"Registrationmarker summary\n\nDistinctbodymarker",evidenceDir});
  const evidence=(body="diff --git a/change.txt b/change.txt\n+diffbodymarker\n")=>{
    fs.writeFileSync(join(evidenceDir,`${attemptId}.patch`),body);
    appendAttemptEvent(raw,{projectId,attemptId,kind:"evidence",at:now().toISOString(),body:{
      files:[{path:"change.txt",status:"modified"}],totals:{files:1,additions:1,deletions:0},patchSafe:true,patchTruncated:false,
      patchFile:`${attemptId}.patch`,patchSha256:createHash("sha256").update(body).digest("hex"),
    }});
  };
  return {raw,store,knowledge,projectId,taskId,attemptId,observations,search,agent,results,evidence};
}

test("agent markdown registration is searchable inside the registration transaction",(t)=>{
  const f=fixture(t); const ref=f.agent(); assert.deepEqual(f.observations,[{ref:{projectId:f.projectId,artifactId:ref.artifactId,version:1},searchable:true}]);
  assert.deepEqual(f.search("distinctbodymarker").map(row=>row.artifactId),[ref.artifactId]); assert.equal(f.knowledge.stats().missing,0);
});
test("attempt markdown results are searchable inside the registration transaction",(t)=>{
  const f=fixture(t); f.evidence(); const refs=f.results(); assert.equal(refs.length,2); assert.equal(f.observations.length,2);
  const summary=refs.find(ref=>ref.kind==="other"); assert.equal(f.observations.find(row=>row.ref.artifactId===summary.artifactId).searchable,true);
  assert.deepEqual(f.search("distinctbodymarker").map(row=>row.artifactId),[summary.artifactId]); assert.equal(f.knowledge.stats().missing,0);
});
for(const mode of ["agent","results"]) test(`${mode} calls its index hook for each newly created version`,(t)=>{
  const f=fixture(t); if(mode==="results") f.evidence(); const refs=mode==="agent"?[f.agent()]:f.results();
  assert.deepEqual(f.observations.map(row=>row.ref),refs.map(ref=>({projectId:f.projectId,artifactId:ref.artifactId,version:ref.version})));
  if(mode==="agent") { const second=f.agent(); assert.equal(second.version,2); assert.equal(f.observations.length,2); }
  else { assert.deepEqual(f.results(),[]); assert.equal(f.observations.length,2); }
});
for(const mode of ["agent","results"]) test(`${mode} succeeds when its index hook throws and backfill recovers`,(t)=>{
  const f=fixture(t); if(mode==="results") f.evidence(); let calls=0;
  const override={afterRegister(){calls++; assert.equal(f.raw.inTransaction,true); throw new Error("Index unavailable");}};
  const refs=mode==="agent"?[f.agent(override)]:f.results(override);
  assert.equal(refs.length,mode==="agent"?1:2); assert.equal(calls,refs.length);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM artifact_versions").get().n,refs.length); assert.equal(f.knowledge.stats().missing,refs.length);
  assert.equal(f.search("registrationmarker").length,0); assert.deepEqual(f.knowledge.indexAllMissing(),{indexed:refs.length,remaining:0});
  assert.equal(f.search("registrationmarker").length,1);
});
for(const mode of ["agent","results"]) test(`${mode} registration works without an optional hook`,(t)=>{
  const f=fixture(t); if(mode==="results") f.evidence();
  const refs=mode==="agent"?[f.agent({afterRegister:undefined})]:f.results({afterRegister:undefined});
  assert.equal(refs.length,mode==="agent"?1:2); assert.equal(f.knowledge.stats().indexed,0); assert.equal(f.observations.length,0);
});
for(const mode of ["agent","results"]) test(`${mode} index writes roll back with the surrounding transaction`,(t)=>{
  const f=fixture(t); if(mode==="results") f.evidence();
  assert.throws(()=>f.raw.transaction(()=>{ if(mode==="agent") f.agent(); else f.results();
    assert.ok(f.knowledge.stats().indexed>0); throw new Error("Rollback"); })(),/Rollback/);
  assert.equal(f.knowledge.stats().indexed,0); assert.equal(f.raw.prepare("SELECT count(*) AS n FROM artifact_versions").get().n,0);
  assert.equal(f.search("registrationmarker").length,0);
});
test("preexisting unindexed markdown becomes searchable after missing backfill",(t)=>{
  const f=fixture(t); const ref=f.agent({afterRegister:undefined}); assert.equal(f.search("registrationmarker").length,0);
  assert.deepEqual(f.knowledge.indexAllMissing(),{indexed:1,remaining:0}); assert.equal(f.search("registrationmarker")[0].artifactId,ref.artifactId);
  assert.deepEqual(f.knowledge.indexAllMissing(),{indexed:0,remaining:0});
});
test("rebuild is idempotent after both registration paths",async(t)=>{
  const f=fixture(t); f.agent(); f.evidence(); f.results(); const before=f.search("registrationmarker");
  const first=await f.knowledge.rebuild(); const second=await f.knowledge.rebuild();
  assert.deepEqual(first,second); assert.equal(first.indexed,3); assert.deepEqual(f.search("registrationmarker"),before);
});
test("diff results index metadata and omit body text",(t)=>{
  const f=fixture(t); f.evidence(); const diff=f.results().find(ref=>ref.kind==="code-ref");
  assert.equal(f.search("diffbodymarker").length,0); assert.equal(f.search("changes")[0].artifactId,diff.artifactId);
  assert.equal(f.search("files changed")[0].artifactId,diff.artifactId); assert.equal(f.search("change txt")[0].artifactId,diff.artifactId);
  assert.equal(f.raw.prepare("SELECT body_indexed FROM knowledge_indexed WHERE artifact_id=?").get(diff.artifactId).body_indexed,0);
});
