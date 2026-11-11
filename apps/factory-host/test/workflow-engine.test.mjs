import assert from "node:assert/strict";
import { test } from "node:test";
import { engineFixture, stage, flow } from "./workflow-engine-fixture.mjs";
import { evaluateWorkflowCondition } from "../dist/workflow/conditions.js";

for(const type of ["finish-to-start","artifact-approved","informs"])for(const state of ["pending","active","done","skipped","failed"])for(const status of ["draft","approved"])
test(`${type} readiness from ${state} with ${status}`,t=>{
  const f=engineFixture(t,flow([stage("author",{outputs:[{kind:"other",mustReach:"draft"}]}),stage("review")],[{from:"author",to:"review",type,...(type==="artifact-approved"?{artifact:"other"}:{})}]));
  f.start(); if(type==="informs"){assert.equal(f.tasks("review").length,1);return;}
  if(state!=="pending"){f.artifact("author","other",status);if(state==="done")f.finish("author");else if(state==="failed")f.move("author","failed");}
  f.raw.prepare("UPDATE workflow_stages SET state=? WHERE instance_id=? AND stage_key='author'").run(state,f.id);
  if(state==="pending")f.raw.prepare("DELETE FROM workflow_stage_tasks WHERE instance_id=? AND stage_key='author'").run(f.id);
  f.run();
  const expected=type==="artifact-approved"?(state==="skipped"||status==="approved"&&state!=="pending"&&state!=="failed"):["done","skipped"].includes(state);
  assert.equal(f.tasks("review").length,Number(expected));
});
for(const policy of ["all","any","quorum"])for(const done of [0,1,2,3])for(const skipped of [false,true])
test(`join ${policy} with ${done} completed members and skipped ${skipped}`,t=>{
 const members=["alpha","bravo","charlie"].map(key=>stage(key,{parallelGroup:"workers"}));
 const f=engineFixture(t,flow([...members,stage("review")],members.map(s=>({from:s.key,to:"review",type:"finish-to-start"})),{joins:[{group:"workers",policy,...(policy==="quorum"?{n:2}:{})}]}));f.start();
 for(const s of members.slice(0,done)){if(skipped)f.raw.prepare("UPDATE workflow_stages SET state='skipped' WHERE instance_id=? AND stage_key=?").run(f.id,s.key);else f.finish(s.key);}
 f.run();assert.equal(f.tasks("review").length,Number(done>=(policy==="any"?1:policy==="quorum"?2:3)));
});
for(const op of ["eq","ne","lt","lte","gt","gte","in"])for(const actual of [1,2,3])
test(`numeric condition ${op} at ${actual}`,()=>{const value=op==="in"?[1,3]:2;const expected={eq:actual===2,ne:actual!==2,lt:actual<2,lte:actual<=2,gt:actual>2,gte:actual>=2,in:[1,3].includes(actual)}[op];assert.equal(evaluateWorkflowCondition({param:"count",op,value},{count:actual},()=>undefined),String(expected));});
for(const fact of ["label","check.result","monitor.value"])for(const wrapper of ["leaf","not","all","any"])
test(`unsupported ${fact} remains unknown in ${wrapper}`,()=>{const leaf={fact,op:"eq",value:"yes"};const c=wrapper==="leaf"?leaf:{[wrapper]:wrapper==="not"?leaf:[leaf]};assert.equal(evaluateWorkflowCondition(c,{},()=>undefined),"unknown");});
test("generated task fields are pinned to the definition",t=>{const f=engineFixture(t,flow([stage("author",{outputs:[{kind:"other",mustReach:"approved"}],sideEffect:"code"})],[]));f.start();const task=f.tasks("author")[0];assert.equal(task.code,"WF-001");assert.equal(task.origin.kind,"operator");assert.equal(task.title,"author");assert.equal(task.goal,"author");assert.match(task.brief,/hasUI=true/);assert.ok(!task.brief.includes("Free text"));assert.deepEqual(task.acceptance,["Register a other artifact and reach approved"]);assert.deepEqual(task.requiredCapabilities,["docs.write"]);assert.equal(task.sideEffect,"artifact");});
test("repeated evaluation and sweep create no duplicates or revisions",t=>{const f=engineFixture(t);f.start();const before=f.view();for(let i=0;i<5;i++){assert.deepEqual(f.run(),[]);f.sweep();}assert.deepEqual(f.view(),before);assert.equal(f.tasks("author").length,1);});
for(const state of ["paused","cancelled","completed","failed","stalled","proposed","draft","suspended","resuming","superseded"])
test(`${state} instances create no tasks`,t=>{const f=engineFixture(t);f.raw.prepare("UPDATE workflow_instances SET state=?,ended_at=? WHERE id=?").run(state,["cancelled","completed","failed","superseded"].includes(state)?f.clock().toISOString():null,f.id);assert.deepEqual(f.run(),[]);assert.equal(f.tasks("author").length,0);});
test("required failure stalls and retry plus resume recovers",t=>{const f=engineFixture(t);f.start();f.move("author","active");f.move("author","failed");f.run();assert.equal(f.view().state,"stalled");f.move("author","active");assert.equal(f.command("resume").status,200);assert.equal(f.view().state,"active");f.finish("author");f.run();assert.equal(f.tasks("review").length,1);f.finish("review");f.run();assert.equal(f.view().state,"completed");assert.ok(f.view().endedAt);});
test("optional failure is skipped and downstream progresses",t=>{const f=engineFixture(t,flow([stage("author",{optional:true}),stage("review")]));f.start();f.move("author","active");f.move("author","failed");f.run();assert.equal(f.view().stages[0].state,"skipped");assert.equal(f.tasks("review").length,1);});
for(const approved of [false,true])test(`approved project artifact skipIf ${approved}`,t=>{const f=engineFixture(t,flow([stage("author"),stage("review",{skipIf:{fact:"project.hasApprovedArtifact",kind:"other",op:"eq",value:true}})]));f.start();f.artifact("author","other",approved?"approved":"draft");f.finish("author");f.run();assert.equal(f.view().stages[1].state,approved?"skipped":"active");});
for(const status of ["draft","in-review","reviewed","approved","superseded","rejected","withdrawn"])for(const mustReach of ["draft","reviewed","approved"])
test(`output ${status} must reach ${mustReach}`,t=>{const f=engineFixture(t,flow([stage("author",{outputs:[{kind:"other",mustReach}]})],[]));f.start();f.artifact("author","other",status);f.finish("author");f.run();const rank={draft:0,"in-review":0,reviewed:1,approved:2,superseded:2};assert.equal(f.view().state,(rank[status]??-1)>=rank[mustReach]?"completed":"active");});
test("wrong artifact kind cannot complete a stage",t=>{const f=engineFixture(t,flow([stage("author",{outputs:[{kind:"other",mustReach:"approved"}]})],[]));f.start();f.artifact("author","requirements","approved");f.finish("author");f.run();assert.equal(f.view().state,"active");});
test("approved upstream inputs are pinned",t=>{const f=engineFixture(t,flow([stage("author"),stage("review",{inputs:[{kind:"other",required:true}]})]));f.start();const ref=f.artifact("author");f.finish("author");f.run();assert.deepEqual(f.tasks("review")[0].inputs,[ref]);});
test("maxTasks is an upper bound, never a request to create more tasks",t=>{const f=engineFixture(t,flow([stage("author",{limits:{maxTasks:5,budgetShare:0.5}})],[]));f.start();f.run();assert.equal(f.tasks("author").length,1);});
for(const kind of ["execution-gate","irreversible-action","review"])for(const condition of ["absent","true","false","unknown"])
test(`${kind} gate when ${condition}`,t=>{const when=condition==="absent"?{}:{when:condition==="unknown"?{fact:"label",name:"ready",op:"eq",value:"yes"}:{param:"hasUI",op:"eq",value:condition==="true"}};const f=engineFixture(t,flow([stage("author")],[],{gates:[{before:"author",kind,approver:"operator",...when}]}));f.start();if(condition==="unknown"){assert.equal(f.tasks("author").length,0);assert.match(f.view().stages[0].blockedReason,/warning/);}else{const task=f.tasks("author")[0];assert.equal(task.gate.requiresGo,kind!=="review"&&condition!=="false");assert.equal(task.reviewPolicy,"human-final");}});
