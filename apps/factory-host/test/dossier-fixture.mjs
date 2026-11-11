import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openStorage } from "../dist/storage/database.js";
import { EventHub } from "../dist/events/hub.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createDossierHandlers } from "../dist/dossier/commands.js";
import { createKnowledgeHandlers, withKnowledgeEffects } from "../dist/knowledge/commands.js";
import { createKnowledgeIndex } from "../dist/knowledge/index.js";
import { tasksTransitionHandler } from "../dist/work/service.js";
import { buildDossier } from "../dist/dossier/build.js";
import { buildBriefing } from "../dist/dossier/briefing.js";

export const BEFORE = "2026-11-01T00:00:00.000Z";
export const SINCE = "2026-11-02T00:00:00.000Z";
export const AFTER = "2026-11-03T00:00:00.000Z";
export function fixture(t) {
  const storage = openStorage(":memory:"); storage.migrate({ migrationsDir: fileURLToPath(new URL("../migrations/",import.meta.url)),backupDir: null });
  t.after(() => storage.close()); const raw = storage.raw; const projectId = randomUUID();
  let at = new Date("2026-11-08T00:00:00.000Z"); const clock = () => at;
  const hub = new EventHub(raw,{ clock });
  raw.prepare("INSERT INTO projects VALUES (?,1,'Example project','directory','unused','active')").run(projectId);hub.ensureStream(projectId);
  const objects = new Map();
  const store = { put(value) { const bytes=Buffer.from(value); const hash=createHash("sha256").update(bytes).digest("hex");objects.set(hash,bytes);return {hash,size:bytes.length}; },
    get(hash) { return objects.get(hash) ?? null; },has(hash) { return objects.has(hash); },size(hash) { return objects.get(hash)?.length ?? null; } };
  const index=createKnowledgeIndex({raw,store});
  const pipeline=createCommandPipeline({storage,hub,clock,handlers:{...createDossierHandlers({store,afterRegister(ref){index.indexVersion(ref.projectId,ref.artifactId,ref.version);}}),
    ...createKnowledgeHandlers({multiTeam:true}),"tasks.transition":withKnowledgeEffects(tasksTransitionHandler)}});
  const execute=(type,payload={},patch={})=>pipeline.execute({apiVersion:1,commandId:randomUUID(),projectId,type,payload,...patch});
  const refresh=()=>{const r=execute("dossier.refresh");assert.equal(r.status,200,JSON.stringify(r.body));return r.body.receipt.effects[0];};
  const team=(name="Example team",patch={})=>{const id=randomUUID();raw.prepare("INSERT INTO teams (id,revision,name,charter,pack_key,pack_version,lifecycle) VALUES (?,1,?,'Charter',?,?,'active')").run(id,name,patch.packKey??"example",patch.packVersion??"1.0.0");return id;};
  const engage=(teamId,patch={})=>{const id=randomUUID();raw.prepare("INSERT INTO engagements VALUES (?,?,?,1,?,?,?,?)").run(projectId,id,teamId,patch.priority??50,patch.maxConcurrent??2,patch.state??"active",BEFORE);return id;};
  let code=0;
  const task=(patch={})=>{const id=randomUUID();const n=++code;raw.prepare(`INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,origin_kind,state,required_capabilities_json,acceptance_json,inputs_json)
    VALUES (?,?,1,?,?,'Goal','Brief','operator',?,'[]','[]',?)`).run(projectId,id,patch.code??`DS-${String(n).padStart(3,"0")}`,patch.title??"Task",patch.state??"ready",JSON.stringify(patch.inputs??[]));return id;};
  const artifact=(patch={})=>{const row={artifactId:randomUUID(),version:1,title:"Document",kind:"requirements",status:"approved",l0:"Artifact summary",l1:null,at:AFTER,visibility:"project",supersedes:null,producer:null,...patch};
    const content=store.put(row.body??"Artifact body");raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,abstract_l0,abstract_l1,
    produced_by_attempt_id,supersedes_version,visibility,created_at) VALUES (?,?,?,?,?,'text/markdown',?,?,?,?,?,?,?,?,?)`).run(projectId,row.artifactId,row.version,row.kind,row.title,content.hash,content.size,row.status,row.l0,row.l1,row.producer,row.supersedes,row.visibility,row.at);return {artifactId:row.artifactId,version:row.version};};
  const approval=(patch={})=>{const row={id:randomUUID(),state:"applied",subject:"Choose design",label:"Chosen design",at:AFTER,kind:"question",taskId:null,...patch};const applied=row.state==="applied";
    raw.prepare(`INSERT INTO approvals (project_id,id,revision,kind,task_id,subject,summary,options_json,impact_if_waiting,context_digest,approver,requested_at,expires_at,state,outcome_option_id,outcome_actor_id,decided_at,applied_by_command_id)
    VALUES (?,?,1,?,?,?,'Question details',?,'Wait',?,'operator',?,'2099-01-01T00:00:00.000Z',?,?,?,?,?)`).run(projectId,row.id,row.kind,row.taskId,row.subject,JSON.stringify([{id:row.option??"yes",label:row.label},{id:"no",label:"Decline"}]),"a".repeat(64),row.at,row.state,applied?row.option??"yes":null,applied?"operator":null,applied?row.at:null,applied?randomUUID():null);return row.id;};
  const request=(patch={})=>{const id=task({state:"proposed",...patch});const requester=task();const target=patch.teamId??team();
    raw.prepare("UPDATE tasks SET origin_kind='cross-team',requester_task_id=?,request_kind=?,hop=1 WHERE id=?").run(requester,patch.kind??"consult",id);
    raw.prepare(`INSERT INTO ctr_meta (project_id,task_id,root_task_id,dedup_key,target_team_id,response_mode,expected_response_json,context_refs_json,triage_state,closed_at)
    VALUES (?,?,?,'dedup',?,'async','{}','[]',?,?)`).run(projectId,id,requester,target,patch.triageState??"submitted",patch.closed??null);
    raw.prepare("INSERT INTO ctr_messages VALUES (?,?,1,'system','Request opened',?)").run(projectId,id,patch.at??AFTER);return id;};
  const transition=(ref,to)=>execute("artifacts.transition",{...ref,to,comment:"Review"});
  const row=(ref)=>raw.prepare("SELECT * FROM artifact_versions WHERE project_id=? AND artifact_id=? AND version=?").get(projectId,ref.artifactId??ref.id,ref.version??ref.revision);
  const build=()=>buildDossier(raw,{projectId,now:clock()});
  const briefing=(patch={})=>buildBriefing(raw,{projectId,now:clock(),store,...patch});
  const event=(payload,date=AFTER)=>{const old=at;at=new Date(date);hub.transaction(()=>hub.append({projectId,causationId:randomUUID(),payload}));at=old;};
  const grant=()=>{const teamId=team();const seatId=randomUUID();const taskId=task({state:"active"});const attemptId=randomUUID();
    raw.prepare("INSERT INTO seats VALUES (?,?,1,'Writer','Writer','profile',1,'fake',1,'elastic',NULL,0)").run(seatId,teamId);
    raw.prepare("INSERT OR IGNORE INTO nodes (id,revision,name,platform,trust,state,slots_total,slots_used) VALUES ('fixture',1,'Fixture','linux','trusted-workstation','online',4,0)").run();
    raw.prepare(`INSERT INTO attempts (project_id,id,task_id,revision,epoch,state,outcome,node_id,runtime,provider,model,effort,lease_id,lease_expires_at)
    VALUES (?,?,?,1,1,'running','known','fixture','fake','fake','fake','medium',?,'2099-01-01T00:00:00.000Z')`).run(projectId,attemptId,taskId,randomUUID());
    raw.prepare("INSERT INTO attempt_seats VALUES (?,?,?)").run(projectId,attemptId,seatId);return {projectId,taskId,attemptId,epoch:1,teamId,seatId};};
  return {raw,storage,projectId,store,index,hub,pipeline,clock,execute,refresh,team,engage,task,artifact,approval,request,transition,row,build,briefing,event,grant,setTime(value){at=new Date(value);}};
}
