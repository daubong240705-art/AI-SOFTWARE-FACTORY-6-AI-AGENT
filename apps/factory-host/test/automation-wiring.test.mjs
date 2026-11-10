import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { startHost } from "../dist/host.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createMonitorHandlers } from "../dist/automation/monitorCommands.js";
import { temp } from "./org-fixture.mjs";
async function launch(t,extra={}){let host,time=Date.parse("2026-11-08T00:00:00Z"),calls=0;const intervals=new Map();let serial=0;
 const timers={setTimeout,clearTimeout,setInterval(fn,ms){const id=++serial;intervals.set(id,{fn,ms});return id;},clearInterval(id){intervals.delete(id);}};
 const stateDir=extra.stateDir??join(temp(t,()=>host?.close()),"state");host=await startHost({stateDir,port:0,dispatch:null,clock:()=>new Date(time),timers,onBootstrapToken(){},monitorStatfs:async()=>{calls++;return {bavail:2**30,bsize:1};},...extra});t.after(()=>host.close());
 const pipeline=createCommandPipeline({storage:host.storage,hub:host.hub,clock:()=>new Date(time),handlers:createMonitorHandlers()}),projectId=randomUUID();
 const execute=(type,payload)=>pipeline.execute({apiVersion:1,commandId:randomUUID(),projectId,type,payload});
 return {host,stateDir,intervals,execute,projectId,calls:()=>calls,advance:ms=>{time+=ms;},sweep:async()=>{[...intervals.values()].find(x=>x.ms===60000).fn();for(let i=0;i<20;i++)await Promise.resolve();}};}
test("automation existing sweep is inert without configuration",async t=>{const f=await launch(t);await f.sweep();assert.equal(f.calls(),0);assert.equal(f.host.storage.raw.prepare("SELECT count(*) AS n FROM monitor_events").get().n,0);await f.host.close();assert.equal(f.intervals.size,0);});
test("automation sixty second sweep checks due monitor",async t=>{const f=await launch(t),id=randomUUID();assert.equal(f.execute("projects.create",{name:"Project",workspace:{kind:"directory",root:"/workspace/automation"}}).status,200);assert.equal(f.execute("monitors.create",{monitorId:id,name:"Space",kind:"disk-free",params:{path:"state"},threshold:2,tripAfter:1}).status,200);await f.sweep();assert.equal(f.calls(),1);assert.equal(f.host.storage.raw.prepare("SELECT status FROM monitors WHERE id=?").get(id).status,"tripped");});
test("automation startup checks persisted monitor",async t=>{const f=await launch(t),id=randomUUID();f.execute("projects.create",{name:"Project",workspace:{kind:"directory",root:"/workspace/automation"}});f.execute("monitors.create",{monitorId:id,name:"Space",kind:"workflow-stalled",params:{},threshold:0});await f.host.close();const next=await launch(t,{stateDir:f.stateDir});try { assert.equal(next.host.storage.raw.prepare("SELECT status FROM monitors WHERE id=?").get(id).status,"ok"); } finally { await next.host.close(); }});
