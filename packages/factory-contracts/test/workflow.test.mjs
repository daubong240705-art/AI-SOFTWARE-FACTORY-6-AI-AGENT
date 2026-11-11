import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowDefinitionSchema as schema, conditionSchema, evaluateParamCondition as evaluate,
  workflowInstanceStateSchema, WORKFLOW_TRANSITIONS, canTransitionWorkflow, isTerminalWorkflowState,
  commandSchema, entityRefSchema } from "../dist/index.js";
const stage = () => ({ key: "author", phase: "delivery", title: "Author", requiredCapabilities: ["docs.write"], inputs: [], outputs: [] });
const base = () => ({ key: "example-flow", revision: 1, title: "Example", parameters: [], phases: ["delivery"], stages: [stage()], edges: [], joins: [], gates: [] });
test("safe patch defaults", () => assert.deepEqual(schema.parse(base()).allowedPatches, { addTaskWithinStage: "auto", skipOptionalStage: "auto", splitStage: "auto", addStage: "approval", reorderStages: "approval", removeRequiredStage: "operator" }));
test("stage defaults", () => { const s = schema.parse(base()).stages[0]; assert.equal(s.optional, false); assert.equal(s.placement, "portable"); });
const cases = [
  ["short key", d => d.key = "a"], ["long key", d => d.key = "x".repeat(41)], ["uppercase key", d => d.key = "Bad"],
  ["zero revision", d => d.revision = 0], ["fraction revision", d => d.revision = 1.2], ["empty title", d => d.title = " "],
  ["long title", d => d.title = "a".repeat(161)], ["empty domain", d => d.domain = ""], ["unknown field", d => d.code = "x"],
  ["duplicate parameters", d => d.parameters = Array(2).fill({ name: "a", type: "bool", default: true })],
  ["too many parameters", d => d.parameters = Array.from({length:21},(_,i)=>({name:`a${i}`,type:"bool",default:true}))],
  ["invalid parameter name", d => d.parameters = [{ name: "a_b", type: "bool", default: true }]],
  ["bool default", d => d.parameters = [{ name: "a", type: "bool", default: 1 }]],
  ["enum values missing", d => d.parameters = [{ name: "a", type: "enum", default: "a" }]],
  ["enum values empty", d => d.parameters = [{ name: "a", type: "enum", default: "a", values: [] }]],
  ["enum default outside values", d => d.parameters = [{ name: "a", type: "enum", default: "b", values: ["a"] }]],
  ["non-enum values", d => d.parameters = [{ name: "a", type: "string", default: "a", values: ["a"] }]],
  ["no phases", d => d.phases = []], ["duplicate phases", d => d.phases.push("delivery")],
  ["too many phases", d => d.phases = Array.from({length:13},(_,i)=>`phase${i}`)],
  ["no stages", d => d.stages = []], ["too many stages", d => d.stages = Array.from({length:61},(_,i)=>({...stage(),key:`s${i}`}))],
  ["duplicate stages", d => d.stages.push(stage())], ["unknown phase", d => d.stages[0].phase = "unknown"],
  ["invalid capability", d => d.stages[0].requiredCapabilities = ["UPPER"]],
  ["too many capabilities", d => d.stages[0].requiredCapabilities = Array(9).fill("docs.write")],
  ["missing capability and gate", d => d.stages[0].requiredCapabilities = []],
  ["invalid placement", d => d.stages[0].placement = "repo-bound"], ["invalid side effect", d => d.stages[0].sideEffect = "execute"],
  ["too many inputs", d => d.stages[0].inputs = Array(9).fill({kind:"brief",required:true})],
  ["too many outputs", d => d.stages[0].outputs = Array(9).fill({kind:"other",mustReach:"draft"})],
  ["brief output", d => d.stages[0].outputs = [{kind:"brief",mustReach:"draft"}]],
  ["invalid output status", d => d.stages[0].outputs = [{kind:"other",mustReach:"in-review"}]],
  ["zero max tasks", d => d.stages[0].limits = {maxTasks:0,budgetShare:0}],
  ["large max tasks", d => d.stages[0].limits = {maxTasks:51,budgetShare:0}],
  ["negative share", d => d.stages[0].limits = {maxTasks:1,budgetShare:-0.1}],
  ["large share", d => d.stages[0].limits = {maxTasks:1,budgetShare:1.1}],
  ["too many edges", d => d.edges = Array(201).fill({from:"author",to:"author",type:"informs"})],
  ["artifact edge missing artifact", d => d.edges = [{from:"author",to:"author",type:"artifact-approved"}]],
  ["rework missing condition", d => d.edges = [{from:"author",to:"author",type:"rework",maxLoops:1}]],
  ["rework missing limit", d => d.edges = [{from:"author",to:"author",type:"rework",when:{param:"a",op:"eq",value:true}}]],
  ["non-rework loop limit", d => d.edges = [{from:"author",to:"author",type:"informs",maxLoops:1}]],
  ["quorum missing n", d => d.joins = [{group:"group",policy:"quorum"}]],
  ["quorum zero n", d => d.joins = [{group:"group",policy:"quorum",n:0}]],
  ["all has n", d => d.joins = [{group:"group",policy:"all",n:1}]],
  ["unsafe patch", d => d.allowedPatches = {removeRequiredStage:"auto"}],
  ["invalid autonomy", d => d.autonomy = {default:"L5"}],
  ["fraction tokens", d => d.budgets = {suggestedTokens:1.5}],
  ["zero stall", d => d.timeouts = {stallAfterMinutes:0,maxDurationMinutes:1}],
  ["large stall", d => d.timeouts = {stallAfterMinutes:43201,maxDurationMinutes:1}],
  ["zero duration", d => d.timeouts = {stallAfterMinutes:1,maxDurationMinutes:0}],
  ["large duration", d => d.timeouts = {stallAfterMinutes:1,maxDurationMinutes:525601}],
];
for(const [name,change] of cases) test(`definition rejects ${name}`,()=>{const d=base();change(d);assert.equal(schema.safeParse(d).success,false);});
for(const [name,change] of [
  ["maximum key",d=>d.key="a".repeat(40)], ["minimum key",d=>d.key="ab"],
  ["parameters",d=>d.parameters=[{name:"bool",type:"bool",default:false},{name:"choice",type:"enum",default:"a",values:["a"]},{name:"text",type:"string",default:""},{name:"count",type:"number",default:0}]],
  ["gate-only",d=>{d.stages[0].requiredCapabilities=[];d.gates=[{before:"author",kind:"review",approver:"project-lead"}];}],
  ["limits boundaries",d=>d.stages[0].limits={maxTasks:50,budgetShare:1}],
  ["timeout boundaries",d=>d.timeouts={stallAfterMinutes:43200,maxDurationMinutes:525600}],
])test(`definition accepts ${name}`,()=>{const d=base();change(d);assert.equal(schema.safeParse(d).success,true);});
const expected={draft:["proposed","cancelled"],proposed:["active","cancelled"],active:["awaiting-approval","paused","suspended","stalled","completed","failed","cancelled","superseded"],"awaiting-approval":["active","suspended"],paused:["resuming","cancelled"],resuming:["active","paused"],suspended:["resuming","cancelled"],stalled:["active","paused"],completed:[],failed:[],cancelled:[],superseded:[]};
for(const from of workflowInstanceStateSchema.options){
  test(`terminal predicate ${from}`,()=>assert.equal(isTerminalWorkflowState(from),expected[from].length===0));
  test(`transition list ${from}`,()=>assert.deepEqual(WORKFLOW_TRANSITIONS[from],expected[from]));
  for(const to of workflowInstanceStateSchema.options)test(`workflow transition ${from} to ${to}`,()=>assert.equal(canTransitionWorkflow(from,to),expected[from].includes(to)));
}
for(const [op,value,result] of [["eq",2,true],["ne",2,false],["lt",3,true],["lte",2,true],["gt",1,true],["gte",2,true],["in",[1,2],true]])test(`comparison ${op}`,()=>{const c={param:"count",op,value};assert.ok(conditionSchema.safeParse(c).success);assert.equal(evaluate(c,{count:2}),String(result));});
const fact={fact:"project.hasApprovedArtifact",kind:"research-report",op:"eq",value:true};
test("fact evaluation stays unknown",()=>assert.equal(evaluate(fact,{}),"unknown"));
for(const a of ["true","false","unknown"])for(const b of ["true","false","unknown"])for(const op of ["all","any"])test(`${op} truth table ${a} ${b}`,()=>{const c=r=>r==="unknown"?fact:{param:"a",op:"eq",value:r==="true"};const result=op==="all"?(a==="false"||b==="false"?"false":a==="unknown"||b==="unknown"?"unknown":"true"):(a==="true"||b==="true"?"true":a==="unknown"||b==="unknown"?"unknown":"false");assert.equal(evaluate({[op]:[c(a),c(b)]},{a:true}),result);});
for(const [name,c] of [["code",{code:"execute"}],["empty all",{all:[]}],["empty any",{any:[]}],["wrong numeric type",{param:"a",op:"gt",value:true}],["eq array",{param:"a",op:"eq",value:[1]}],["in scalar",{param:"a",op:"in",value:1}],["mixed in",{param:"a",op:"in",value:[1,true]}],["wrong fact type",{...fact,value:"true"}],["unknown fact",{fact:"execute",op:"eq",value:true}]])test(`condition rejects ${name}`,()=>assert.equal(conditionSchema.safeParse(c).success,false));
test("condition depth four accepted and five refused",()=>{let c={param:"a",op:"eq",value:true};for(let i=0;i<3;i++)c={not:c};assert.ok(conditionSchema.safeParse(c).success);assert.equal(conditionSchema.safeParse({not:c}).success,false);});
test("evaluation never throws on malformed data",()=>{for(const c of [null,undefined,{}, {not:null}])assert.doesNotThrow(()=>evaluate(c,{}));});
test("missing and mismatched params are unknown",()=>{assert.equal(evaluate({param:"a",op:"eq",value:1},{}),"unknown");assert.equal(evaluate({param:"a",op:"eq",value:1},{a:"1"}),"unknown");});
test("workflow entity ref is additive",()=>assert.ok(entityRefSchema.safeParse({kind:"workflow-instance",id:"00000000-0000-4000-8000-000000000001",revision:1}).success));
for(const [name,change] of [
  ["long parameter name",d=>d.parameters=[{name:"a".repeat(41),type:"bool",default:true}]],
  ["number default type",d=>d.parameters=[{name:"count",type:"number",default:"1"}]],
  ["string default type",d=>d.parameters=[{name:"text",type:"string",default:false}]],
  ["nonfinite number",d=>d.parameters=[{name:"count",type:"number",default:Infinity}]],
  ["duplicate enum values",d=>d.parameters=[{name:"choice",type:"enum",default:"a",values:["a","a"]}]],
  ["empty capability",d=>d.stages[0].requiredCapabilities=[""]],
  ["long capability",d=>d.stages[0].requiredCapabilities=["a".repeat(41)]],
  ["empty stage title",d=>d.stages[0].title=""],
  ["empty team hint",d=>d.stages[0].teamHint=""],
  ["invalid stage optional",d=>d.stages[0].optional=1],
  ["invalid parallel group",d=>d.stages[0].parallelGroup="bad_group"],
  ["unknown input kind",d=>d.stages[0].inputs=[{kind:"unknown",required:true}]],
  ["missing input required",d=>d.stages[0].inputs=[{kind:"brief"}]],
  ["fraction max tasks",d=>d.stages[0].limits={maxTasks:1.1,budgetShare:0}],
  ["edge unknown type",d=>d.edges=[{from:"author",to:"author",type:"execute"}]],
  ["edge max loops zero",d=>d.edges=[{from:"author",to:"author",type:"rework",maxLoops:0,when:{param:"a",op:"eq",value:true}}]],
  ["edge max loops eleven",d=>d.edges=[{from:"author",to:"author",type:"rework",maxLoops:11,when:{param:"a",op:"eq",value:true}}]],
  ["too many joins",d=>d.joins=Array(61).fill({group:"group",policy:"all"})],
  ["duplicate joins",d=>d.joins=Array(2).fill({group:"group",policy:"all"})],
  ["fraction quorum",d=>d.joins=[{group:"group",policy:"quorum",n:1.5}]],
  ["invalid gate kind",d=>d.gates=[{before:"author",kind:"execute",approver:"operator"}]],
  ["invalid gate approver",d=>d.gates=[{before:"author",kind:"review",approver:"agent"}]],
  ["too many gates",d=>d.gates=Array(201).fill({before:"author",kind:"review",approver:"operator"})],
  ["unknown patch field",d=>d.allowedPatches={execute:"auto"}],
  ["unknown patch policy",d=>d.allowedPatches={addStage:"allow"}],
  ["unknown cross-team autonomy",d=>d.autonomy={default:"L2",crossTeam:"L5"}],
  ["negative budget",d=>d.budgets={suggestedTokens:-1}],
  ["invalid stage shares",d=>d.budgets={suggestedTokens:1,stageShares:1}],
])test(`additional definition rejects ${name}`,()=>{const d=base();change(d);assert.equal(schema.safeParse(d).success,false);});
for(const [name,c] of [
  ["approved artifact",fact], ["review",{fact:"review.verdict",op:"in",value:["accepted","changes-requested"]}],
  ["artifact status",{fact:"artifact.status",kind:"other",op:"eq",value:"approved"}],
  ["check result",{fact:"check.result",check:"unit",op:"ne",value:"failed"}],
  ["monitor value",{fact:"monitor.value",monitor:"latency",op:"gte",value:2}],
  ["label",{fact:"label",name:"priority",op:"eq",value:"high"}],
])test(`typed fact ${name} validates and evaluates unknown`,()=>{assert.ok(conditionSchema.safeParse(c).success);assert.equal(evaluate(c,{}),"unknown");});
for(const [name,c] of [
  ["approved artifact missing kind",{fact:"project.hasApprovedArtifact",op:"eq",value:true}],
  ["invalid review verdict",{fact:"review.verdict",op:"eq",value:"unknown"}],
  ["invalid artifact status",{fact:"artifact.status",kind:"other",op:"eq",value:"unknown"}],
  ["check missing name",{fact:"check.result",op:"eq",value:"passed"}],
  ["monitor missing name",{fact:"monitor.value",op:"gt",value:1}],
  ["monitor string value",{fact:"monitor.value",monitor:"latency",op:"eq",value:"1"}],
  ["label missing name",{fact:"label",op:"eq",value:"high"}],
  ["too many children",{all:Array(21).fill({param:"a",op:"eq",value:true})}],
])test(`typed fact rejects ${name}`,()=>assert.equal(conditionSchema.safeParse(c).success,false));
for(const [value,result] of [[true,"false"],[false,"true"]])test(`negation ${value}`,()=>assert.equal(evaluate({not:{param:"a",op:"eq",value:true}},{a:value}),result));
test("unknown negation",()=>assert.equal(evaluate({not:fact},{}),"unknown"));
for(const type of ["create","start","pause","resume","cancel"])test(`workflow command ${type}`,()=>{const id="00000000-0000-4000-8000-000000000001";assert.ok(commandSchema.safeParse({apiVersion:1,commandId:id,projectId:id,type:`workflows.${type}`,payload:{instanceId:id,...(type==="create"?{definitionKey:"example-flow"}:{expectedRevision:1}),...(["pause","cancel"].includes(type)?{reason:"Operator request"}:{})}}).success);});
