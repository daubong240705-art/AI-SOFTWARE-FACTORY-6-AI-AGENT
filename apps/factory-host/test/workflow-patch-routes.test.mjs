import assert from "node:assert/strict";
import { test } from "node:test";
import { engineFixture, flow, stage } from "./workflow-engine-fixture.mjs";
import { createApiServer,createRoutes } from "../dist/api/index.js";
import { createBootstrapGate,createSessionStore } from "../dist/identity/index.js";
import { proposePatch,decidePatch } from "../dist/workflow/patch.js";
async function setup(t){
  const f=engineFixture(t,flow([stage("author",{limits:{maxTasks:5,budgetShare:1}}),stage("review")]));
  const host="127.0.0.1:8787",origin=`http://${host}`,gate=createBootstrapGate({clock:f.clock});
  const app=createApiServer({origins:[origin],clock:f.clock,gate,sessions:createSessionStore({clock:f.clock}),register:createRoutes({storage:f.storage,hub:f.hub,pipeline:f.pipeline})});t.after(()=>app.close());
  const auth=await app.inject({method:"POST",url:"/auth/bootstrap",headers:{host,origin,"content-type":"application/json"},payload:{token:gate.token}});assert.equal(auth.statusCode,200);
  const headers={host,cookie:auth.headers["set-cookie"].split(";")[0]};
  return{...f,get:(url,authenticated=true)=>app.inject({url,headers:authenticated?headers:{host}}),
    propose:(ops=[{op:"addStage",stage:stage("added"),after:"author"}],proposedBy="lead")=>proposePatch(f.deps,{projectId:f.projectId,instanceId:f.id,ops,reason:"Need evidence [private] /hidden/file",proposedBy}),
    root:`/projects/${f.projectId}/workflows/${f.id}`};
}
for(const route of ["detail","global","project"])test(`patch surface requires session ${route}`,async t=>{const f=await setup(t);const url=route==="detail"?f.root:route==="global"?"/inbox":`/projects/${f.projectId}/inbox`;assert.equal((await f.get(url,false)).statusCode,401);});
test("detail adds patches and stage extraTasks",async t=>{const f=await setup(t);f.propose([{op:"addTaskWithinStage",stage:"author",title:"Extra"}],"operator");f.propose();const response=await f.get(f.root);const v=response.json().instance;assert.equal(v.stages[0].extraTasks,1);assert.deepEqual(v.patches.map(p=>p.number),[2,1]);assert.equal(v.patches[0].reason,"Need evidence");assert.deepEqual(Object.keys(v.patches[0]).sort(),["id","number","proposedBy","policy","state","reason","refusal","createdAt","decidedAt","comment"].sort());});
for(const global of [true,false])test(`pending inbox additive fields global ${global}`,async t=>{const f=await setup(t);const patch=f.propose();const response=await f.get(global?"/inbox":`/projects/${f.projectId}/inbox`);assert.equal(response.statusCode,200);const v=response.json();assert.equal(v.patches.length,1);assert.equal(v.patches[0].id,patch.id);assert.equal(v.patches[0].instanceTitle,"Free text must stay out of generated tasks");assert.deepEqual(v.patches[0].ops,["add stage added"]);assert.equal(v.patches[0].reason,"Need evidence");assert.deepEqual(v.counts,{ monitors: 0, stalledWorkflows: 0,patches:1,approvals:0,startGates:0,requests:0,total:1});assert.ok(Array.isArray(v.approvals));assert.ok(Array.isArray(v.startGates));assert.ok(Array.isArray(v.requests));assert.equal(response.body.includes("ops_json"),false);});
for(const decision of ["approve","reject"])test(`decided patches leave inbox ${decision}`,async t=>{const f=await setup(t);const patch=f.propose();decidePatch(f.deps,{projectId:f.projectId,patchId:patch.id,decision});const v=(await f.get("/inbox")).json();assert.equal(v.patches.length,0);assert.equal(v.counts.total,0);assert.equal((await f.get(f.root)).json().instance.patches.length,1);});
test("project inbox isolates another project",async t=>{const f=await setup(t);f.propose();const other=f.project();const v=(await f.get(`/projects/${other}/inbox`)).json();assert.deepEqual(v.patches,[]);assert.equal(v.counts.patches,0);});
test("empty inbox has additive zero patch count",async t=>{const f=await setup(t);const v=(await f.get("/inbox")).json();assert.deepEqual(v.patches,[]);assert.equal(v.counts.patches,0);assert.equal(v.counts.total,0);});
