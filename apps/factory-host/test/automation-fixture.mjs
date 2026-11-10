import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { workflowFixture } from "./workflow-fixture.mjs";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createMonitorHandlers } from "../dist/automation/monitorCommands.js";
import { getMonitor, tickMonitors } from "../dist/automation/monitors.js";
export const input = (patch={}) => ({name:"Monitor",kind:"workflow-stalled",params:{},threshold:0,...patch});
export function automationFixture(t) {
  const f=workflowFixture(t);let instant=f.clock().getTime(),calls=0,space=2**30,fail=false;
  const clock=()=>new Date(instant),pipeline=createCommandPipeline({storage:f.storage,hub:f.hub,clock,handlers:createMonitorHandlers()});
  const command=(type,payload,extra={})=>({apiVersion:1,commandId:randomUUID(),projectId:f.projectId,type:`monitors.${type}`,payload,...extra});
  const execute=(type,payload,extra)=>pipeline.execute(command(type,payload,extra));
  const row=id=>getMonitor(f.raw,f.projectId,id);
  const create=(patch={})=>{const id=randomUUID(),result=execute("create",{monitorId:id,...input(patch)});assert.equal(result.status,200,JSON.stringify(result.body));return id;};
  const change=(type,id,patch={})=>execute(type,{monitorId:id,expectedRevision:row(id).revision,...patch});
  const deps={raw:f.raw,hub:f.hub,stateDir:"state",statfs:async()=>{calls++;if(fail)throw Error("Probe unavailable");return {bavail:space,bsize:1};}};
  return {...f,clock,pipeline,command,execute,row,create,change,deps,advance:ms=>{instant+=ms;},set:at=>{instant=Date.parse(at);},
    tick:()=>tickMonitors(deps,clock()),space:value=>{space=value;},fail:value=>{fail=value;},calls:()=>calls,
    events:id=>f.raw.prepare("SELECT * FROM monitor_events WHERE monitor_id=? ORDER BY seq").all(id),
    stalled:()=>{const id=f.create();f.raw.prepare("UPDATE workflow_instances SET state='stalled' WHERE id=?").run(id);return id;}};
}
