import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, pack, packs } from "./org-fixture.mjs";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createWorkflowHandlers } from "../dist/workflow/commands.js";
export { pack, packs };
export const definition = () => ({ key:"example-flow",revision:1,title:"Example",parameters:[{name:"hasUI",type:"bool",default:true}],phases:["delivery"],stages:[{key:"author",phase:"delivery",title:"Author",requiredCapabilities:["docs.write"],inputs:[],outputs:[{kind:"other",mustReach:"approved"}]},{key:"review",phase:"delivery",title:"Review",requiredCapabilities:["docs.review"],inputs:[],outputs:[]}],edges:[{from:"author",to:"review",type:"finish-to-start"}],joins:[],gates:[] });
export function workflowFixture(t, entries=packs){
  const f=fixture(t); const pipeline=createCommandPipeline({storage:f.storage,hub:f.hub,clock:f.clock,handlers:createWorkflowHandlers({packs:entries})});
  const command=(type,payload,extra={})=>({apiVersion:1,commandId:randomUUID(),projectId:f.projectId,type,payload,...extra});
  const execute=(type,payload,extra)=>pipeline.execute(command(type,payload,extra));
  const create=(params={},extra={})=>{const id=randomUUID();const result=execute("workflows.create",{instanceId:id,definitionKey:"software-delivery",packKey:"software-team",params,...extra});assert.equal(result.status,200,JSON.stringify(result.body));return id;};
  return {...f,pipeline,command,execute,create};
}
