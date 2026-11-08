import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import { engagementSchema, seatSchema, teamSchema, type Engagement, type Seat, type Team } from "@factory/contracts";
import type { Clock } from "../ids.js";
import type { LoadedPack } from "./pack.js";
import { capturePackSnapshot } from "../instructions/snapshot.js";

type Deps = { newId: () => string; clock: Clock; teamId?: string };
interface TeamRow { id: string; revision: number; name: string; charter: string; pack_key: string | null; pack_version: string | null; lifecycle: string }
interface SeatRow {
  id: string; team_id: string; revision: number; name: string; role: string; profile_id: string;
  profile_revision: number; runtime: string; slots: number; node_policy: string; dedicated_node_id: string | null; is_lead: number;
}
interface EngagementRow {
  id: string; project_id: string; team_id: string; revision: number; priority: number; max_concurrent: number; state: string; created_at: string;
}
const seatFromRow = (row: SeatRow): Seat => seatSchema.parse({
  id: row.id, teamId: row.team_id, revision: row.revision, name: row.name, role: row.role,
  profile: { id: row.profile_id, revision: row.profile_revision }, runtime: row.runtime, slots: row.slots,
  nodePolicy: row.node_policy, dedicatedNodeId: row.dedicated_node_id, isLead: row.is_lead === 1,
});

export function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function listSeats(raw: Database, teamId: string): Seat[] {
  return (raw.prepare("SELECT * FROM seats WHERE team_id = ? ORDER BY is_lead DESC, name, id").all(teamId) as SeatRow[]).map(seatFromRow);
}

export function ensureTeamFromPack(raw: Database, pack: LoadedPack, deps: Deps): { teamId: string; created: boolean; seatIds: string[] } {
  return raw.transaction(() => {
    const { manifest } = pack;
    const existing = raw.prepare("SELECT id FROM teams WHERE pack_key = ? AND pack_version = ? ORDER BY id LIMIT 1")
      .get(manifest.key, manifest.version) as { id: string } | undefined;
    if (existing) return { teamId: existing.id, created: false, seatIds: listSeats(raw, existing.id).map((seat) => seat.id) };
    const teamId = deps.teamId ?? deps.newId();
    const digest = capturePackSnapshot(raw, pack, deps.clock());
    raw.prepare("INSERT INTO teams (id, revision, name, charter, pack_key, pack_version, lifecycle, pack_digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(teamId, 1, manifest.name, manifest.description, manifest.key, manifest.version, "active", digest);
    for (const seat of manifest.seats) raw.prepare(`INSERT INTO seats
      (id, team_id, revision, name, role, profile_id, profile_revision, runtime, slots, node_policy, dedicated_node_id, is_lead)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(deps.newId(), teamId, 1, seat.name, seat.role, deterministicUuid(`${manifest.key}:${seat.profile}`), 1,
        seat.runtime, seat.slots, "elastic", null, Number(seat.isLead));
    return { teamId, created: true, seatIds: listSeats(raw, teamId).map((seat) => seat.id) };
  }).immediate();
}

export function ensureEngagement(raw: Database, input: { projectId: string; teamId: string }, deps: Deps): { engagementId: string; created: boolean } {
  return raw.transaction(() => {
    const existing = raw.prepare("SELECT id FROM engagements WHERE project_id = ? AND team_id = ? AND state = ?")
      .get(input.projectId, input.teamId, "active") as { id: string } | undefined;
    if (existing) return { engagementId: existing.id, created: false };
    const engagementId = deps.newId();
    raw.prepare(`INSERT INTO engagements (project_id, id, team_id, revision, priority, max_concurrent, state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.projectId, engagementId, input.teamId, 1, 50, 2, "active", deps.clock().toISOString());
    return { engagementId, created: true };
  }).immediate();
}

export function findLeadSeat(raw: Database, teamId: string): Seat | undefined {
  const row = raw.prepare("SELECT * FROM seats WHERE team_id = ? AND is_lead = ?").get(teamId, 1) as SeatRow | undefined;
  return row === undefined ? undefined : seatFromRow(row);
}

export function getActiveEngagement(raw: Database, projectId: string): Engagement | undefined {
  const row = raw.prepare("SELECT * FROM engagements WHERE project_id = ? AND state = ? ORDER BY priority DESC, id LIMIT 1")
    .get(projectId, "active") as EngagementRow | undefined;
  return row === undefined ? undefined : engagementSchema.parse({
    id: row.id, projectId: row.project_id, teamId: row.team_id, revision: row.revision,
    priority: row.priority, maxConcurrent: row.max_concurrent, state: row.state, createdAt: row.created_at,
  });
}

/** The earliest active engagement owns the project's Lead; priority only controls dispatch. */
export function getPrimaryEngagement(raw: Database, projectId: string): Engagement | undefined {
  const row = raw.prepare("SELECT * FROM engagements WHERE project_id = ? AND state = ? ORDER BY created_at, id LIMIT 1")
    .get(projectId, "active") as EngagementRow | undefined;
  return row === undefined ? undefined : engagementSchema.parse({
    id: row.id, projectId: row.project_id, teamId: row.team_id, revision: row.revision,
    priority: row.priority, maxConcurrent: row.max_concurrent, state: row.state, createdAt: row.created_at,
  });
}

export function getTeam(raw: Database, teamId: string): Team | undefined {
  const row = raw.prepare("SELECT * FROM teams WHERE id = ?").get(teamId) as TeamRow | undefined;
  return row === undefined ? undefined : teamSchema.parse({
    id: row.id, revision: row.revision, name: row.name, charter: row.charter,
    pack: row.pack_key === null ? null : { key: row.pack_key, version: row.pack_version }, lifecycle: row.lifecycle,
  });
}
