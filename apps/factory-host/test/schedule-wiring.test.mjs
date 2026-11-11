import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { startHost } from "../dist/host.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createScheduleHandlers, SCHEDULE_COMMANDS } from "../dist/schedule/commands.js";
import { createWorkflowHandlers } from "../dist/workflow/commands.js";
import { temp } from "./org-fixture.mjs";
import { packs } from "./workflow-fixture.mjs";
function timers(){const intervals=new Map();let serial=0;return {intervals,setTimeout,clearTimeout,setInterval(fn,ms){const id=++serial;intervals.set(id,{fn,ms});return id;},clearInterval(id){intervals.delete(id);}};}
async function launch(t,extra={}){let host;const stateDir=extra.stateDir??join(temp(t,()=>host?.close()),"state"),timer=timers();let time=Date.parse("2026-11-08T00:00:00Z"),bootstrap;
 host=await startHost({stateDir,port:0,dispatch:null,clock:()=>new Date(time),timers:timer,onBootstrapToken(value){bootstrap=value;},...extra});t.after(()=>host.close());
 return {host,stateDir,timer,advance:ms=>{time+=ms;},bootstrap};}
test("scheduler is flag free inert and uses thirty second injectable timer",async t=>{const f=await launch(t);assert.ok([...f.timer.intervals.values()].some(x=>x.ms===30000));const timer=[...f.timer.intervals.values()].find(x=>x.ms===30000);timer.fn();assert.equal(f.host.storage.raw.prepare("SELECT count(*) AS n FROM schedule_occurrences").get().n,0);await f.host.close();assert.equal(f.timer.intervals.size,0);});
test("scheduler periodic callback starts workflows",async t=>{const f=await launch(t),projectId=randomUUID(),scheduleId=randomUUID();const workflowPipeline=createCommandPipeline({storage:f.host.storage,hub:f.host.hub,clock:()=>new Date("2026-11-08T00:00:00Z"),handlers:createWorkflowHandlers({packs})});
 const pipeline=createCommandPipeline({storage:f.host.storage,hub:f.host.hub,clock:()=>new Date("2026-11-08T00:00:00Z"),handlers:createScheduleHandlers({packs,pipeline:workflowPipeline})});
 const execute=(type,payload)=>pipeline.execute({apiVersion:1,commandId:randomUUID(),projectId,type,payload});
 assert.equal(execute("projects.create",{name:"Project",workspace:{kind:"directory",root:"/workspace/scheduler"}}).status,200);
 assert.equal(execute("schedules.create",{scheduleId,name:"Daily",kind:"interval",expr:"60",action:{definitionKey:"software-delivery",packKey:"software-team"}}).status,200);
 f.advance(60000);[...f.timer.intervals.values()].find(x=>x.ms===30000).fn();assert.equal(f.host.storage.raw.prepare("SELECT count(*) AS n FROM schedule_occurrences WHERE status='started'").get().n,1);
});
test("scheduler startup tick fires a persisted due schedule",async t=>{const f=await launch(t),projectId=randomUUID(),id=randomUUID();const pipeline=createCommandPipeline({storage:f.host.storage,hub:f.host.hub});assert.equal(pipeline.execute({apiVersion:1,commandId:randomUUID(),projectId,type:"projects.create",payload:{name:"Project",workspace:{kind:"directory",root:"/workspace/scheduler"}}}).status,200);
 f.host.storage.raw.prepare(`INSERT INTO schedules (project_id,id,revision,name,kind,expr,timezone,action_json,missed_policy,catch_up_limit,concurrency,parallel_limit,state,next_run_at,created_at)
 VALUES (?,?,1,'Daily','interval','60','UTC',?,'skip',3,'skip-if-running',2,'active','2026-11-08T00:00:00.000Z','2026-11-07T23:59:00.000Z')`).run(projectId,id,JSON.stringify({definitionKey:"software-delivery",packKey:"software-team",autoStart:true}));
 await f.host.close();const second=await launch(t,{stateDir:f.stateDir});try { assert.equal(second.host.storage.raw.prepare("SELECT count(*) AS n FROM schedule_occurrences WHERE status='started'").get().n,1); } finally { await second.host.close(); }
});
test("host advertises all scheduler commands",async t=>{const f=await launch(t),authority=`127.0.0.1:${f.host.port}`,origin=`http://${authority}`;const auth=await f.host.app.inject({method:"POST",url:"/auth/bootstrap",headers:{host:authority,origin,"content-type":"application/json"},payload:{token:f.bootstrap}});assert.equal(auth.statusCode,200);const r=await f.host.app.inject({url:"/system/capabilities",headers:{host:authority,cookie:auth.headers['set-cookie'].split(';')[0]}});for(const type of SCHEDULE_COMMANDS)assert.ok(r.json().commands.includes(type));});
