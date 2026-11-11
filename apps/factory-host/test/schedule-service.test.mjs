import assert from "node:assert/strict";
import { test } from "node:test";
import { nextRunAfter, validateSchedule } from "../dist/schedule/service.js";
import { packs } from "./workflow-fixture.mjs";
import { input } from "./schedule-fixture.mjs";
const at="2026-11-08T00:00:00.000Z", now=new Date(at);
for(const [seconds,from,expected] of [[60,0,60],[60,1,60],[60,59,60],[60,60,120],[60,61,120],[60,600,660],[3600,1,3600],[3600,7201,10800],[2592000,0,2592000],[60,-1,60]])
 test(`interval anchor ${seconds} at ${from}`,()=>assert.equal(nextRunAfter({kind:"interval",expr:String(seconds),timezone:"Asia/Ho_Chi_Minh",created_at:at},new Date(now.getTime()+from*1000)).getTime(),now.getTime()+expected*1000));
for(const [expr,zone,from,expected] of [
 ["* * * * *","Asia/Ho_Chi_Minh",at,"2026-11-08T00:01:00.000Z"],
 ["0 9 * * *","Asia/Ho_Chi_Minh",at,"2026-11-08T02:00:00.000Z"],
 ["0 0 9 * * *","Asia/Ho_Chi_Minh",at,"2026-11-08T02:00:00.000Z"],
 ["0 */2 * * *","UTC",at,"2026-11-08T02:00:00.000Z"],
 ["0 0 * * 1","UTC",at,"2026-11-09T00:00:00.000Z"],
 ["0 0 1 * *","UTC",at,"2026-12-01T00:00:00.000Z"],
 ["30 2 * * *","America/New_York","2026-03-08T05:00:00Z","2026-03-08T07:00:00.000Z"],
 ["30 1 * * *","America/New_York","2026-11-01T04:00:00Z","2026-11-01T05:30:00.000Z"],
 ["30 1 * * *","America/New_York","2026-11-01T05:30:00Z","2026-11-02T06:30:00.000Z"],
 ["30 2 * * *","Asia/Ho_Chi_Minh","2026-03-08T00:00:00Z","2026-03-08T19:30:00.000Z"],
])test(`cron time ${expr} ${zone} ${from}`,()=>assert.equal(nextRunAfter({kind:"cron",expr,timezone:zone,created_at:at},new Date(from)).toISOString(),expected));
for(const seconds of [-1,0,1])test(`once boundary ${seconds}`,()=>{const value=nextRunAfter({kind:"once",expr:at,timezone:"UTC",created_at:at},new Date(now.getTime()+seconds*1000));assert.equal(value?.toISOString()??null,seconds<0?at:null);});
for(const [label,patch,message] of [
 ["invalid cron",{kind:"cron",expr:"x x x x x"},"invalid cron expression"],
 ["frequent cron",{kind:"cron",expr:"* * * * * *"},"cron interval must be at least 60 seconds"],
 ["thirty seconds",{kind:"cron",expr:"*/30 * * * * *"},"cron interval must be at least 60 seconds"],
 ["bad timezone",{timezone:"Invalid/Zone"},"invalid schedule timezone"],
 ["offset timezone",{timezone:"+07:00"},"invalid schedule timezone"],
 ["past once",{kind:"once",expr:at},"once must be in the future"],
 ["unknown definition",{action:{definitionKey:"unknown-flow"}},"workflow definition not found"],
 ["ambiguous definition",{action:{definitionKey:"software-delivery"}},"ambiguous workflow definition"],
 ["invalid params",{action:{definitionKey:"software-delivery",packKey:"software-team",params:{hasUI:"bad"}}},"invalid workflow parameters"],
 ["unknown params",{action:{definitionKey:"software-delivery",packKey:"software-team",params:{other:true}}},"invalid workflow parameters"],
 ["invalid enum",{action:{definitionKey:"software-delivery",packKey:"software-team",params:{deployTarget:"invalid"}}},"invalid workflow parameters"],
])test(`runtime validation ${label}`,()=>assert.throws(()=>validateSchedule(input(patch),packs,now),{message}));
