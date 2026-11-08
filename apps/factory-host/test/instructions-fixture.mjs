import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, temp, writePack } from "./org-fixture.mjs";
import { loadPack } from "../dist/org/pack.js";
import { ensureTeamFromPack, listSeats } from "../dist/org/service.js";

export function diskPack(t, options = {}) {
  const root = temp(t);
  const dir = writePack(root, options.key ?? "instruction-team", manifest => {
    manifest.version = options.version ?? "1.0.0";
    manifest.skills = (options.skills ?? ["verify"]).map(name => `skills/${name}`);
  });
  writeFileSync(join(dir, "worker.md"), options.profile ?? "Pinned worker profile");
  for (const name of options.skills ?? ["verify"]) {
    mkdirSync(join(dir, "skills", name), { recursive: true });
    writeFileSync(join(dir, "skills", name, "SKILL.md"), options.content ?? "---\nname: verify\ndescription: Verify the deliverable.\n---\nPinned skill text");
  }
  return { dir, load: () => loadPack(dir) };
}

export function instructionsFixture(t, options = {}) {
  const f = fixture(t, options);
  const disk = diskPack(t, options);
  const pack = disk.load();
  const create = (selected = pack) => ensureTeamFromPack(f.raw, selected, { clock: f.clock, newId: randomUUID });
  const team = create();
  const seat = listSeats(f.raw, team.teamId).find(row => row.name === "BE");
  const engagement = f.engage(team.teamId);
  const taskId = f.task({ seatId: seat.id, engagementId: engagement, goal: "Deliver pinned instructions", acceptance: ["Verify output"] });
  const enqueue = () => f.enqueue(taskId, f.projectId, seat.id);
  return { ...f, disk, pack, team, instructionSeat: seat, taskId, create, enqueueInstructions: enqueue };
}
