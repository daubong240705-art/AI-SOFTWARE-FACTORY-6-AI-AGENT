import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { contextPackSchema } from "@factory/contracts";
import { createRoutes } from "../dist/api/routes.js";
import { createApiServer } from "../dist/api/server.js";
import { createSessionStore } from "../dist/identity/index.js";
import { storeContextPack } from "../dist/context/pack.js";
import { fixture as contextFixture } from "./context-fixture.mjs";

function fixture(t){const f=contextFixture(t);const sessions=createSessionStore();const session=sessions.create();const app=createApiServer({origins:["http://127.0.0.1:18787"],sessions,gate:{consume(){return "invalid";}},register:createRoutes({storage:f.storage,hub:f.hub,pipeline:f.pipeline})});t.after(()=>app.close());const read=(url=`/projects/${f.projectId}/tasks/${f.taskId}/context`,auth=true)=>app.inject({method:"GET",url,headers:{host:"127.0.0.1:18787",...(auth?{cookie:`factory_session=${session.id}`}:{})}});const save=()=>{const a=f.attempt();storeContextPack(f.raw,f.projectId,a.id,f.build({attemptId:a.id}));f.raw.prepare("UPDATE attempts SET state='failed',ended_at='2026-11-08T00:00:00.000Z' WHERE id=?").run(a.id);return a;};return {...f,read,save};}
test("context route requires a session",async t=>{const f=fixture(t);assert.equal((await f.read(undefined,false)).statusCode,401);});
test("context route rejects an unknown project",async t=>{const f=fixture(t);assert.equal((await f.read(`/projects/${randomUUID()}/tasks/${f.taskId}/context`)).statusCode,404);});
test("context route rejects an unknown task",async t=>{const f=fixture(t);assert.equal((await f.read(`/projects/${f.projectId}/tasks/${randomUUID()}/context`)).statusCode,404);});
test("context route returns an empty envelope before dispatch",async t=>{const f=fixture(t);assert.deepEqual((await f.read()).json(),{apiVersion:1,ok:true,packs:[]});});
test("context route exposes validated packs and exact metrics",async t=>{const f=fixture(t);f.inputs([f.artifact(),f.artifact({l1:null})]);const a=f.save();const r=await f.read();assert.equal(r.statusCode,200);const row=r.json().packs[0];assert.equal(row.attemptId,a.id);assert.equal(row.epoch,1);assert.deepEqual([row.l0,row.l1,row.omitted],[1,1,0]);assert.equal(row.tokens,row.pack.tokens);assert.equal(row.maxTokens,6000);assert.equal(contextPackSchema.safeParse(row.pack).success,true);});
test("context route orders by epoch and caps history at twenty",async t=>{const f=fixture(t);for(let i=0;i<23;i++)f.save();const rows=(await f.read()).json().packs;assert.equal(rows.length,20);assert.deepEqual(rows.map(x=>x.epoch),Array.from({length:20},(_,i)=>23-i));});
test("operator sees precise omitted reasons",async t=>{const f=fixture(t);f.inputs([f.artifact({visibility:"team-draft"}),{artifactId:randomUUID(),version:1}]);f.save();assert.deepEqual((await f.read()).json().packs[0].pack.omitted.map(x=>x.reason),["no-access","not-found"]);});
test("operator pack contains sanitized free text",async t=>{const f=fixture(t);f.raw.prepare("UPDATE tasks SET brief=? WHERE id=?").run("Safe /private/fixture fpx_fixture_value {hidden}",f.taskId);f.save();const r=await f.read();assert.equal(r.statusCode,200);assert.doesNotMatch(r.body,/private|fpx_|hidden/);});
test("context history remains scoped to its task",async t=>{const f=fixture(t);f.save();const other=f.task();assert.deepEqual((await f.read(`/projects/${f.projectId}/tasks/${other}/context`)).json().packs,[]);});
