import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { engineFixture, flow, stage } from "./workflow-engine-fixture.mjs";
import { createWorkflowPatchMcp } from "../dist/workflow/mcp.js";
import { createMcpHandler } from "../dist/mcp/rpc.js";
import { createToolPolicy } from "../dist/mcp/policy.js";
import { packManifestSchema } from "../dist/org/pack.js";
const input={ops:[{op:"addTaskWithinStage",stage:"author",title:"Evidence"}],reason:"Extra evidence"};
const unavailable={content:[{type:"text",text:"tool is not available"}],isError:true};
function setup(t,tools=["workflow.patch"]){
  const f=engineFixture(t,flow([stage("author",{limits:{maxTasks:50,budgetShare:1}}),stage("review")]),{});f.start();
  const taskId=f.tasks("author")[0].id;f.raw.prepare("UPDATE tasks SET state='active' WHERE id=?").run(taskId);const attempt=f.enqueue(taskId);
  const row=f.raw.prepare("SELECT t.pack_digest AS digest,p.manifest_json AS manifest FROM teams t JOIN pack_snapshots p ON p.digest=t.pack_digest WHERE t.id=?").get(f.teamId);
  const manifest=JSON.parse(row.manifest);const seat=manifest.seats.find(s=>s.name===f.seat.name);if(tools===undefined)delete seat.tools;else seat.tools=tools;
  f.raw.prepare("UPDATE pack_snapshots SET manifest_json=? WHERE digest=?").run(JSON.stringify(manifest),row.digest);
  f.raw.prepare("INSERT OR IGNORE INTO nodes (id,revision,name,platform,trust,state,slots_total,slots_used,last_heartbeat_at) VALUES ('local',1,'Local','windows','trusted-workstation','online',2,0,?)").run(f.clock().toISOString());
  f.raw.prepare("UPDATE attempts SET state='running',node_id='local',lease_id=?,lease_expires_at=? WHERE id=?").run(randomUUID(),new Date(f.clock().getTime()+600000).toISOString(),attempt.id);
  const grant={projectId:f.projectId,taskId,attemptId:attempt.id,epoch:attempt.epoch};
  const workflow=createWorkflowPatchMcp(f.deps);
  const deps={workflow,toolPolicy:createToolPolicy(f.raw),progress(){},registerOutput(){return{artifactId:randomUUID(),version:1};},requestDecision(){return{approvalId:randomUUID()};}};
  const handler=createMcpHandler(deps);
  const call=(name="workflow.patch",args=input,g=grant)=>handler.handle(g,{jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}}).body.result;
  const list=(g=grant)=>handler.handle(g,{jsonrpc:"2.0",id:1,method:"tools/list"}).body.result.tools.map(t=>t.name);
  return{...f,grant,call,list,deps,manifest};
}
for(const [label,tools] of [["omitted",null],["empty",[]],["unrelated",["knowledge.*"]],["other exact",["request.create"]]])
  test(`workflow tool defaults deny ${label}`,t=>{const f=setup(t,tools??[]);if(tools===null){const row=f.raw.prepare("SELECT digest,manifest_json FROM pack_snapshots WHERE manifest_json LIKE '%software-team%' LIMIT 1").get();const m=JSON.parse(row.manifest_json);for(const s of m.seats)delete s.tools;f.raw.prepare("UPDATE pack_snapshots SET manifest_json=? WHERE digest=?").run(JSON.stringify(m),row.digest);}assert.equal(f.list().includes("workflow.patch"),false);assert.deepEqual(f.call(),unavailable);assert.deepEqual(f.call(),f.call("unknown.tool"));assert.equal(f.view().patches.length,0);});
for(const tools of [["workflow.patch"],["workflow.*"],["workflow.patch","knowledge.*"]])
  test(`explicit tool entry admits ${tools.join(" and ")}`,t=>{const f=setup(t,tools);assert.ok(f.list().includes("workflow.patch"));const result=f.call();assert.equal(result.isError,false);assert.deepEqual(JSON.parse(result.content[0].text),{number:1,state:"applied"});assert.equal(f.view().patches[0].proposedBy,"lead");assert.equal(f.raw.prepare("SELECT source_task_id FROM workflow_patches").get().source_task_id,f.grant.taskId);});
