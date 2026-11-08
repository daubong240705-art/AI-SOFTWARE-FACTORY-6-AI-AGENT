import type { Database } from "better-sqlite3";
import type { Task } from "@factory/contracts";
import { listSeats } from "../org/service.js";
import { getSeatCapabilities, getSeatOrder } from "../instructions/snapshot.js";

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

export function engagementAvailable(raw: Database, projectId: string, engagementId: string | null): boolean {
  return raw.prepare(`SELECT e.id FROM engagements e JOIN teams t ON t.id = e.team_id
    WHERE e.project_id = ? AND e.id = ? AND e.state = 'active' AND t.lifecycle = 'active'`)
    .get(projectId, engagementId) !== undefined;
}

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
  const declared = workers.map((seat) => ({ seat, capabilities: getSeatCapabilities(raw, { seatId: seat.id }) }));
  if (declared.some((entry) => entry.capabilities !== null)) {
    const candidates = declared.filter((entry) => capabilities.every((required) =>
      entry.capabilities?.some((value) => value.toLowerCase() === required || value.toLowerCase().startsWith(`${required}.`))));
    if (candidates.length === 0) throw new DispatchCommandError("no-seat-for-capabilities");
    const load = raw.prepare(`SELECT count(*) AS n FROM attempts a
      JOIN attempt_seats s ON s.project_id = a.project_id AND s.attempt_id = a.id
      JOIN seats seat ON seat.id = s.seat_id
      WHERE a.project_id = ? AND seat.team_id = ? AND s.seat_id = ?
      AND a.state IN ('queued', 'leased', 'preparing', 'running', 'waiting-input', 'parked')`);
    // Equal loads follow the pack author's seat order (manifest position): reviewers are listed last, so default work goes to producers first.
    // listSeats' name/id order remains the final tie-break through the stable sort.
    const ranked = candidates.map(({ seat }) => ({ seat, order: getSeatOrder(raw, { seatId: seat.id }) ?? Number.MAX_SAFE_INTEGER,
      load: (load.get(projectId, engagement!.team_id, seat.id) as { n: number }).n }));
    ranked.sort((a, b) => a.load - b.load || a.order - b.order);
    return { seatId: ranked[0]!.seat.id, reason: capabilities.length ? "capability match" : "least loaded" };
  }
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
