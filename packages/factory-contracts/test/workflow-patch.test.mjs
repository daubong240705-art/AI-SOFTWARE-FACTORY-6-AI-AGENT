import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { workflowPatchSchema,workflowPatchOpSchema,workflowStageSchema,commandSchema,MCP_TOOLS,patchPolicyOf,workflowAllowedPatchesSchema } from "@factory/contracts";
const stage={key:"added",title:"Added",phase:"delivery",requiredCapabilities:["docs.write"],inputs:[],outputs:[]};
const ops=[{op:"addTaskWithinStage",stage:"author",title:"Extra"},{op:"skipOptionalStage",stage:"author"},{op:"splitStage",stage:"author",into:[{key:"first",title:"First"},{key:"second",title:"Second"}]},{op:"addStage",stage,after:"author"},{op:"reorderStages",stage:"author",after:"review"},{op:"removeRequiredStage",stage:"author"}];
for(const op of ops){
  test(`patch schema accepts ${op.op}`,()=>assert.equal(workflowPatchOpSchema.safeParse(op).success,true));
  test(`patch schema is strict ${op.op}`,()=>assert.equal(workflowPatchOpSchema.safeParse({...op,extra:true}).success,false));
  test(`patch schema requires stage ${op.op}`,()=>{const {stage,...rest}=op;assert.equal(workflowPatchOpSchema.safeParse(rest).success,false);});
  test(`policy uses instance mapping ${op.op}`,()=>{const allowedPatches=workflowAllowedPatchesSchema.parse({});allowedPatches[op.op]="operator";assert.equal(patchPolicyOf(op,{allowedPatches}),"operator");});
}
for(const length of [0,1,120,121])test(`extra title length ${length}`,()=>assert.equal(workflowPatchOpSchema.safeParse({...ops[0],title:"a".repeat(length)}).success,length>=1&&length<=120));
for(const length of [1,2,5,6])test(`split count ${length}`,()=>assert.equal(workflowPatchOpSchema.safeParse({...ops[2],into:Array.from({length},(_,i)=>({key:`part-${i}`,title:"Part"}))}).success,length>=2&&length<=5));
for(const length of [0,1,120,121])test(`split title length ${length}`,()=>assert.equal(workflowPatchOpSchema.safeParse({...ops[2],into:[{key:"first",title:"a".repeat(length)},{key:"second",title:"Second"}]}).success,length>=1&&length<=120));
for(const caps of [[],["docs.write"],Array(8).fill("docs.write"),Array(9).fill("docs.write"),["INVALID"]])test(`split capabilities boundary case ${caps.length} ${caps[0]??"empty"}`,()=>assert.equal(workflowPatchOpSchema.safeParse({...ops[2],into:[{key:"first",title:"First",requiredCapabilities:caps},{key:"second",title:"Second"}]}).success,caps.length<=8&&caps[0]!=="INVALID"));
for(const placement of [{},{after:"author"},{before:"review"},{after:"author",before:"review"}])test(`add placement fields ${Object.keys(placement).join(" ")||"none"}`,()=>assert.equal(workflowPatchOpSchema.safeParse({op:"addStage",stage,...placement}).success,Object.keys(placement).length>0));
for(const length of [0,1,10,11])test(`patch operation count ${length}`,()=>assert.equal(workflowPatchSchema.safeParse({ops:Array(length).fill(ops[0]),reason:"Evidence"}).success,length>=1&&length<=10));
for(const length of [0,1,500,501])test(`patch reason length ${length}`,()=>assert.equal(workflowPatchSchema.safeParse({ops:[ops[0]],reason:"a".repeat(length)}).success,length>=1&&length<=500));
test("add uses identical stage schema",()=>assert.deepEqual(workflowPatchOpSchema.parse(ops[3]).stage,workflowStageSchema.parse(stage)));
for(const field of ["instanceId","projectId","taskId","attemptId","proposedBy"])test(`MCP rejects identity field ${field}`,()=>assert.equal(MCP_TOOLS["workflow.patch"].safeParse({ops:[ops[0]],reason:"Evidence",[field]:randomUUID()}).success,false));
const command=(type,payload)=>({apiVersion:1,commandId:randomUUID(),projectId:randomUUID(),type,payload});
test("patch command requires expected revision",()=>assert.equal(commandSchema.safeParse(command("workflows.patch",{instanceId:randomUUID(),ops:[ops[0]],reason:"Evidence"})).success,false));
test("patch command validates revision",()=>assert.equal(commandSchema.safeParse(command("workflows.patch",{instanceId:randomUUID(),expectedRevision:1,ops:[ops[0]],reason:"Evidence"})).success,true));
for(const decision of ["approve","reject","other"])test(`patch decision ${decision}`,()=>assert.equal(commandSchema.safeParse(command("workflows.decide-patch",{patchId:randomUUID(),decision})).success,decision!=="other"));
for(const length of [0,500,501])test(`decision comment length ${length}`,()=>assert.equal(commandSchema.safeParse(command("workflows.decide-patch",{patchId:randomUUID(),decision:"reject",comment:"a".repeat(length)})).success,length<=500));
for(const key of ["a","has/slash","UPPER","a".repeat(41)])test(`stage key boundary ${key.length} ${key[0]}`,()=>assert.equal(workflowPatchOpSchema.safeParse({...ops[1],stage:key}).success,false));
