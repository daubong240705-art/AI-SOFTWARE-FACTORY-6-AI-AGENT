import { LIVE_ATTEMPT_STATES, type AgentSelector, type Seat } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import { currentAgentConfig, groupIdsForAgent } from "../org/agents.js";
import { listSeats } from "../org/service.js";

export function activeAgents(raw: Database, projectId: string): Seat[] {
  return listSeats(raw).filter((seat) => raw.prepare("SELECT 1 FROM seats WHERE id=? AND project_id=?").get(seat.id, projectId));
}

export function matchesAgent(raw: Database, projectId: string, selector: AgentSelector, seat: Seat): boolean {
  if ("agent" in selector) return seat.id === selector.agent;
  if ("role" in selector) return seat.role.toLowerCase() === selector.role.toLowerCase();
  if ("tags" in selector) return selector.tags.every((tag) => (currentAgentConfig(raw, seat.id)?.config.tags ?? []).includes(tag));
  return groupIdsForAgent(raw, projectId, seat.id).includes(selector.team);
}

export function agentLoad(raw: Database, projectId: string, agentId: string): number {
  const states = [...LIVE_ATTEMPT_STATES];
  return (raw.prepare(`SELECT count(*) AS live FROM attempt_seats s JOIN attempts a ON a.project_id=s.project_id AND a.id=s.attempt_id
    WHERE s.project_id=? AND s.seat_id=? AND a.state IN (${states.map(() => "?").join(",")})`)
    .get(projectId, agentId, ...states) as { live: number }).live;
}

export function chooseAgent(raw: Database, projectId: string, selector: AgentSelector, candidates = activeAgents(raw, projectId)): Seat | undefined {
  return candidates.filter((seat) => matchesAgent(raw, projectId, selector, seat))
    .map((seat) => ({ seat, live: agentLoad(raw, projectId, seat.id) }))
    .sort((first, second) => first.live - second.live || first.seat.name.localeCompare(second.seat.name, "en") || first.seat.id.localeCompare(second.seat.id))[0]?.seat;
}
