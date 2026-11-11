import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { workflowFixture, packs } from "./workflow-fixture.mjs";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createWorkflowHandlers } from "../dist/workflow/commands.js";
import { createRuleHandlers } from "../dist/automation/ruleCommands.js";
import { createMonitorHandlers } from "../dist/automation/monitorCommands.js";
import { tickMonitors } from "../dist/automation/monitors.js";
import { getRule, tickRules } from "../dist/automation/rules.js";
export const input = (patch={}) => ({name:"Review",eventType:"workflow.state-changed",condition:{field:"to",op:"eq",value:"cancelled"},action:{kind:"start-workflow",definitionKey:"software-delivery",packKey:"software-team"},...patch});
export function rulesFixture(t) {
  const f=workflowFixture(t);let instant=f.clock().getTime(),failure=false;
  const clock=()=>new Date(instant);
  const workflowPipeline=createCommandPipeline({storage:f.storage,hub:f.hub,clock,handlers:createWorkflowHandlers({packs})});
  const pipeline=createCommandPipeline({storage:f.storage,hub:f.hub,clock,handlers:{...createRuleHandlers({packs}),...createMonitorHandlers()}});
  const command=(type,payload,extra={})=>({apiVersion:1,commandId:randomUUID(),projectId:f.projectId,type:`rules.${type}`,payload,...extra});
  const execute=(type,payload,extra)=>pipeline.execute(command(type,payload,extra));
  const row=id=>getRule(f.raw,f.projectId,id);
  const create=(patch={})=>{const id=randomUUID(),result=execute("create",{ruleId:id,...input(patch)});assert.equal(result.status,200,JSON.stringify(result.body));return id;};
  const change=(type,id,patch={})=>execute(type,{ruleId:id,expectedRevision:row(id).revision,...patch});
  const fires=id=>f.raw.prepare("SELECT * FROM rule_fires WHERE project_id=? AND rule_id=? ORDER BY event_sequence").all(f.projectId,id);
  const deps={raw:f.raw,hub:f.hub,packs,pipeline:{execute(...args){if(failure)throw Error("Unavailable");return workflowPipeline.execute(...args);}}};
  const workflow=(type,id)=>{const revision=f.raw.prepare("SELECT revision FROM workflow_instances WHERE id=?").get(id).revision;
    const result=workflowPipeline.execute({apiVersion:1,commandId:randomUUID(),projectId:f.projectId,type:`workflows.${type}`,payload:{instanceId:id,expectedRevision:revision,...(type==='cancel'?{reason:"Finished"}:{})}});assert.equal(result.status,200,JSON.stringify(result.body));return result;};
  const emit=()=>{const id=f.create();workflow("cancel",id);return Number(f.hub.currentCursor(f.projectId).sequence)-2;};
  const monitor=async()=>{const id=randomUUID();const r=pipeline.execute({apiVersion:1,commandId:randomUUID(),projectId:f.projectId,type:"monitors.create",payload:{monitorId:id,name:"disk",kind:"disk-free",params:{path:"state"},threshold:2,tripAfter:1}});assert.equal(r.status,200);
    await tickMonitors({raw:f.raw,hub:f.hub,stateDir:"state",statfs:async()=>({bavail:2**30,bsize:1})},clock());return id;};
  return {...f,clock,pipeline,workflowPipeline,command,execute,row,create,change,fires,deps,workflow,emit,monitor,
    advance:ms=>{instant+=ms;},fail:value=>{failure=value;},tick:()=>tickRules(deps,clock()),
    cursor:()=>f.raw.prepare("SELECT last_sequence FROM automation_cursors WHERE project_id=?").get(f.projectId)?.last_sequence,
    cancelStarted:id=>{for(const fire of fires(id).filter(x=>x.status==='started')){const w=f.raw.prepare("SELECT state FROM workflow_instances WHERE id=?").get(fire.instance_id);if(!['cancelled','failed','completed','superseded'].includes(w.state))workflow("cancel",fire.instance_id);}}};
}
