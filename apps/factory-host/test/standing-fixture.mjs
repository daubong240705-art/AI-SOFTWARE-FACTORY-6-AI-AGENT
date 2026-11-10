import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { notifyFixture } from "./notify-fixture.mjs";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { setAutonomyHandler } from "../dist/policy/autonomy.js";
import { createStandingApprovalHandlers, getStandingApproval, useStandingApproval, sendInternalNotification } from "../dist/standing/index.js";
import { createStandingApprovalMcp } from "../dist/standing/mcp.js";
import { createToolPolicy } from "../dist/mcp/policy.js";
import { createMcpHandler } from "../dist/mcp/rpc.js";

export function standingFixture(t, options = {}) {
  const f = notifyFixture(t, options);
  const deps = { raw: f.raw, hub: f.hub, clock: f.clock, ...(options.utcOffsetMinutes === undefined ? {} : { utcOffsetMinutes: options.utcOffsetMinutes }) };
  const pipeline = createCommandPipeline({ storage: f.storage, hub: f.hub, clock: f.clock,
    handlers: { ...createStandingApprovalHandlers(), "autonomy.set": setAutonomyHandler } });
  const command = (type, payload, projectId = f.projectId, commandId = randomUUID()) =>
    pipeline.execute({ apiVersion: 1, commandId, projectId, type, payload });
  const level = (value = 4, projectId = f.projectId) => {
    const prior = f.raw.prepare("SELECT revision FROM autonomy_settings WHERE project_id=? AND subject='project'").get(projectId);
    const r = command("autonomy.set", { subject: "project", subjectRef: projectId, expectedRevision: prior?.revision ?? null, level: value }, projectId);
    assert.equal(r.status, 200); return r;
  };
  const input = (patch = {}) => ({ standingId: randomUUID(), actionKind: "notify.send-internal", scope: { kind: "project", ref: f.projectId },
    expiresAt: new Date(f.clock().getTime() + 10 * 86400000).toISOString(), ...patch });
  const create = (patch = {}, projectId = f.projectId) => {
    const payload = input(patch), r = command("standing-approvals.create", payload, projectId);
    assert.equal(r.status, 200, JSON.stringify(r.body)); return payload.standingId;
  };
  const row = (id, projectId = f.projectId) => getStandingApproval(f.raw, projectId, id);
  const revoke = (id, expectedRevision = row(id).revision, projectId = f.projectId) =>
    command("standing-approvals.revoke", { standingId: id, expectedRevision }, projectId);
  const use = (patch = {}) => useStandingApproval(f.raw, { projectId: f.projectId, actionKind: "notify.send-internal",
    now: f.clock(), useId: randomUUID(), ...patch });
  const send = (patch = {}) => sendInternalNotification(deps, { projectId: f.projectId, title: "Report ready", body: "Review the latest report.", now: f.clock(), id: randomUUID(), ...patch });
  const uses = (projectId = f.projectId) => f.raw.prepare("SELECT * FROM standing_approval_uses WHERE project_id=? ORDER BY rowid").all(projectId);
  const effects = () => f.raw.prepare("SELECT body_json FROM event_log WHERE project_id=? ORDER BY sequence").all(f.projectId)
    .map(r => JSON.parse(r.body_json).payload).filter(p => p.type === "entity.changed");
  return { ...f, deps, pipeline, command, level, input, create, row, revoke, use, send, uses, effects };
}

export function standingMcpFixture(t, tools = ["notify.send-internal"]) {
  const f = standingFixture(t);
  const taskId = f.task({ seatId: f.seat.id, engagementId: f.primary.id }), attempt = f.enqueue(taskId);
  const pinned = f.raw.prepare("SELECT t.pack_digest AS digest,p.manifest_json FROM teams t JOIN pack_snapshots p ON p.digest=t.pack_digest WHERE t.id=?").get(f.teamId);
  const manifest = JSON.parse(pinned.manifest_json), seat = manifest.seats.find(s => s.name === f.seat.name);
  if (tools === null) delete seat.tools; else seat.tools = tools;
  f.raw.prepare("UPDATE pack_snapshots SET manifest_json=? WHERE digest=?").run(JSON.stringify(manifest), pinned.digest);
  f.raw.prepare("INSERT OR IGNORE INTO nodes (id,revision,name,platform,trust,state,slots_total,slots_used,last_heartbeat_at) VALUES ('local',1,'Local','windows','trusted-workstation','online',2,0,?)").run(f.clock().toISOString());
  f.raw.prepare("UPDATE attempts SET state='running',node_id='local',lease_id=?,lease_expires_at=? WHERE id=?")
    .run(randomUUID(), new Date(f.clock().getTime() + 600000).toISOString(), attempt.id);
  const grant = { projectId: f.projectId, taskId, attemptId: attempt.id, epoch: attempt.epoch };
  const deps = { standing: createStandingApprovalMcp(f.deps), toolPolicy: createToolPolicy(f.raw), progress() {},
    registerOutput() { return { artifactId: randomUUID(), version: 1 }; }, requestDecision() { return { approvalId: randomUUID() }; } };
  const handler = createMcpHandler(deps);
  const call = (args = { title: "Report ready", body: "Summary" }, g = grant, name = "notify.send-internal") =>
    handler.handle(g, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }).body.result;
  const list = () => handler.handle(grant, { jsonrpc: "2.0", id: 1, method: "tools/list" }).body.result.tools;
  return { ...f, mcpDeps: deps, manifest, grant, call, list };
}
