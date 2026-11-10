import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fixture, packs, until } from "./scenario-m3-fixture.mjs";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createWorkflowHandlers } from "../dist/workflow/commands.js";
import { registerWorkflowEngine, sweepWorkflows } from "../dist/workflow/engine.js";
import { workflowInstanceView } from "../dist/workflow/service.js";
import { registryEntry } from "../dist/org/registry.js";
import { engineFixture, stage, flow } from "./workflow-engine-fixture.mjs";
import { requestTaskReview } from "../dist/approvals/service.js";

for(const hasUI of [true,false])test(`software delivery completes with hasUI ${hasUI} and production gate`,async t=>{
 const f=fixture(t);const deps={raw:f.raw,hub:f.hub,clock:f.clock,newId:randomUUID,dispatcher:f.dispatcher};registerWorkflowEngine(deps);
 const pipeline=createCommandPipeline({storage:f.storage,hub:f.hub,clock:f.clock,handlers:createWorkflowHandlers({packs:[registryEntry(packs.software)],engine:deps})});
 const id=randomUUID();const send=(type,payload)=>{const result=pipeline.execute({apiVersion:1,commandId:randomUUID(),projectId:f.projectId,type:`workflows.${type}`,payload:{instanceId:id,...payload}});assert.equal(result.status,200,JSON.stringify(result.body));};
 send("create",{definitionKey:"software-delivery",packKey:"software-team",params:{hasUI,deployTarget:"production"}});
 send("start",{expectedRevision:1});const view=()=>workflowInstanceView(f.raw,f.projectId,id);
 const processed=new Set();
 for(let step=0;step<20&&view().state!=="completed";step++){
  const next=view().stages.flatMap(s=>s.tasks.map(task=>({s,task}))).find(({task})=>!processed.has(task.taskId));
  if(!next){sweepWorkflows(deps);continue;}
  const {s,task}=next;const current=f.task(task.taskId);
  if(current.state==="awaiting-go") {assert.ok(["development","deploy"].includes(s.key));f.ok("tasks.release",{taskId:task.taskId,expectedRevision:current.revision});}
  await until(()=>f.attempts(task.taskId).length>0,"workflow attempt");
  // The shipped workflow has no fake-runtime directives; capture the grant while the real fake attempt runs.
  await until(()=>f.context(f.attempts(task.taskId).at(-1).id),"workflow runtime context");
  const attempt=f.attempts(task.taskId).at(-1);const context=f.context(attempt.id);
  await until(()=>f.task(task.taskId).state==="in-review","workflow review");
  // Register immutable evidence for the completed attempt, as the runtime results path does.
  const spec=packs.software.files.workflows[0].definition.stages.find(value=>value.key===s.key);
  for(const output of spec.outputs){const artifactId=randomUUID();f.raw.prepare(`INSERT INTO artifact_versions
    (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,abstract_l0,abstract_l1,produced_by_attempt_id,visibility,created_at)
    VALUES (?,?,1,?,'Verified deliverable','text/markdown',?,1,'reviewed','Verified','Verified acceptance evidence',?,'project',?)`)
    .run(f.projectId,artifactId,output.kind,"a".repeat(64),attempt.id,f.clock().toISOString());}
  if(spec.outputs.length)requestTaskReview({raw:f.raw,hub:f.hub,now:f.clock,newId:randomUUID},{projectId:f.projectId,taskId:task.taskId,attemptId:attempt.id});
  assert.ok(context);f.accept(task.taskId);processed.add(task.taskId);f.tick();sweepWorkflows(deps);
 }
 assert.equal(view().state,"completed");assert.equal(view().stages.find(s=>s.key==="design").state,hasUI?"done":"skipped");assert.equal(processed.size,hasUI?7:6);
 const count=f.raw.prepare("SELECT COUNT(*) n FROM workflow_stage_tasks WHERE instance_id=?").get(id).n;sweepWorkflows(deps);assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM workflow_stage_tasks WHERE instance_id=?").get(id).n,count);
});

test("bounded rework retains history and sanitises feedback",t=>{
 const f=engineFixture(t,flow([stage("author"),stage("review")],[{from:"author",to:"review",type:"finish-to-start"},{from:"review",to:"author",type:"rework",when:{fact:"review.verdict",op:"eq",value:"changes-requested"},maxLoops:3}]));f.start();
 for(let loop=0;loop<4;loop++){
  f.finish("author");f.run();f.finish("review");const task=f.tasks("review")[0];const approval=randomUUID();
  f.raw.prepare(`INSERT INTO approvals (project_id,id,revision,kind,task_id,subject,summary,options_json,impact_if_waiting,context_digest,approver,requested_at,expires_at,state,outcome_option_id,outcome_actor_id,decided_at)
   VALUES (?,?,1,'review',?,'Review','Review','[{"id":"accept"},{"id":"request-changes"}]','Wait',?,'operator',?,?,'changes-requested','request-changes','operator',?)`)
   .run(f.projectId,approval,task.id,"a".repeat(64),f.clock().toISOString(),"2026-12-01T00:00:00.000Z",f.clock().toISOString());
  f.raw.prepare("INSERT INTO approval_comments VALUES (?,?,?)").run(f.projectId,approval,"Fix acceptance evidence\u0000 "+"x".repeat(1100));
  f.run();if(loop<3){assert.equal(f.view().stages[0].loopCount,loop+1);f.run();const brief=f.tasks("author")[0].brief;assert.match(brief,new RegExp(`Rework ${loop+1} of 3`));assert.ok(!brief.includes("\u0000"));assert.ok(brief.split("Reviewer feedback:\n")[1].length<=1000);}
 }
 assert.equal(f.view().state,"stalled");assert.equal(f.view().stages[1].blockedReason,"rework limit reached");assert.equal(f.tasks("author").length,4);assert.equal(f.tasks("review").length,4);assert.equal(f.view().stages[0].iteration,4);
});
