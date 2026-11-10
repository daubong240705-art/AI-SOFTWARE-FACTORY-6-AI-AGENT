import assert from "node:assert/strict";
import { test } from "node:test";
import { engineFixture, stage, flow } from "./workflow-engine-fixture.mjs";
import { transitionArtifactVersion } from "../dist/knowledge/lifecycle.js";
import { registerWorkflowLifecycle, workflowChanged } from "../dist/workflow/lifecycle.js";
import { registerWorkflowEngine } from "../dist/workflow/engine.js";

test("task transitions advance downstream within the transaction",t=>{const f=engineFixture(t,flow(),{triggers:true});f.start();f.finish("author");assert.equal(f.tasks("review").length,1);f.finish("review");assert.equal(f.view().state,"completed");});
test("artifact approval trigger completes output stage and opens downstream",t=>{const f=engineFixture(t,flow([stage("author",{outputs:[{kind:"other",mustReach:"approved"}]}),stage("review")]),{triggers:true});f.start();const ref=f.artifact("author","other","reviewed");f.finish("author");assert.equal(f.tasks("review").length,0);f.hub.transaction(()=>transitionArtifactVersion(f.raw,{projectId:f.projectId,...ref,to:"approved",actorId:"operator",now:f.clock().toISOString()}));assert.equal(f.tasks("review").length,1);});
test("engagement update recovers blocked stages",t=>{const f=engineFixture(t,flow(),{triggers:true});f.updateEngagement(f.primary.id,{state:"paused"});f.start();assert.equal(f.tasks("author").length,0);f.updateEngagement(f.primary.id,{state:"active"});assert.equal(f.tasks("author").length,1);});
test("engagement creation recovers blocked stage",t=>{const f=engineFixture(t,flow(),{triggers:true});f.updateEngagement(f.primary.id,{state:"paused"});f.start();f.engage(f.secondTeam());assert.equal(f.tasks("author").length,1);});
test("sweep repairs missed transition and remains idempotent",t=>{const f=engineFixture(t);f.start();f.finish("author");f.sweep();assert.equal(f.tasks("review").length,1);const before=f.view();f.sweep();assert.deepEqual(f.view(),before);});
test("listener reentrancy is bounded",t=>{const f=engineFixture(t);let calls=0;registerWorkflowLifecycle(f.raw,projectId=>{calls++;workflowChanged(f.raw,projectId);});workflowChanged(f.raw,f.projectId);assert.equal(calls,1);});
test("engine reentrancy does not duplicate tasks",t=>{const f=engineFixture(t,flow(),{triggers:true});f.start();for(let i=0;i<10;i++)f.hub.transaction(()=>workflowChanged(f.raw,f.projectId));assert.equal(f.tasks("author").length,1);});
test("paused tasks drain but downstream waits for resume",t=>{const f=engineFixture(t,flow(),{triggers:true});f.start();assert.equal(f.command("pause",{reason:"Pause"}).status,200);f.finish("author");assert.equal(f.tasks("review").length,0);assert.equal(f.command("resume").status,200);assert.equal(f.tasks("review").length,1);});
test("cancelled instance ignores transitions and sweep",t=>{const f=engineFixture(t,flow(),{triggers:true});f.start();assert.equal(f.command("cancel",{reason:"Stop"}).status,200);f.finish("author");f.sweep();assert.equal(f.tasks("review").length,0);});
test("failed trigger rolls back the task transition",t=>{const f=engineFixture(t);f.start();const before=f.tasks("author")[0];registerWorkflowLifecycle(f.raw,()=>{throw new Error("Synthetic listener failure");});assert.throws(()=>f.move("author","active"));assert.deepEqual(f.tasks("author")[0],before);registerWorkflowEngine(f.deps);});