test("no policy cannot expose workflow tool",t=>{const f=setup(t);f.deps.toolPolicy=undefined;const handler=createMcpHandler(f.deps);const response=handler.handle(f.grant,{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"workflow.patch",arguments:input}});assert.deepEqual(response.body.result,unavailable);});
test("missing optional workflow delegate is hidden",t=>{const f=setup(t);f.deps.workflow=undefined;const h=createMcpHandler(f.deps);assert.equal(h.handle(f.grant,{jsonrpc:"2.0",id:1,method:"tools/list"}).body.result.tools.some(t=>t.name==="workflow.patch"),false);});
test("workflow tool cap is twenty per attempt",t=>{const f=setup(t);for(let i=0;i<20;i++)assert.equal(f.call().isError,false);assert.equal(f.call().content[0].text,"tool limit reached");assert.equal(f.view().patches.length,20);});
test("malformed input never selects another instance",t=>{const f=setup(t);const other=f.create();assert.equal(f.call("workflow.patch",{...input,instanceId:other}).content[0].text,"invalid tool input");assert.equal(f.view().patches.length,0);});
test("grant cannot substitute another task",t=>{const f=setup(t);assert.equal(f.call("workflow.patch",input,{...f.grant,taskId:f.task()}).content[0].text,"attempt is not active");assert.equal(f.view().patches.length,0);});
test("nonworkflow task gets fixed unavailable error",t=>{const f=setup(t);f.raw.prepare("DELETE FROM workflow_stage_tasks WHERE task_id=?").run(f.grant.taskId);assert.deepEqual(f.call(),unavailable);});
for(const mutation of ["epoch","expired","terminal"])
  test(`grant fencing ${mutation}`,t=>{const f=setup(t);let grant=f.grant;if(mutation==="epoch")grant={...grant,epoch:grant.epoch+1};if(mutation==="expired")f.raw.prepare("UPDATE attempts SET lease_expires_at=? WHERE id=?").run(f.clock().toISOString(),grant.attemptId);if(mutation==="terminal")f.raw.prepare("UPDATE attempts SET state='succeeded',outcome='known',ended_at=? WHERE id=?").run(f.clock().toISOString(),grant.attemptId);assert.equal(f.call("workflow.patch",input,grant).content[0].text,"attempt is not active");assert.equal(f.view().patches.length,0);});
test("results contain only number state and content free refusal",t=>{const f=setup(t);const result=f.call("workflow.patch",{ops:[{op:"skipOptionalStage",stage:"missing"}],reason:"Do not echo [private]"});assert.equal(result.isError,false);assert.deepEqual(JSON.parse(result.content[0].text),{number:1,state:"refused",refusal:"unknown stage"});assert.equal(result.content[0].text.includes(f.id),false);assert.equal(result.content[0].text.includes("private"),false);});
test("approval policy returns pending without engine changes",t=>{const f=setup(t);const before=f.view().revision;const result=f.call("workflow.patch",{ops:[{op:"addStage",stage:stage("added"),after:"author"}],reason:"Need evidence"});assert.deepEqual(JSON.parse(result.content[0].text),{number:1,state:"pending"});assert.equal(f.view().revision,before);});
for(const tools of [["workflow.patch"],["workflow.*"]])test(`pack tool schema accepts ${tools[0]}`,t=>{const f=setup(t,tools);assert.equal(packManifestSchema.safeParse(f.manifest).success,true);});
test("the workflow handler answers only to its own tool name even when the seat allows every tool",t=>{
  const f=setup(t,["workflow.patch","knowledge.*"]);
  assert.deepEqual(f.deps.workflow.call(f.grant,"knowledge.search",{query:"x"}),unavailable);
  assert.deepEqual(f.deps.workflow.call(f.grant,"task.progress",{summary:"x"}),unavailable);
});
test("patch reasons are stored sanitised, not only on display",t=>{
  const f=setup(t,["workflow.patch"]); const id=randomUUID();
  const result=f.call("workflow.patch",{ops:[{op:"addTaskWithinStage",stage:"author",title:"Evidence"}],reason:`Because ${id} {secret: value} token=abcdef123456`});
  assert.equal(result.isError,false);
  const stored=f.raw.prepare("SELECT reason FROM workflow_patches ORDER BY number DESC LIMIT 1").get().reason;
  assert.equal(stored.includes(id),false); assert.doesNotMatch(stored,/[{}]|abcdef123456/);
});
