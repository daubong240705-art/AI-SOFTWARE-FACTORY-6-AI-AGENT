import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleInputSchema, schedulePatchSchema, commandSchema, entityKindSchema, FOUNDATION_COMMANDS } from "../dist/index.js";
const input=(patch={})=>({name:"Report",kind:"interval",expr:"60",action:{definitionKey:"software-delivery"},...patch});
const id="00000000-0000-4000-8000-000000000001";
test("schedule defaults",()=>{const s=scheduleInputSchema.parse(input());assert.equal(s.timezone,"Asia/Ho_Chi_Minh");assert.equal(s.action.autoStart,true);assert.equal(s.missedPolicy,"skip");assert.equal(s.catchUpLimit,3);assert.equal(s.concurrency,"skip-if-running");assert.equal(s.enabled,true);});
for(const [label,patch] of [
  ["empty name",{name:""}],["long name",{name:"a".repeat(161)}],["unknown kind",{kind:"daily"}],
  ["empty expression",{expr:""}],["long expression",{expr:"a".repeat(201)}],
  ["interval low",{expr:"59"}],["interval high",{expr:"2592001"}],["interval decimal",{expr:"60.0"}],
  ["interval exponent",{expr:"6e1"}],["interval signed",{expr:"+60"}],["interval whitespace",{expr:" 60"}],
  ["interval negative",{expr:"-60"}],["interval zero",{expr:"0"}],
  ["short cron",{kind:"cron",expr:"* * * *"}],["long cron",{kind:"cron",expr:"* * * * * * *"}],
  ["once no offset",{kind:"once",expr:"2027-01-01T00:00:00"}],["once invalid",{kind:"once",expr:"tomorrow"}],
  ["timezone empty",{timezone:""}],["timezone long",{timezone:"a".repeat(65)}],
  ["missed policy",{missedPolicy:"all"}],["catchup zero",{catchUpLimit:0}],["catchup high",{catchUpLimit:6}],
  ["catchup fraction",{catchUpLimit:1.5}],["concurrency",{concurrency:"all"}],
  ["parallel absent",{concurrency:"allow-parallel"}],["parallel low",{parallelLimit:1}],
  ["parallel high",{parallelLimit:6}],["parallel fraction",{parallelLimit:2.5}],["enabled type",{enabled:1}],
  ["unknown field",{extra:true}],["action unknown",{action:{definitionKey:"example-flow",extra:true}}],
  ["definition invalid",{action:{definitionKey:"X"}}],["params nested",{action:{definitionKey:"example-flow",params:{a:{b:1}}}}],
  ["autoStart type",{action:{definitionKey:"example-flow",autoStart:1}}],
])test(`schedule schema rejects ${label}`,()=>assert.equal(scheduleInputSchema.safeParse(input(patch)).success,false));
for(const [label,patch] of [
  ["interval min",{expr:"60"}],["interval max",{expr:"2592000"}],
  ["five fields",{kind:"cron",expr:"0 9 * * *"}],["six fields",{kind:"cron",expr:"0 0 9 * * *"}],
  ["UTC once",{kind:"once",expr:"2027-01-01T00:00:00Z"}],
  ["offset once",{kind:"once",expr:"2027-01-01T07:00:00+07:00"}],
  ["catchup min",{missedPolicy:"catch-up-limited",catchUpLimit:1}],
  ["catchup max",{missedPolicy:"catch-up-limited",catchUpLimit:5}],
  ["parallel min",{concurrency:"allow-parallel",parallelLimit:2}],
  ["parallel max",{concurrency:"allow-parallel",parallelLimit:5}],
])test(`schedule schema accepts ${label}`,()=>assert.ok(scheduleInputSchema.safeParse(input(patch)).success));
test("patch preserves omitted defaults",()=>assert.deepEqual(schedulePatchSchema.parse({name:"Changed"}),{name:"Changed"}));
test("patch forbids changing kind",()=>assert.equal(schedulePatchSchema.safeParse({kind:"once"}).success,false));
for(const type of ["create","update","pause","resume","delete","run-now"])test(`schedule command ${type}`,()=>{
 const payload=type==='create'?{scheduleId:id,...input()}:type==='update'?{scheduleId:id,expectedRevision:1,patch:{name:"New"}}:{scheduleId:id,expectedRevision:1};
 assert.ok(commandSchema.safeParse({apiVersion:1,commandId:id,projectId:id,type:`schedules.${type}`,payload}).success);
});
test("schedule entity kind and command counts",()=>{assert.ok(entityKindSchema.options.includes("schedule"));assert.equal(FOUNDATION_COMMANDS.length,59);});
