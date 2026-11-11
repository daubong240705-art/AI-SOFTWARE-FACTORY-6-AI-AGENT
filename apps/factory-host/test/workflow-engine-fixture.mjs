import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { workflowDefinitionSchema } from "@factory/contracts";
import { workflowFixture } from "./workflow-fixture.mjs";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createWorkflowHandlers } from "../dist/workflow/commands.js";
import { advanceWorkflow, registerWorkflowEngine, sweepWorkflows } from "../dist/workflow/engine.js";
import { workflowInstanceView } from "../dist/workflow/service.js";
import { moveTask } from "../dist/dispatch/tasks.js";

export const stage = (key, patch = {}) => ({ key, title: key, phase: "delivery", requiredCapabilities: ["docs.write"], inputs: [], outputs: [], ...patch });
export const flow = (stages = [stage("author"), stage("review")], edges = [{from:"author",to:"review",type:"finish-to-start"}], patch = {}) =>
  ({key:"example-flow",revision:1,title:"Example",parameters:[{name:"hasUI",type:"bool",default:true}],phases:["delivery"],stages,edges,joins:[],gates:[],...patch});
export function engineFixture(t, definition = flow(), options = {}) {
  const f = workflowFixture(t);
  const deps = {raw:f.raw,hub:f.hub,clock:f.clock,newId:randomUUID,...(options.dispatch ? {dispatcher:f.dispatcher} : {})};
  const pipeline = createCommandPipeline({storage:f.storage,hub:f.hub,clock:f.clock,handlers:createWorkflowHandlers({packs:[],engine:deps})});
  const id = f.create({}, {title:"Free text must stay out of generated tasks"});
  const parsed = workflowDefinitionSchema.parse(definition);
  f.raw.prepare("UPDATE workflow_instances SET definition_json=?, params_json=? WHERE id=?")
    .run(JSON.stringify(parsed),JSON.stringify(Object.fromEntries(parsed.parameters.map(p=>[p.name,p.default]))),id);
  f.raw.prepare("DELETE FROM workflow_stages WHERE instance_id=?").run(id);
  for(const s of parsed.stages) f.raw.prepare("INSERT INTO workflow_stages (project_id,instance_id,stage_key,phase,state,optional) VALUES (?,?,?,?,?,?)")
    .run(f.projectId,id,s.key,s.phase,s.includeIf?.param === "hasUI" && parsed.parameters.find(p=>p.name==="hasUI")?.default===false ? "skipped" : "pending",Number(s.optional));
  const view=()=>workflowInstanceView(f.raw,f.projectId,id);
  const run=()=>advanceWorkflow(deps,f.projectId,id);
  const command=(type,payload={})=>pipeline.execute({apiVersion:1,commandId:randomUUID(),projectId:f.projectId,type:`workflows.${type}`,payload:{instanceId:id,expectedRevision:view().revision,...payload}});
  const start=()=>{const r=command("start");assert.equal(r.status,200,JSON.stringify(r.body));return r;};
  const tasks=(key)=>view().stages.find(s=>s.key===key).tasks.map(row=>f.getTask(row.taskId));
  const move=(key,to)=>f.hub.transaction(()=>moveTask(f.raw,f.projectId,tasks(key)[0].id,to));
  const finish=(key)=>{const task=tasks(key)[0];if(task.state==="ready"||task.state==="awaiting-go")move(key,"active");move(key,"in-review");move(key,"done");};
  const artifact=(key,kind="other",status="approved")=>{
    const task=tasks(key)[0];if(task.state==="ready"||task.state==="awaiting-go")move(key,"active");
    const attempt=f.dispatcher.enqueue({projectId:f.projectId,taskId:task.id,seatId:f.seat.id});
    const artifactId=randomUUID();
    f.raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,abstract_l0,abstract_l1,produced_by_attempt_id,visibility,created_at)
      VALUES (?,?,1,?,'Evidence','text/markdown',?,1,?,'Evidence','Evidence summary',?,'project',?)`)
      .run(f.projectId,artifactId,kind,"a".repeat(64),status,attempt.id,f.clock().toISOString());
    return {artifactId,version:1};
  };
  if(options.triggers)registerWorkflowEngine(deps);
  return {...f,id,deps,view,run,start,command,tasks,move,finish,artifact,sweep:()=>sweepWorkflows(deps)};
}
