import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { engineFixture, flow, stage } from "./workflow-engine-fixture.mjs";
import { proposePatch, decidePatch } from "../dist/workflow/patch.js";
const extra = {op:"addTaskWithinStage",stage:"author",title:"Evidence"};
const skip = {op:"skipOptionalStage",stage:"review"};
const add = {op:"addStage",stage:stage("added"),after:"author"};
const def = allowedPatches=>flow([stage("author",{limits:{maxTasks:50,budgetShare:1}}),stage("review",{optional:true})],[],{allowedPatches});
const propose=(f,ops,proposedBy="lead")=>proposePatch(f.deps,{projectId:f.projectId,instanceId:f.id,ops,reason:"Improve plan",proposedBy});
for(const policy of ["auto","approval","operator"])for(const proposedBy of ["operator","lead"])for(const mixed of [false,true])
  test(`policy matrix ${policy} ${proposedBy} mixed ${mixed}`,t=>{
    const f=engineFixture(t,def({addTaskWithinStage:policy,skipOptionalStage:"auto"}));const before=f.view().revision;
    const p=propose(f,mixed?[extra,skip]:[extra],proposedBy);assert.equal(p.policy,policy);const applies=policy==="auto"||proposedBy==="operator";
    assert.equal(p.state,applies?"applied":"pending");assert.equal(f.view().revision,before+Number(applies));assert.equal(f.view().stages[0].extraTasks,Number(applies));
  });
for(const left of ["auto","approval","operator"])for(const right of ["auto","approval","operator"])for(const reverse of [false,true])
  test(`strictest policy ${left} and ${right} reverse ${reverse}`,t=>{
    const f=engineFixture(t,def({addTaskWithinStage:left,skipOptionalStage:right}));const p=propose(f,reverse?[skip,extra]:[extra,skip]);
    const ranks=["auto","approval","operator"];assert.equal(p.policy,ranks[Math.max(ranks.indexOf(left),ranks.indexOf(right))]);
    assert.equal(p.state,p.policy==="auto"?"applied":"pending");
  });
for(const policy of ["approval","operator"])for(const decision of ["approve","reject"])test(`operator decides ${policy} ${decision}`,t=>{
  const f=engineFixture(t,def({addTaskWithinStage:policy}));const p=propose(f,[extra]);const revision=f.view().revision;
  const d=decidePatch(f.deps,{projectId:f.projectId,patchId:p.id,decision,comment:"Reviewed"});assert.equal(d.state,decision==="approve"?"applied":"rejected");assert.equal(d.comment,"Reviewed");assert.ok(d.decidedAt);assert.equal(f.view().revision,revision+Number(decision==="approve"));
  assert.throws(()=>decidePatch(f.deps,{projectId:f.projectId,patchId:p.id,decision}),{code:"conflict"});
});
test("approval revalidates and refuses stale patch",t=>{const f=engineFixture(t,def({addStage:"approval"}));const p=propose(f,[add]);propose(f,[add],"operator");const before=f.view().revision;const result=decidePatch(f.deps,{projectId:f.projectId,patchId:p.id,decision:"approve"});assert.equal(result.state,"refused");assert.equal(result.refusal,"stale");assert.equal(f.view().revision,before);});
test("unrelated current changes do not invalidate an approval",t=>{const f=engineFixture(t,def({addStage:"approval"}));const p=propose(f,[add]);propose(f,[extra],"operator");const d=decidePatch(f.deps,{projectId:f.projectId,patchId:p.id,decision:"approve"});assert.equal(d.state,"applied");assert.equal(f.view().definitionRevision,3);});
test("terminal approval is stale",t=>{const f=engineFixture(t,def({addStage:"approval"}));const p=propose(f,[add]);f.raw.prepare("UPDATE workflow_instances SET state='cancelled',ended_at=? WHERE id=?").run(f.clock().toISOString(),f.id);assert.equal(decidePatch(f.deps,{projectId:f.projectId,patchId:p.id,decision:"approve"}).refusal,"stale");});
test("pending cap is three and rejection frees capacity",t=>{const f=engineFixture(t,def({addStage:"approval"}));const pending=Array.from({length:3},()=>propose(f,[add]));assert.throws(()=>propose(f,[add]),{code:"conflict"});decidePatch(f.deps,{projectId:f.projectId,patchId:pending[0].id,decision:"reject"});assert.equal(propose(f,[add]).number,4);});
test("operator application is allowed with three pending patches",t=>{const f=engineFixture(t,def({addStage:"approval"}));for(let i=0;i<3;i++)propose(f,[add]);assert.equal(propose(f,[extra],"operator").state,"applied");});
test("fifty patches includes refusals and numbering never resets",t=>{const f=engineFixture(t,def({}));for(let i=0;i<50;i++){const p=propose(f,[{...extra,stage:"missing"}]);assert.equal(p.number,i+1);assert.equal(p.state,"refused");}assert.throws(()=>propose(f,[extra]),{code:"conflict"});assert.equal(f.view().patches.length,50);assert.equal(f.view().patches[0].number,50);});
test("unknown patch and cross project decisions are not found",t=>{const f=engineFixture(t,def({addStage:"approval"}));const p=propose(f,[add]);for(const input of [{projectId:f.projectId,patchId:randomUUID()},{projectId:f.project(),patchId:p.id}])assert.throws(()=>decidePatch(f.deps,{...input,decision:"approve"}),{code:"not-found"});});
test("decide command replay applies once",t=>{const f=engineFixture(t,def({addStage:"approval"}));const p=propose(f,[add]);const command={apiVersion:1,commandId:randomUUID(),projectId:f.projectId,type:"workflows.decide-patch",payload:{patchId:p.id,decision:"approve"}};assert.equal(f.pipeline.execute(command).status,200);assert.equal(f.pipeline.execute(command).replayed,true);assert.equal(f.view().definitionRevision,2);});
test("operator command rejects non operator actors",t=>{const f=engineFixture(t,def({}));const result=f.pipeline.execute({apiVersion:1,commandId:randomUUID(),projectId:f.projectId,type:"workflows.patch",payload:{instanceId:f.id,expectedRevision:1,ops:[extra],reason:"Evidence"}},"lead");assert.equal(result.status,400);assert.equal(f.view().patches.length,0);});
test("decision comment is sanitised",t=>{const f=engineFixture(t,def({addStage:"approval"}));const p=propose(f,[add]);assert.equal(decidePatch(f.deps,{projectId:f.projectId,patchId:p.id,decision:"reject",comment:"Reviewed [private] /hidden/file"}).comment,"Reviewed");});
