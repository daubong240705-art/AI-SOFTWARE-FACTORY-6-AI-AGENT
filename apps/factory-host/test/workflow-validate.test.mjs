import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateParamCondition } from "@factory/contracts";
import { validateWorkflowDefinition as validate } from "../dist/workflow/validate.js";
import { definition, pack } from "./workflow-fixture.mjs";
test("minimal workflow validates",()=>assert.deepEqual(validate(definition()),{ok:true,errors:[],warnings:[]}));
for(const [name,change,match] of [
  ["unknown edge source",d=>d.edges[0].from="missing",/unknown stage/],
  ["unknown edge target",d=>d.edges[0].to="missing",/unknown stage/],
  ["self edge",d=>d.edges[0].to="author",/self edge/],
  ["cycle",d=>d.edges.push({from:"review",to:"author",type:"finish-to-start"}),/cycle author -> review -> author/],
  ["rework forward",d=>d.edges.push({from:"author",to:"review",type:"rework",maxLoops:3,when:{param:"hasUI",op:"eq",value:true}}),/rework target/],
  ["missing join",d=>d.stages[0].parallelGroup="group",/policy missing/],
  ["unknown join group",d=>d.joins=[{group:"unknown",policy:"all"}],/unknown group/],
  ["large quorum",d=>{d.stages[0].parallelGroup="group";d.joins=[{group:"group",policy:"quorum",n:2}];},/invalid quorum/],
  ["zero quorum",d=>d.joins=[{group:"group",policy:"quorum",n:0}],/invalid value/],
  ["duplicate edge",d=>d.edges.push({...d.edges[0]}),/duplicate edge/],
  ["missing output",d=>Object.assign(d.edges[0],{type:"artifact-approved",artifact:"data-model"}),/output missing/],
  ["unknown parameter",d=>d.stages[0].includeIf={param:"missing",op:"eq",value:true},/unknown parameter/],
  ["wrong parameter type",d=>d.stages[0].skipIf={param:"hasUI",op:"eq",value:1},/type mismatch/],
  ["unknown enum",d=>{d.parameters=[{name:"choice",type:"enum",default:"a",values:["a"]}];d.stages[0].includeIf={param:"choice",op:"eq",value:"b"};},/unknown enum/],
  ["unknown gate",d=>d.gates=[{before:"missing",kind:"review",approver:"operator"}],/unknown stage/],
  ["required capability",d=>d.stages[0].requiredCapabilities=[],/invalid value/],
  ["unknown phase",d=>d.stages[0].phase="missing",/unknown phase/],
])test(`validator rejects ${name}`,()=>{const d=definition();change(d);const r=validate(d);assert.equal(r.ok,false);assert.match(r.errors.join("\n"),match);});
test("bounded rework does not count as a cycle",()=>{const d=definition();d.edges.push({from:"review",to:"author",type:"rework",maxLoops:3,when:{fact:"review.verdict",op:"eq",value:"changes-requested"}});assert.equal(validate(d).ok,true);});
for(const policy of ["all","any","quorum"])test(`join ${policy}`,()=>{const d=definition();for(const s of d.stages)s.parallelGroup="group";d.joins=[{group:"group",policy,...(policy==="quorum"?{n:2}:{})}];assert.equal(validate(d).ok,true);});
test("validator warnings stay content free",()=>{const d=definition();d.stages[0].optional=true;d.stages[0].teamHint="private-value";for(const s of d.stages)s.limits={maxTasks:1,budgetShare:0.6};const r=validate(d,{knownCapabilities:new Set()});assert.equal(r.ok,true);assert.equal(r.warnings.length,5);assert.equal(JSON.stringify(r).includes("private-value"),false);});
test("shipped software workflow has zero errors",()=>assert.deepEqual(validate(pack.files.workflows[0].definition).errors,[]));
for(const hasUI of [false,true])test(`software design inclusion ${hasUI}`,()=>{const d=pack.files.workflows[0].definition;assert.equal(evaluateParamCondition(d.stages.find(s=>s.key==="design").includeIf,{hasUI}),String(hasUI));assert.equal(evaluateParamCondition(d.stages[0].skipIf,{hasUI}),"unknown");});
for(const deployTarget of ["none","staging","production"])test(`software deploy inclusion ${deployTarget}`,()=>assert.equal(evaluateParamCondition(pack.files.workflows[0].definition.stages.find(s=>s.key==="deploy").includeIf,{deployTarget}),String(deployTarget!=="none")));
