import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { taskContextItemSchema } from "@factory/contracts";
import { createRoutes } from "../dist/api/routes.js";
import { createApiServer } from "../dist/api/server.js";
import { createSessionStore } from "../dist/identity/index.js";
import { fixture as contextFixture } from "./context-fixture.mjs";
import { storeContextPack } from "../dist/context/pack.js";
import { pumped } from "./org-fixture.mjs";
function fixture(t){const f=contextFixture(t);const sessions=createSessionStore();const session=sessions.create();const app=createApiServer({origins:["http://127.0.0.1:18787"],sessions,gate:{consume(){return "invalid";}},register:createRoutes({storage:f.storage,hub:f.hub,pipeline:f.pipeline})});t.after(()=>app.close());const read=(taskId=f.taskId,auth=true)=>app.inject({method:"GET",url:`/projects/${f.projectId}/tasks/${taskId}/context`,headers:{host:"127.0.0.1:18787",...(auth?{cookie:`factory_session=${session.id}`}:{})}});return {...f,read};}
test("context view adds instruction provenance after dispatch",async t=>{const f=fixture(t);const a=f.enqueue(f.taskId);await pumped();const row=(await f.read()).json().packs[0];assert.equal(row.attemptId,a.id);assert.match(row.instructions.packDigest,/^[a-f0-9]{64}$/);assert.ok(row.instructions.profilePath);assert.ok(row.instructions.skillsCount>0);assert.ok(row.instructions.bytes>0);assert.equal(taskContextItemSchema.safeParse(row).success,true);});
test("context view returns null instructions for older attempts",async t=>{const f=fixture(t);const a=f.attempt();storeContextPack(f.raw,f.projectId,a.id,f.build({attemptId:a.id}));assert.equal((await f.read()).json().packs[0].instructions,null);});
test("context view returns null for attempts without a snapshot",async t=>{const f=fixture(t);f.raw.prepare("UPDATE teams SET pack_digest=NULL WHERE id=?").run(f.teamId);f.enqueue(f.taskId);await pumped();assert.equal((await f.read()).json().packs[0].instructions,null);});
test("instruction provenance requires a session",async t=>{const f=fixture(t);assert.equal((await f.read(f.taskId,false)).statusCode,401);});
test("instruction provenance stays scoped to the task",async t=>{const f=fixture(t);f.enqueue(f.taskId);await pumped();const task=f.task();assert.deepEqual((await f.read(task)).json().packs,[]);});
test("instruction provenance retains context metrics",async t=>{const f=fixture(t);f.enqueue(f.taskId);await pumped();const row=(await f.read()).json().packs[0];assert.equal(row.tokens,row.pack.tokens);assert.equal(row.maxTokens,row.pack.budget.maxTokens);assert.equal(row.epoch,1);});
test("instruction view contains metadata without profile content",async t=>{const f=fixture(t);f.enqueue(f.taskId);await pumped();assert.deepEqual(Object.keys((await f.read()).json().packs[0].instructions).sort(),["bytes","packDigest","profilePath","skillsCount"]);});
test("instruction view rejects unknown tasks",async t=>{const f=fixture(t);assert.equal((await f.read(randomUUID())).statusCode,404);});
