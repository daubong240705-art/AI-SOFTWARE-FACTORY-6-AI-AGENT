import assert from "node:assert/strict";
import { test } from "node:test";
import { createSkillsMcp } from "../dist/instructions/mcp.js";
import { createMcpHandler } from "../dist/mcp/rpc.js";
import { createModelProxy, createTokenRegistry } from "../dist/proxy/index.js";
import { DEFAULT_BUDGET_CONFIG } from "../dist/policy/index.js";
import { randomUUID } from "node:crypto";
import { instructionsFixture } from "./instructions-fixture.mjs";
import { pumped } from "./org-fixture.mjs";

async function fixture(t,transport="handler",options={}){
  const f=instructionsFixture(t,options);const a=f.enqueueInstructions();await pumped();
  f.raw.prepare("UPDATE attempts SET state='running',lease_id=?,lease_expires_at='2099-01-01T00:00:00.000Z' WHERE id=?").run(randomUUID(),a.id);
  const grant={projectId:f.projectId,taskId:f.taskId,attemptId:a.id,epoch:a.epoch,allowedModels:["approved"]};
  const skills=createSkillsMcp({raw:f.raw,now:f.clock});
  const handler=createMcpHandler({progress(){},registerOutput(){return {artifactId:randomUUID(),version:1};},requestDecision(){return {approvalId:randomUUID()};},...(options.disabled?{}:{skills})});
  const tokens=createTokenRegistry({clock:f.clock});const token=tokens.issue(grant).token;
  const proxy=transport==="proxy"?createModelProxy({raw:f.raw,tokens,clock:f.clock,newId:randomUUID,budget:DEFAULT_BUDGET_CONFIG,allowedHosts:["127.0.0.1:18787"],mcp:handler,upstream:{providerId:"fixture",async chatCompletions(){throw new Error("unused");}}}):null;
  f.cleanup(async()=>{await proxy?.close();tokens.revokeAll();});
  const send=async(method,params={})=>{const body={jsonrpc:"2.0",id:1,method,params};if(!proxy)return handler.handle(grant,body).body.result;const reply=await proxy.app.inject({method:"POST",url:"/mcp",headers:{host:"127.0.0.1:18787",authorization:`Bearer ${token}`},payload:body});assert.equal(reply.statusCode,200);return reply.json().result;};
  return {...f,a,grant,skills,send,call:(input={name:"verify"})=>send("tools/call",{name:"skill.get",arguments:input})};
}
const error=(r,message)=>assert.deepEqual(r,{content:[{type:"text",text:message}],isError:true});
for(const transport of ["handler","proxy"]){
  test(`${transport} lists the optional skill tool when wired`,async t=>{const f=await fixture(t,transport);const tool=(await f.send("tools/list")).tools.find(x=>x.name==="skill.get");assert.ok(tool);assert.equal(tool.inputSchema.additionalProperties,false);assert.deepEqual(tool.inputSchema.required,["name"]);});
  test(`${transport} hides and refuses skill tool when unwired`,async t=>{const f=await fixture(t,transport,{disabled:true});assert.equal((await f.send("tools/list")).tools.some(x=>x.name==="skill.get"),false);error(await f.call(),"tool is not available");});
  test(`${transport} returns pinned skill text as data`,async t=>{const f=await fixture(t,transport);assert.deepEqual(await f.call(),{content:[{type:"text",text:f.pack.files.skills[0].content}],isError:false});});
  test(`${transport} returns indistinguishable missing and other team errors`,async t=>{const f=await fixture(t,transport);const missing=await f.call({name:"unknown"});f.raw.prepare("UPDATE attempt_seats SET seat_id=? WHERE attempt_id=?").run(f.seat.id,f.a.id);assert.deepEqual(await f.call(),missing);error(missing,"skill not found");});
  test(`${transport} returns not found without a snapshot`,async t=>{const f=await fixture(t,transport);f.raw.prepare("UPDATE teams SET pack_digest=NULL WHERE id=?").run(f.team.teamId);error(await f.call(),"skill not found");});
  for(const [label,input]of [["empty",{name:""}],["uppercase",{name:"Verify"}],["traversal",{name:"../verify"}],["too long",{name:"a".repeat(81)}],["extra identity",{name:"verify",seatId:"other"}],["missing",{}]])test(`${transport} validates ${label} input`,async t=>{const f=await fixture(t,transport);error(await f.call(input),"invalid tool input");});
  test(`${transport} caps skill reads at two hundred per attempt`,async t=>{const f=await fixture(t,transport);for(let i=0;i<200;i++)assert.equal((await f.call()).isError,false);error(await f.call(),"tool limit reached");});
  test(`${transport} truncates multibyte skill text with a final marker`,async t=>{const content="界".repeat(15000);const f=await fixture(t,transport,{content});const r=await f.call();assert.equal(r.isError,false);const text=r.content[0].text;assert.ok(Buffer.byteLength(text)<=32768);assert.ok(text.endsWith("\n[truncated]"));assert.doesNotMatch(text,/\uFFFD/);});
  test(`${transport} keeps escaped skill text inside the MCP response budget`,async t=>{const f=await fixture(t,transport,{content:'"'.repeat(32768)});const r=await f.call();assert.equal(r.isError,false);assert.ok(r.content[0].text.endsWith("\n[truncated]"));assert.ok(Buffer.byteLength(JSON.stringify(r))<65536);});
}
for(const state of ["succeeded","failed","stopped","queued"])test(`skill tool fences ${state} attempts`,async t=>{const f=await fixture(t);f.raw.prepare("UPDATE attempts SET state=?,ended_at='2026-11-08T00:00:00.000Z',node_id=NULL,lease_id=NULL WHERE id=?").run(state,f.a.id);error(await f.call(),"attempt is not active");});
test("skill tool fences stale epochs",async t=>{const f=await fixture(t);error(f.skills.call({...f.grant,epoch:99},"skill.get",{name:"verify"}),"attempt is not active");});
test("skill tool fences expired leases",async t=>{const f=await fixture(t);f.raw.prepare("UPDATE attempts SET lease_expires_at='2000-01-01' WHERE id=?").run(f.a.id);error(await f.call(),"attempt is not active");});
test("skill failures never expose database details",async t=>{const f=await fixture(t);f.raw.exec("DROP TABLE pack_files");error(await f.call(),"skill not found");});
