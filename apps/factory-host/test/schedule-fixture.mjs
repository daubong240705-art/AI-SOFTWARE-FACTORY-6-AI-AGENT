import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { workflowFixture, packs } from "./workflow-fixture.mjs";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createWorkflowHandlers } from "../dist/workflow/commands.js";
import { createScheduleHandlers } from "../dist/schedule/commands.js";
import { tickSchedules } from "../dist/schedule/scheduler.js";
import { getSchedule } from "../dist/schedule/service.js";
export const input = (patch={}) => ({name:"Daily",kind:"interval",expr:"60",action:{definitionKey:"software-delivery",packKey:"software-team"},...patch});
export function scheduleFixture(t){
  const f=workflowFixture(t);let instant=f.clock().getTime();const clock=()=>new Date(instant);
  const workflowPipeline=createCommandPipeline({storage:f.storage,hub:f.hub,clock,handlers:createWorkflowHandlers({packs})});
  const pipeline=createCommandPipeline({storage:f.storage,hub:f.hub,clock,handlers:createScheduleHandlers({packs,pipeline:workflowPipeline})});
  const command=(type,payload,extra={})=>({apiVersion:1,commandId:randomUUID(),projectId:f.projectId,type:`schedules.${type}`,payload,...extra});
  const execute=(type,payload,extra)=>pipeline.execute(command(type,payload,extra));
  const create=(patch={})=>{const id=randomUUID();const result=execute("create",{scheduleId:id,...input(patch)});assert.equal(result.status,200,JSON.stringify(result.body));return id;};
  const row=id=>getSchedule(f.raw,f.projectId,id);
  const change=(type,id,patch={})=>execute(type,{scheduleId:id,expectedRevision:row(id).revision,...patch});
  const occurrences=id=>f.raw.prepare("SELECT * FROM schedule_occurrences WHERE schedule_id=? ORDER BY scheduled_for,trigger").all(id);
  const deps={raw:f.raw,hub:f.hub,packs,pipeline:workflowPipeline};
  return {...f,clock,pipeline,command,execute,create,row,change,occurrences,deps,
    set:at=>{instant=typeof at==='number'?at:Date.parse(at);},advance:ms=>{instant+=ms;},tick:()=>tickSchedules(deps,clock()),
    instances:()=>f.raw.prepare("SELECT * FROM workflow_instances ORDER BY created_at").all()};
}
