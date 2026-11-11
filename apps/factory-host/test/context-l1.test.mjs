import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanArtifactSummary } from "../dist/artifacts/summary.js";
import { registerAgentOutput } from "../dist/artifacts/service.js";
import { createMcpTools } from "../dist/mcp/tools.js";
import { transitionArtifactVersion } from "../dist/knowledge/lifecycle.js";
import { createKnowledgeHandlers } from "../dist/knowledge/commands.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { LOCAL_NODE_ID } from "../dist/dispatch/index.js";
import { fixture } from "./context-fixture.mjs";

const valid="A".repeat(39)+"\n"+"B".repeat(40);
for(const [name,text] of [["empty",""],["blank"," \n "],["one line","x".repeat(100)],["blank second line","x".repeat(100)+"\n "],["79 characters","a".repeat(38)+"\n"+"b".repeat(40)],["trimming boundary"," "+"a".repeat(38)+"\n"+"b".repeat(40)+" "]])
  test(`registration summary rejects ${name}`,()=>assert.throws(()=>cleanArtifactSummary("L0",text),{message:"summary (L1) is too short or unstructured"}));
test("registration summary accepts exactly 80 trimmed characters",()=>assert.equal(cleanArtifactSummary("L0",valid),valid));
test("registration summary rejects equality with L0",()=>assert.throws(()=>cleanArtifactSummary(valid,valid),{message:"summary (L1) is too short or unstructured"}));
test("registration summary allows omitted L1",()=>assert.equal(cleanArtifactSummary("L0",undefined),null));
test("registration preserves structured summary lines",()=>assert.equal(cleanArtifactSummary("L0",`  ${valid}\n `),valid));
test("MCP rejects short summaries before invoking registration",()=>{let calls=0;const tools=createMcpTools({progress(){},requestDecision(){},registerOutput(){calls++;return {artifactId:"unused",version:1};}});const r=tools.call({attemptId:"attempt"},"output.register",{title:"Output",kind:"other",mediaType:"text/plain",path:"result.txt",abstractL0:"Summary",abstractL1:"short"});assert.equal(r.isError,true);assert.equal(r.content[0].text,"summary (L1) is too short or unstructured");assert.equal(calls,0);});
test("artifact service refuses an invalid summary without writes",t=>{const f=fixture(t);const a=f.attempt();f.raw.prepare("UPDATE attempts SET state='running',node_id=?,lease_id='fixture',lease_expires_at='2099-01-01T00:00:00.000Z' WHERE id=?").run(LOCAL_NODE_ID,a.id);let writes=0;assert.throws(()=>registerAgentOutput({raw:f.raw,store:{put(){writes++;}},now:f.clock,newId:()=>"unused"},{grant:{projectId:f.projectId,taskId:f.taskId,attemptId:a.id,epoch:a.epoch},title:"Output",kind:"other",mediaType:"text/plain",path:"result.txt",abstractL0:"Summary",abstractL1:"short"}),{message:"summary (L1) is too short or unstructured"});assert.equal(writes,0);assert.equal(f.raw.prepare("SELECT count(*) AS n FROM artifact_versions").get().n,0);});
const required=["research-report","requirements","adr","data-model","api-contract","ui-spec","plan","dossier"];
for(const multiTeam of [false,true]) for(const kind of required) test(`approval gate ${kind} flag ${multiTeam}`,t=>{const f=fixture(t);const ref=f.artifact({kind,status:"reviewed",l1:null});const run=()=>transitionArtifactVersion(f.raw,{projectId:f.projectId,...ref,to:"approved",actorId:"operator",now:f.clock().toISOString(),multiTeam});if(multiTeam){assert.throws(run,{message:"summary (L1) is required before approval"});assert.equal(f.raw.prepare("SELECT status FROM artifact_versions").get().status,"reviewed");}else{run();assert.equal(f.raw.prepare("SELECT status FROM artifact_versions").get().status,"approved");}});
for(const kind of ["other","code-ref","dataset","design-asset","media"]) test(`approval exempts ${kind}`,t=>{const f=fixture(t);const ref=f.artifact({kind,status:"reviewed",l1:null});transitionArtifactVersion(f.raw,{projectId:f.projectId,...ref,to:"approved",actorId:"operator",now:f.clock().toISOString(),multiTeam:true});assert.equal(f.raw.prepare("SELECT status FROM artifact_versions").get().status,"approved");});
test("structured L1 permits required-kind approval",t=>{const f=fixture(t);const ref=f.artifact({status:"reviewed",l1:valid});transitionArtifactVersion(f.raw,{projectId:f.projectId,...ref,to:"approved",actorId:"operator",now:f.clock().toISOString(),multiTeam:true});assert.equal(f.raw.prepare("SELECT status FROM artifact_versions").get().status,"approved");});
test("missing approval summary is a command conflict",t=>{const f=fixture(t);const ref=f.artifact({status:"reviewed",l1:null});const pipeline=createCommandPipeline({storage:f.storage,hub:f.hub,clock:f.clock,handlers:createKnowledgeHandlers({multiTeam:true})});const r=pipeline.execute({apiVersion:1,commandId:"123e4567-e89b-42d3-a456-426614174000",projectId:f.projectId,type:"artifacts.transition",payload:{...ref,to:"approved",comment:""}});assert.equal(r.status,409);assert.equal(r.body.error.message,"summary (L1) is required before approval");});
