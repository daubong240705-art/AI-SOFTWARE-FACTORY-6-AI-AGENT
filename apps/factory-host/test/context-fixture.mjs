import { randomUUID } from "node:crypto";
import { fixture as orgFixture } from "./org-fixture.mjs";
import { createAttempt } from "../dist/dispatch/index.js";
import { buildContextPack } from "../dist/context/pack.js";

export function fixture(t, options = {}) {
  const f = orgFixture(t, options);
  const taskId = f.task({ seatId: f.seat.id, goal: "Build the deliverable", brief: "Task detail", acceptance: ["Verify output"], ...options.task });
  const artifact = (patch = {}) => {
    const row = { artifactId: randomUUID(), version: 1, projectId: f.projectId, kind: "requirements", title: "Input document",
      l0: "Short summary", l1: "Detailed summary", status: "approved", visibility: "project", producer: null, ...patch };
    f.raw.prepare(`INSERT INTO artifact_versions (project_id,artifact_id,version,kind,title,media_type,content_hash,size_bytes,status,
      abstract_l0,abstract_l1,visibility,produced_by_attempt_id,created_at) VALUES (?,?,?,?,?,'text/plain',?,1,?,?,?,?,?,?)`)
      .run(row.projectId,row.artifactId,row.version,row.kind,row.title,"a".repeat(64),row.visibility==="team-draft" && patch.status===undefined?"draft":row.status,row.l0,row.l1,row.visibility,row.producer,f.clock().toISOString());
    return { artifactId: row.artifactId, version: row.version };
  };
  const inputs = (refs) => f.raw.prepare("UPDATE tasks SET inputs_json = ? WHERE project_id = ? AND id = ?").run(JSON.stringify(refs),f.projectId,taskId);
  const attempt = (id = taskId, seatId = f.seat.id) => createAttempt(f.raw, { projectId: f.projectId, taskId: id, seatId,
    id: randomUUID(), runtime: "fake", provider: "fake", model: "fake", effort: "medium", now: f.clock().toISOString() });
  const build = (patch = {}) => buildContextPack(f.raw, { projectId: f.projectId,taskId,seatId:f.seat.id,now:f.clock(),...patch });
  const approval = (patch = {}) => {
    const row = { id: randomUUID(), taskId, subject: "Choose design", summary: "Explain the choice", state: "applied", kind: "question",
      at: f.clock().toISOString(), label: "Use chosen design", ...patch };
    const decided = ["applied","approved","rejected","changes-requested"].includes(row.state);
    f.raw.prepare(`INSERT INTO approvals (project_id,id,revision,kind,task_id,subject,summary,options_json,impact_if_waiting,context_digest,
      approver,requested_at,expires_at,state,outcome_option_id,outcome_actor_id,decided_at,applied_by_command_id)
      VALUES (?,?,1,?,?,?,?,?,'Wait',?,'operator',?,'2099-01-01T00:00:00.000Z',?,?,?,?,?)`)
      .run(f.projectId,row.id,row.kind,row.taskId,row.subject,row.summary,JSON.stringify([{id:"yes",label:row.label},{id:"no",label:"Decline"}]),
        "a".repeat(64),row.at,row.state,decided?"yes":null,decided?"operator":null,decided?row.at:null,row.state==="applied"?randomUUID():null);
    return row.id;
  };
  return { ...f,taskId,artifact,inputs,attempt,build,approval };
}
