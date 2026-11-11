import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createApiServer } from "../dist/api/server.js";
import { createSessionStore } from "../dist/identity/index.js";
import { registerDossierRoutes } from "../dist/dossier/routes.js";
import { fixture as base } from "./dossier-fixture.mjs";
function fixture(t){const f=base(t);const sessions=createSessionStore(),session=sessions.create();const app=createApiServer({origins:["http://127.0.0.1:18787"],sessions,gate:{consume(){return "invalid";}},register(app,guards){registerDossierRoutes(app,guards,{raw:f.raw,store:f.store,now:f.clock});}});t.after(()=>app.close());return {...f,read:(suffix="dossier",auth=true,projectId=f.projectId)=>app.inject({method:"GET",url:`/projects/${projectId}/${suffix}`,headers:{host:"127.0.0.1:18787",...(auth?{cookie:`factory_session=${session.id}`}:{})}})};}
for(const surface of ["dossier","briefing"]){test(`${surface} route requires session`,async t=>{const f=fixture(t);assert.equal((await f.read(surface,false)).statusCode,401);});test(`${surface} unknown project returns 404`,async t=>{const f=fixture(t);assert.equal((await f.read(surface,true,randomUUID())).statusCode,404);});}
test("dossier route returns null before refresh",async t=>{const f=fixture(t);assert.deepEqual((await f.read()).json(),{apiVersion:1,ok:true,dossier:null});});
test("dossier route reports current after refresh",async t=>{const f=fixture(t);f.refresh();assert.equal((await f.read()).json().dossier.state,"current");});
test("dossier route reports outdated after change",async t=>{const f=fixture(t);f.refresh();f.task();assert.equal((await f.read()).json().dossier.state,"outdated");});
test("dossier route returns stored content",async t=>{const f=fixture(t),e=f.refresh();assert.equal((await f.read()).json().dossier.markdown,f.store.get(f.row(e).content_hash).toString());});
for(const since of ["bad","2026-11-02","2026-02-30T00:00:00Z","2026-11-02T25:00:00Z"]){test(`briefing rejects invalid timestamp case ${since.length}`,async t=>{const f=fixture(t);const r=await f.read(`briefing?since=${encodeURIComponent(since)}`);assert.equal(r.statusCode,400);assert.equal(r.json().error.message,"Invalid since timestamp.");});}
test("briefing route returns JSON envelope",async t=>{const f=fixture(t);const r=await f.read("briefing");assert.equal(r.statusCode,200);assert.equal(r.json().ok,true);assert.ok(r.json().changes);});
test("dossier route handles unavailable content with fixed error",async t=>{const f=fixture(t),e=f.refresh();f.store.get=()=>null;const r=await f.read();assert.equal(r.statusCode,503);assert.equal(r.json().error.message,"Dossier unavailable.");assert.equal(e.revision,1);});
