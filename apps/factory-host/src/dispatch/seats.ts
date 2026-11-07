import type { Database } from "better-sqlite3";
import type { Task } from "@factory/contracts";
import { listSeats } from "../org/service.js";

export class DispatchCommandError extends Error {
  constructor(readonly code: string) { super(code); this.name = "DispatchCommandError"; }
}

const rules = [
  { name: "Test", prefixes: ["test."], words: ["test"] },
  { name: "FE", prefixes: ["ui.", "frontend.", "web."], words: ["ui", "frontend", "css", "react"] },
  { name: "DevOps", prefixes: ["ops.", "infra.", "deploy."], words: ["docker", "deploy", "ci"] },
  { name: "BA", prefixes: ["docs.", "spec.", "requirements."], words: ["readme", "document"] },
  { name: "PM", prefixes: ["plan.", "product."], words: [] },
];

export function pickSeat(raw: Database, projectId: string, task: Task): { seatId: string; reason: string } {
  if (task.ownerSeatId !== null) return { seatId: task.ownerSeatId, reason: "explicit owner" };
  const engagement = raw.prepare("SELECT team_id FROM engagements WHERE project_id = ? AND id = ?")
    .get(projectId, task.engagementId) as { team_id: string } | undefined;
  const seats = engagement ? listSeats(raw, engagement.team_id) : [];
  const workers = seats.filter((seat) => !seat.isLead);
  if (workers.length === 0) {
    const lead = seats.find((seat) => seat.isLead);
    if (!lead) throw new DispatchCommandError("no-seat");
    return { seatId: lead.id, reason: "lead only team" };
  }
  const capabilities = task.requiredCapabilities.map((value) => value.toLowerCase());
  const words = new Set([task.title.toLowerCase(), ...capabilities].join(" ").split(/[^a-z0-9]+/));
  const rule = rules.find((entry) => capabilities.some((value) => entry.prefixes.some((prefix) => value.startsWith(prefix)))
    || entry.words.some((word) => words.has(word)));
  const name = rule?.name ?? "BE";
  const seat = workers.find((entry) => entry.name === name);
  // listSeats orders non-lead seats by name, then id.
  const fallback = workers[0]!;
  return seat ? { seatId: seat.id, reason: `${name} keyword rule` }
    : { seatId: fallback.id, reason: `${name} keyword rule; first non-lead fallback` };
}
