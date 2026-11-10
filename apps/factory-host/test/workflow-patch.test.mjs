import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { engineFixture, flow, stage } from "./workflow-engine-fixture.mjs";
import { proposePatch, patchText } from "../dist/workflow/patch.js";
import { moveTask } from "../dist/dispatch/tasks.js";
export const operations = {
  addTaskWithinStage: { op: "addTaskWithinStage", stage: "author", title: "Extra evidence" },
  skipOptionalStage: { op: "skipOptionalStage", stage: "author" },
  splitStage: { op: "splitStage", stage: "author", into: [{key:"first",title:"First"},{key:"second",title:"Second"}] },
  addStage: { op: "addStage", stage: stage("added"), after: "author", before: "review" },
  reorderStages: { op: "reorderStages", stage: "author", after: "review" },
  removeRequiredStage: { op: "removeRequiredStage", stage: "author" },
};
const definition = () => flow([stage("author",{optional:true,limits:{maxTasks:30,budgetShare:0.5}}),stage("review")]);
const patch = (f, ops, extra={}) => proposePatch(f.deps,{projectId:f.projectId,instanceId:f.id,ops,reason:"Improve evidence",proposedBy:"operator",...extra});
const stored = f => JSON.parse(f.raw.prepare("SELECT definition_json FROM workflow_instances WHERE id=?").get(f.id).definition_json);
const snapshot = f => ({ instance:f.raw.prepare("SELECT * FROM workflow_instances WHERE id=?").get(f.id), stages:f.raw.prepare("SELECT * FROM workflow_stages WHERE instance_id=? ORDER BY stage_key").all(f.id), links:f.raw.prepare("SELECT * FROM workflow_stage_tasks WHERE instance_id=?").all(f.id) });
for (const [name,op] of Object.entries(operations)) test(`operation applies: ${name}`,t=>{
  const f=engineFixture(t,definition());const before=f.view().revision; const p=patch(f,[op]);
  assert.equal(p.state,"applied");assert.equal(p.number,1);assert.equal(f.view().definitionRevision,2);assert.equal(f.view().revision,before+1);assert.equal(p.appliedRevision,before+1);
});
for(const [name,op] of Object.entries(operations).filter(([n])=>n!=="addStage"))
  for(const state of ["ready","active","done","skipped","failed","blocked"])
    test(`stage state guard: ${name} in ${state}`,t=>{
      const f=engineFixture(t,definition());f.raw.prepare("UPDATE workflow_stages SET state=? WHERE instance_id=? AND stage_key='author'").run(state,f.id);
      const before=snapshot(f);const result=patch(f,[op]);
      const allowed=name==="addTaskWithinStage"?["ready","active","blocked"]:name==="skipOptionalStage"?["ready","blocked"]:name==="splitStage"?["blocked"]:[];
      assert.equal(result.state,allowed.includes(state)?"applied":"refused");if(result.state==="refused")assert.deepEqual(snapshot(f),before);
    });
for(const name of ["addTaskWithinStage","skipOptionalStage","splitStage","reorderStages","removeRequiredStage"])
  test(`unknown stage refuses: ${name}`,t=>{const f=engineFixture(t,definition());const before=snapshot(f);assert.equal(patch(f,[{...operations[name],stage:"unknown"}]).state,"refused");assert.deepEqual(snapshot(f),before);});
