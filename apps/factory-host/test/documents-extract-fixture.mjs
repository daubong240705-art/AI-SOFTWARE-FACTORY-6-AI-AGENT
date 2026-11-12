import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setTimeout } from "node:timers/promises";
import { documentsFixture } from "./documents-fixture.mjs";
import { createExtractionService } from "../dist/documents/service.js";
import { docWorkerConfig } from "../dist/documents/config.js";
import { registerExtractionRoutes } from "../dist/documents/routes.js";
import { startHost } from "../dist/host.js";

export const workerResult = (markdown = "# Extracted\nsearchableworkerbody", extra = {}) => ({
  markdown, pages: null, outline: [], metadata: { title: null, author: null, language: null }, warnings: [], ...extra,
});
export const workerConfig = (source = `process.stdout.write(${JSON.stringify(JSON.stringify(workerResult()))})`) =>
  docWorkerConfig({ FACTORY_DOC_WORKER_COMMAND: JSON.stringify([process.execPath, "-e", source]) });
export async function eventually(predicate, message = "expected asynchronous state") {
  const end = Date.now() + 10000;
  while (Date.now() < end) { const value = await predicate(); if (value) return value; await setTimeout(10); }
  assert.fail(message);
}
export function extractionFixture(t, config = workerConfig()) {
  let service;
  const f = documentsFixture(t, {}, (app, guards, deps) => {
    service = createExtractionService({ ...deps, config });
    app.addHook("onClose", () => service.close());
    registerExtractionRoutes(app, guards, service);
  });
  const enqueue = row => service.enqueue(row.projectId, row.artifactId, row.version);
  f.headers["content-type"] = "application/json";
  const record = row => service.get(row.projectId, row.artifactId, row.version);
  const completed = row => eventually(() => { const value = record(row); return value && !["pending", "running"].includes(value.status) && value; });
  return { ...f, service, enqueue, record, completed };
}
export function temporary(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-doc-extract-")));
  t.after(() => {
    assert.ok(resolve(root).startsWith(realpathSync(tmpdir()) + sep + "factory-doc-extract-"));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
export async function extractionHost(t, options = {}) {
  let host;
  t.after(async () => { await host?.close(); });
  const stateDir = temporary(t); let bootstrap;
  const launch = () => startHost({ stateDir, port: 0, docWorker: workerConfig(), onBootstrapToken(value) { bootstrap = value; }, ...options });
  host = await launch();
  const origin = `http://127.0.0.1:${host.port}`;
  const response = await host.app.inject({ method: "POST", url: "/auth/bootstrap", headers: { host: `127.0.0.1:${host.port}`, origin }, payload: { token: bootstrap } });
  assert.equal(response.statusCode, 200);
  const cookieHeader = response.headers["set-cookie"];
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)?.split(";")[0];
  assert.ok(cookie);
  const headers = { host: `127.0.0.1:${host.port}`, origin, cookie, "x-csrf-token": response.json().csrfToken, "content-type": "application/json" };
  return { ...host, stateDir, headers, async restart() { await host.close(); host = await launch(); return host; } };
}
export function seedAttempt(raw, projectId = randomUUID()) {
  raw.prepare("INSERT OR IGNORE INTO projects VALUES (?,1,'Extraction','artifact','unused','active')").run(projectId);
  const taskId = randomUUID(), attemptId = randomUUID(), teamId = randomUUID(), seatId = randomUUID();
  raw.prepare(`INSERT INTO tasks (project_id,id,revision,code,title,goal,brief,origin_kind,state,required_capabilities_json,acceptance_json,inputs_json)
    VALUES (?,?,1,?,'Task','Goal','Brief','operator','active','[]','[]','[]')`).run(projectId, taskId,
      `DXT-${String(raw.prepare("SELECT count(*) AS n FROM tasks WHERE project_id=?").get(projectId).n + 1).padStart(3, "0")}`);
  raw.prepare("INSERT OR IGNORE INTO nodes (id,revision,name,platform,trust,state,slots_total,slots_used) VALUES ('local',1,'Local','linux','trusted-workstation','online',2,0)").run();
  raw.prepare("INSERT INTO teams (id,revision,name,charter,pack_key,pack_version,lifecycle) VALUES (?,1,'Team','Charter',NULL,NULL,'active')").run(teamId);
  raw.prepare("INSERT INTO seats VALUES (?,?,1,'Seat','Writer','profile',1,'fake',1,'elastic',NULL,0)").run(seatId, teamId);
  raw.prepare(`INSERT INTO attempts (project_id,id,task_id,revision,epoch,state,outcome,runtime,provider,model,effort,node_id,lease_id,lease_expires_at)
    VALUES (?,?,?,1,1,'running','known','fake','fake','fake','medium','local',?,?)`).run(projectId, attemptId, taskId, randomUUID(), new Date(Date.now() + 600000).toISOString());
  raw.prepare("INSERT INTO attempt_seats VALUES (?,?,?)").run(projectId, attemptId, seatId);
  return { projectId, taskId, attemptId, epoch: 1, expiresAt: Infinity, allowedModels: [], teamId, seatId };
}
