import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync,readFileSync,readdirSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { engineFixture } from "./workflow-engine-fixture.mjs";
import { temp,migrationsDir } from "./org-fixture.mjs";
import { openStorage } from "../dist/storage/database.js";
const insert=(f,override={})=>{const row={project_id:f.projectId,instance_id:f.id,id:"patch",number:1,proposed_by:"lead",source_task_id:null,reason:"Evidence",ops_json:"[]",policy:"auto",state:"pending",refusal:null,decided_by:null,decided_at:null,comment:null,created_at:f.clock().toISOString(),applied_revision:null,...override};f.raw.prepare(`INSERT INTO workflow_patches (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(()=>"?").join(",")})`).run(...Object.values(row));};
test("migration twelve creates strict table with composite foreign key",t=>{const f=engineFixture(t);assert.deepEqual(f.raw.prepare("SELECT version FROM migration_ledger ORDER BY version").all().map(r=>r.version),Array.from({length:18},(_,i)=>i+1));assert.equal(f.raw.pragma("table_list").find(r=>r.name==="workflow_patches").strict,1);assert.equal(f.raw.pragma("foreign_key_list(workflow_patches)").length,2);assert.deepEqual(f.raw.pragma("foreign_key_check"),[]);});
for(const [name,override] of [
  ["number zero",{number:0}],["number fraction",{number:1.5}],["proposer",{proposed_by:"unknown"}],
  ["reason",{reason:"a".repeat(501)}],["invalid json",{ops_json:"bad"}],["large json",{ops_json:JSON.stringify("a".repeat(65536))}],
  ["policy",{policy:"unknown"}],["state",{state:"unknown"}],["refusal",{refusal:"a".repeat(301)}],
  ["comment",{comment:"a".repeat(501)}],["missing instance",{instance_id:"unknown"}],["wrong project",{project_id:"unknown"}],
])test(`migration patch constraint ${name}`,t=>{const f=engineFixture(t);assert.throws(()=>insert(f,override));});
test("patch numbers unique within instance",t=>{const f=engineFixture(t);insert(f);assert.throws(()=>insert(f,{id:"second"}),/UNIQUE/);});
test("patch boundary lengths accepted",t=>{const f=engineFixture(t);insert(f,{reason:"a".repeat(500),refusal:"a".repeat(300),comment:"a".repeat(500)});assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM workflow_patches").get().n,1);});
for(const n of [-1,21,1.5])test(`extra task column rejects ${n}`,t=>{const f=engineFixture(t);assert.throws(()=>f.raw.prepare("UPDATE workflow_stages SET extra_tasks=?").run(n));});
test("extra task title column requires json",t=>{const f=engineFixture(t);assert.throws(()=>f.raw.prepare("UPDATE workflow_stages SET extra_titles='bad'").run());assert.ok(f.raw.prepare("SELECT extra_tasks,extra_titles FROM workflow_stages").all().every(r=>r.extra_tasks===0&&r.extra_titles==="[]"));});
test("upgrade from eleven keeps definitions stages and task history",t=>{
  const root=temp(t),old=join(root,"old"),backup=join(root,"backups");
  mkdirSync(old);mkdirSync(backup);
  for(const name of readdirSync(migrationsDir).filter(n=>n.endsWith(".sql")&&Number(n.slice(0,4)) < 12))writeFileSync(join(old,name),readFileSync(join(migrationsDir,name)));
  const storage=openStorage(":memory:");t.after(()=>storage.close());storage.migrate({migrationsDir:old,backupDir:null});
  storage.raw.prepare("INSERT INTO projects VALUES ('project',1,'Example','directory','synthetic','active')").run();
  storage.raw.prepare("INSERT INTO workflow_instances (project_id,id,revision,key,pack_key,pack_version,definition_revision,definition_json,params_json,title,state,created_at) VALUES ('project','instance',1,'example','example','1.0.0',1,'{}','{}','Example','proposed','2026-11-10T00:00:00.000Z')").run();
  storage.raw.prepare("INSERT INTO workflow_stages (project_id,instance_id,stage_key,phase,state,optional) VALUES ('project','instance','author','delivery','pending',0)").run();
  storage.raw.prepare("INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,origin_kind,state,required_capabilities_json,acceptance_json,inputs_json) VALUES ('project','task',1,'WF-001','Title','Goal','Brief','operator','draft','[]','[]','[]')").run();
  storage.raw.prepare("INSERT INTO workflow_stage_tasks VALUES ('project','instance','author',1,'task','2026-11-10T00:00:00.000Z')").run();
  const before=storage.raw.prepare("SELECT * FROM workflow_instances").all();const history=storage.raw.prepare("SELECT * FROM workflow_stage_tasks").all();assert.deepEqual(storage.migrate({migrationsDir,backupDir:backup}).applied,[12,13,14,15,16,17,18]);assert.deepEqual(storage.raw.prepare("SELECT * FROM workflow_instances").all(),before.map(row=>({...row,last_progress_at:null})));assert.equal(storage.raw.prepare("SELECT extra_tasks FROM workflow_stages").get().extra_tasks,0);assert.deepEqual(storage.raw.prepare("SELECT * FROM workflow_stage_tasks").all(),history);
});
