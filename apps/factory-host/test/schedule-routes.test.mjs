import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { scheduleFixture } from "./schedule-fixture.mjs";
import { createApiServer, createRoutes } from "../dist/api/index.js";
import { createBootstrapGate, createSessionStore } from "../dist/identity/index.js";
async function api(t){
 const f=scheduleFixture(t),host="127.0.0.1:8787",origin=`http://${host}`;
 const gate=createBootstrapGate({clock:f.clock});const app=createApiServer({origins:[origin],clock:f.clock,gate,sessions:createSessionStore({clock:f.clock}),register:createRoutes({storage:f.storage,hub:f.hub,pipeline:f.pipeline,clock:f.clock})});t.after(()=>app.close());
 const auth=await app.inject({method:"POST",url:"/auth/bootstrap",headers:{host,origin,"content-type":"application/json"},payload:{token:gate.token}});assert.equal(auth.statusCode,200);
 const headers={host,cookie:auth.headers["set-cookie"].split(";")[0]};
 return {...f,app,get:url=>app.inject({url,headers}),anonymous:url=>app.inject({url,headers:{host}}),root:`/projects/${f.projectId}/schedules`};
}
for(const detail of [false,true])test(`schedule read authentication ${detail}`,async t=>{const f=await api(t);assert.equal((await f.anonymous(f.root+(detail?`/${randomUUID()}/occurrences`:""))).statusCode,401);});
for(const detail of [false,true])test(`schedule read unknown project ${detail}`,async t=>{const f=await api(t);assert.equal((await f.get(`/projects/${randomUUID()}/schedules`+(detail?`/${randomUUID()}/occurrences`:""))).statusCode,404);});
test("schedule read unknown schedule",async t=>{const f=await api(t);assert.equal((await f.get(`${f.root}/${randomUUID()}/occurrences`)).statusCode,404);});
test("schedule list empty",async t=>{const f=await api(t);assert.deepEqual((await f.get(f.root)).json().items,[]);});
test("schedule list newest first and upcoming times",async t=>{const f=await api(t),first=f.create();f.advance(1);const second=f.create({name:"Other"});const rows=(await f.get(f.root)).json().items;assert.deepEqual(rows.map(r=>r.id),[second,first]);assert.deepEqual(rows[0].upcoming,["2026-11-08T00:01:00.001Z","2026-11-08T00:02:00.001Z","2026-11-08T00:03:00.001Z"]);assert.equal(rows[0].enabled,true);});
test("schedule list shows parameter keys and excludes values",async t=>{const f=await api(t);f.create({action:{definitionKey:"software-delivery",packKey:"software-team",params:{deployTarget:"production",hasUI:false},title:"Business text"}});const response=await f.get(f.root),row=response.json().items[0];assert.deepEqual(row.action.paramKeys,["deployTarget","hasUI"]);assert.equal(response.body.includes("production"),false);assert.equal(response.body.includes("Business text"),false);assert.equal(Object.hasOwn(row.action,"params"),false);assert.equal(Object.hasOwn(row,"action_json"),false);});
test("paused schedule has no upcoming times",async t=>{const f=await api(t);f.create({enabled:false});const row=(await f.get(f.root)).json().items[0];assert.equal(row.enabled,false);assert.deepEqual(row.upcoming,[]);});
test("once schedule has one upcoming time",async t=>{const f=await api(t);f.create({kind:"once",expr:"2026-11-08T01:00:00Z"});assert.deepEqual((await f.get(f.root)).json().items[0].upcoming,["2026-11-08T01:00:00.000Z"]);});
test("occurrence read order and fields",async t=>{const f=await api(t),id=f.create();for(let i=0;i<3;i++){f.advance(60000);f.tick();}const rows=(await f.get(`${f.root}/${id}/occurrences`)).json().items;assert.deepEqual(rows.map(r=>r.scheduledFor),["2026-11-08T00:03:00.000Z","2026-11-08T00:02:00.000Z","2026-11-08T00:01:00.000Z"]);assert.deepEqual(Object.keys(rows[0]).sort(),["firedAt","instanceId","reason","scheduledFor","status","trigger"]);});
test("occurrence read is project scoped",async t=>{const f=await api(t),id=f.create(),other=f.project();assert.equal((await f.get(`/projects/${other}/schedules/${id}/occurrences`)).statusCode,404);});
test("occurrence read limited to newest fifty",async t=>{const f=await api(t),id=f.create();for(let i=0;i<55;i++){f.advance(60000);f.tick();}const rows=(await f.get(`${f.root}/${id}/occurrences`)).json().items;assert.equal(rows.length,50);assert.equal(rows[0].scheduledFor,"2026-11-08T00:55:00.000Z");});
test("schedule list preserves creation order with a fixed clock",async t=>{const f=await api(t),first=f.create(),second=f.create({name:"Second"}),third=f.create({name:"Third"});assert.deepEqual((await f.get(f.root)).json().items.map(r=>r.id),[third,second,first]);});
