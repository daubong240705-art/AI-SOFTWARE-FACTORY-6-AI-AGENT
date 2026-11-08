import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { openStorage } from "../dist/storage/database.js";
import { EventHub } from "../dist/events/hub.js";
import { createCommandPipeline } from "../dist/commands/pipeline.js";
import { createProjectsCreateHandler } from "../dist/projects/service.js";
import { createOrgHandlers, loadPack, registryEntry, getPrimaryEngagement, listSeats } from "../dist/org/index.js";
import { tasksCreateHandler, getTask } from "../dist/work/service.js";
import { conversationsCreateHandler, chatSendHandler } from "../dist/chat/index.js";
import { createDispatcher, createDispatchHandlers, createFakeRuntime, RuntimeRegistry, moveTask, getAttempt } from "../dist/dispatch/index.js";

export const pack = loadPack(fileURLToPath(new URL("../../../packs/software-team/", import.meta.url)));
export const otherPack = { ...pack, manifest: { ...pack.manifest, key: "specialist-team", name: "Specialists" } };
export const packs = [registryEntry(pack, true), registryEntry(otherPack)];
export const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
export const pumped = async () => { for (let i = 0; i < 3; i++) { await new Promise(setImmediate); for (let j = 0; j < 25; j++) await Promise.resolve(); } };

export function temp(t, beforeRemove = async () => {}) {
  const parent = fileURLToPath(new URL("./", import.meta.url));
  const dir = mkdtempSync(join(parent, ".org-fixture-"));
  t.after(async () => {
    await beforeRemove();
    assert.ok(resolve(dir).startsWith(resolve(parent) + sep + ".org-fixture-"));
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
export function writePack(root, key = "example-team", change = () => {}) {
  const dir = join(root, key); mkdirSync(dir, { recursive: true });
  const manifest = { key, version: "1.0.0", name: "Example Team", description: "Example charter",
    seats: [{ name: "Lead", role: "Lead", profile: "lead.md", runtime: "fake", slots: 1, isLead: true },
      { name: "BE", role: "Builder", profile: "worker.md", runtime: "fake", slots: 2, isLead: false }], skills: [] };
  change(manifest);
  writeFileSync(join(dir, "pack.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "lead.md"), "Synthetic Lead profile");
  writeFileSync(join(dir, "worker.md"), "Synthetic worker profile");
  return dir;
}

export function fixture(t, options = {}) {
  const storage = openStorage(":memory:"); storage.migrate({ migrationsDir, backupDir: null });
  const raw = storage.raw; const clock = () => new Date("2026-11-08T00:00:00.000Z");
  const hub = new EventHub(raw, { clock }); const errors = [];
  const runtime = createFakeRuntime({ stepMs: 0 });
  const dispatcher = createDispatcher({ storage, hub, clock, multiTeam: options.multiTeam ?? true,
    registry: new RuntimeRegistry([runtime]), config: { nodeSlots: options.nodeSlots ?? 16 },
    onError: (error) => errors.push(error) });
  const pipeline = createCommandPipeline({ storage, hub, clock, handlers: {
    "projects.create": createProjectsCreateHandler({ pack, multiTeam: options.multiTeam ?? true }), "tasks.create": tasksCreateHandler,
    "conversations.create": conversationsCreateHandler, "chat.send": chatSendHandler,
    ...createOrgHandlers({ packs, multiTeam: options.multiTeam ?? true }), ...createDispatchHandlers({ dispatcher }),
  } });
  const cleanups = [];
  t.after(async () => { for (const cleanup of cleanups) await cleanup(); await dispatcher.stop(); storage.close(); assert.deepEqual(errors, []); });
  const execute = (type, payload, scope = projectId) => pipeline.execute({ apiVersion: 1, commandId: randomUUID(), projectId: scope, type, payload });
  const ok = (type, payload, scope) => { const result = execute(type, payload, scope); assert.equal(result.status, 200, JSON.stringify(result.body)); return result; };
  let projectId;
  const project = () => { const id = randomUUID(); ok("projects.create", { name: "Project", workspace: { kind: "directory", root: `/workspace/${id}` } }, id); return id; };
  projectId = project(); const primary = getPrimaryEngagement(raw, projectId); const teamId = primary.teamId;
  const seats = listSeats(raw, teamId); const seat = seats.find((s) => s.name === "BE");
  let code = 0;
  const task = ({ scope = projectId, engagementId = null, seatId = null, state = "active", goal = "[fake:hang]", requiresGo = true, ...rest } = {}) => {
    const id = randomUUID(); ok("tasks.create", { taskId: id, code: `ORG-${String(++code).padStart(3, "0")}`, title: "Build", goal,
      brief: "Brief", parentTaskId: null, engagementId, ownerSeatId: seatId, requiredCapabilities: [], acceptance: [], inputs: [], dependsOn: [],
      placement: "portable", sideEffect: "none", requiresGo, ...rest }, scope);
    if (state === "active") for (const next of ["accepted", "ready", "active"]) moveTask(raw, scope, id, next);
    else raw.prepare("UPDATE tasks SET state = ? WHERE project_id = ? AND id = ?").run(state, scope, id);
    return id;
  };
  const secondTeam = () => { const id = randomUUID(); ok("teams.create-from-pack", { teamId: id, packKey: otherPack.manifest.key, packVersion: otherPack.manifest.version }); return id; };
  const engage = (team, scope = projectId, priority = 80, maxConcurrent = 2) => {
    const id = randomUUID(); ok("engagements.create", { engagementId: id, teamId: team, priority, maxConcurrent }, scope); return id;
  };
  const enqueue = (id = task(), scope = projectId, seatId = seat.id) => dispatcher.enqueue({ projectId: scope, taskId: id, seatId });
  const updateEngagement = (id, patch, scope = projectId) => ok("engagements.update", { engagementId: id,
    expectedRevision: raw.prepare("SELECT revision FROM engagements WHERE project_id = ? AND id = ?").get(scope, id).revision, ...patch }, scope);
  const lifecycle = (state, id = teamId) => ok("teams.set-lifecycle", { teamId: id,
    expectedRevision: raw.prepare("SELECT revision FROM teams WHERE id = ?").get(id).revision, lifecycle: state });
  const slots = (count, id = seat.id) => ok("seats.update", { seatId: id,
    expectedRevision: raw.prepare("SELECT revision FROM seats WHERE id = ?").get(id).revision, slots: count });
  dispatcher.start();
  return { storage, raw, clock, hub, pipeline, dispatcher, runtime, execute, ok, projectId, project, primary, teamId, seats, seat,
    cleanup: (fn) => cleanups.push(fn),
    task, secondTeam, engage, enqueue, updateEngagement, lifecycle, slots, read: (a) => getAttempt(raw, a.projectId, a.id),
    getTask: (id, scope = projectId) => getTask(raw, scope, id) };
}