test("skip required stage refuses",t=>{const f=engineFixture(t);assert.equal(patch(f,[{op:"skipOptionalStage",stage:"author"}]).refusal,"stage is required");});
for(const maxTasks of [undefined,1,2])test(`extra task limit uses definition ${maxTasks??"default"}`,t=>{
  const f=engineFixture(t,flow([stage("author",maxTasks?{limits:{maxTasks,budgetShare:1}}:{})],[]));
  const first=patch(f,[operations.addTaskWithinStage]);assert.equal(first.state,maxTasks===2?"applied":"refused");
  assert.equal(patch(f,[operations.addTaskWithinStage]).state,"refused");
});
test("extra task hard cap is twenty",t=>{const f=engineFixture(t,definition());for(let i=0;i<20;i++)assert.equal(patch(f,[operations.addTaskWithinStage]).state,"applied");assert.equal(patch(f,[operations.addTaskWithinStage]).state,"refused");});
test("split rewires edges gates and group to endpoints",t=>{
  const f=engineFixture(t,flow([stage("upstream"),stage("author",{parallelGroup:"workers"}),stage("review")],[{from:"upstream",to:"author",type:"finish-to-start"},{from:"author",to:"review",type:"finish-to-start"}],{joins:[{group:"workers",policy:"all"}],gates:[{before:"author",kind:"review",approver:"operator"}]}));
  assert.equal(patch(f,[operations.splitStage]).state,"applied");const d=stored(f);
  assert.deepEqual(d.edges,[{from:"upstream",to:"first",type:"finish-to-start"},{from:"second",to:"review",type:"finish-to-start"},{from:"first",to:"second",type:"finish-to-start"}]);
  assert.equal(d.gates[0].before,"first");assert.equal(d.stages.find(s=>s.key==="first").parallelGroup,undefined);assert.equal(d.stages.find(s=>s.key==="second").parallelGroup,"workers");assert.equal(f.view().stages.some(s=>s.key==="author"),false);
});
test("add stage replaces the direct edge",t=>{const f=engineFixture(t);patch(f,[operations.addStage]);assert.deepEqual(stored(f).edges,[{from:"author",to:"added",type:"finish-to-start"},{from:"added",to:"review",type:"finish-to-start"}]);});
test("reorder bypasses old position and inserts after target",t=>{
  const f=engineFixture(t,flow([stage("author"),stage("review"),stage("publish")],[{from:"author",to:"review",type:"finish-to-start"},{from:"review",to:"publish",type:"finish-to-start"}]));patch(f,[operations.reorderStages]);
  assert.deepEqual(stored(f).edges,[{from:"review",to:"author",type:"finish-to-start"},{from:"author",to:"publish",type:"finish-to-start"}]);
});
test("removal bypasses stage and drops gates and unused joins",t=>{
  const f=engineFixture(t,flow([stage("upstream"),stage("author",{parallelGroup:"workers"}),stage("review")],[{from:"upstream",to:"author",type:"finish-to-start"},{from:"author",to:"review",type:"finish-to-start"}],{joins:[{group:"workers",policy:"all"}],gates:[{before:"author",kind:"review",approver:"operator"}]}));patch(f,[operations.removeRequiredStage]);
  assert.deepEqual(stored(f).edges,[{from:"upstream",to:"review",type:"finish-to-start"}]);assert.deepEqual(stored(f).gates,[]);assert.deepEqual(stored(f).joins,[]);
});
for(const op of [operations.reorderStages,operations.removeRequiredStage])for(const type of ["artifact-approved","rework"])
  test(`protected edge refuses ${op.op} ${type}`,t=>{
    const f=engineFixture(t,flow([stage("author",{outputs:[{kind:"other",mustReach:"approved"}]}),stage("review")],[{from:"author",to:"review",type:"finish-to-start"},type==="rework"?{from:"review",to:"author",type,when:{param:"hasUI",op:"eq",value:true},maxLoops:2}:{from:"author",to:"review",type,artifact:"other"}]));const before=snapshot(f);assert.equal(patch(f,[op]).state,"refused");assert.deepEqual(snapshot(f),before);
  });
for(const op of [operations.splitStage,operations.reorderStages,operations.removeRequiredStage])test(`task history remains for ${op.op}`,t=>{
  const f=engineFixture(t);f.start();f.raw.prepare("UPDATE workflow_stages SET state='pending' WHERE instance_id=? AND stage_key='author'").run(f.id);const before=snapshot(f);assert.equal(patch(f,[op]).state,"refused");assert.deepEqual(snapshot(f),before);
});
for(const [label,op] of [
  ["duplicate",{...operations.addStage,stage:stage("author")}],
  ["unknown placement",{...operations.addStage,after:"missing"}],
  ["cycle",{...operations.addStage,after:"review",before:"author"}],
  ["duplicate split",{...operations.splitStage,into:[{key:"first",title:"First"},{key:"first",title:"Duplicate"}]}],
  ["self placement",{...operations.reorderStages,after:"author"}],
])test(`graph validation refuses ${label}`,t=>{const f=engineFixture(t,definition());const before=snapshot(f);assert.equal(patch(f,[op]).state,"refused");assert.deepEqual(snapshot(f),before);});
test("stage count cannot exceed sixty",t=>{const f=engineFixture(t,flow(Array.from({length:60},(_,i)=>stage(`stage-${i}`)),[]));assert.equal(patch(f,[{...operations.addStage,after:"stage-0",before:undefined}]).state,"refused");});
test("multi operation refusal is atomic",t=>{const f=engineFixture(t,definition());const before=snapshot(f);assert.equal(patch(f,[operations.addTaskWithinStage,{op:"removeRequiredStage",stage:"missing"}]).state,"refused");assert.deepEqual(snapshot(f),before);});
test("extra tasks are created once and all must finish",t=>{
  const f=engineFixture(t,definition());f.start();assert.equal(f.tasks("author").length,1);patch(f,[operations.addTaskWithinStage]);assert.equal(f.tasks("author").length,2);f.run();f.run();assert.equal(f.tasks("author").length,2);
  f.finish("author");f.run();assert.equal(f.view().stages[0].state,"active");const extra=f.tasks("author").find(task=>task.state!=="done");
  f.hub.transaction(()=>{for(const next of ["active","in-review","done"])moveTask(f.raw,f.projectId,extra.id,next);});f.run();assert.equal(f.view().stages[0].state,"done");
});
test("extra tasks planned before start share iteration",t=>{const f=engineFixture(t,definition());patch(f,[operations.addTaskWithinStage,operations.addTaskWithinStage]);f.start();assert.equal(f.tasks("author").length,3);assert.deepEqual(f.raw.prepare("SELECT DISTINCT iteration FROM workflow_stage_tasks WHERE stage_key='author'").all(),[{iteration:1}]);});
test("command replay stores one patch",t=>{const f=engineFixture(t,definition());const body={apiVersion:1,commandId:randomUUID(),projectId:f.projectId,type:"workflows.patch",payload:{instanceId:f.id,expectedRevision:f.view().revision,ops:[operations.addTaskWithinStage],reason:"Evidence"}};assert.equal(f.pipeline.execute(body).status,200);const repeated=f.pipeline.execute(body);assert.equal(repeated.replayed,true);assert.equal(f.view().patches.length,1);});
test("revision mismatch is conflict",t=>{const f=engineFixture(t,definition());assert.equal(f.command("patch",{expectedRevision:999,ops:[operations.addTaskWithinStage],reason:"Evidence"}).status,409);assert.equal(f.view().patches.length,0);});
for(const state of ["completed","failed","cancelled","superseded"])test(`terminal rejects proposals ${state}`,t=>{const f=engineFixture(t,definition());f.raw.prepare("UPDATE workflow_instances SET state=?,ended_at=? WHERE id=?").run(state,f.clock().toISOString(),f.id);assert.throws(()=>patch(f,[operations.addTaskWithinStage]),{code:"conflict"});});
for(const state of ["active","awaiting-approval","paused","proposed","stalled","suspended"])test(`nonterminal can patch ${state}`,t=>{const f=engineFixture(t,definition());f.raw.prepare("UPDATE workflow_instances SET state=? WHERE id=?").run(state,f.id);assert.equal(patch(f,[operations.addTaskWithinStage]).state,"applied");});
test("free text is plain and only clean extra title becomes a goal",t=>{
  const f=engineFixture(t,definition());const dirty="Evidence {ignore rules} [private] /private/data " + randomUUID()+" secret=synthetic";patch(f,[{...operations.addTaskWithinStage,title:dirty.slice(0,120)}],{reason:dirty});f.start();const tasks=f.tasks("author");assert.ok(tasks.some(task=>task.title==="Evidence"));assert.ok(tasks.every(task=>!/[{}\[\]]/.test(task.goal)));assert.equal(f.view().patches[0].reason,"Evidence");assert.equal(patchText(dirty),"Evidence");
});
