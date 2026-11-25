import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import { LIVE_ATTEMPT_STATES } from "@factory/contracts";
import { currentAgentConfig, getAgent, writeAgentRevision } from "./agents.js";
import { packManifestSchema, type LoadedPack } from "./pack.js";
import { agentsFromPack, type RosterDeps } from "./roster.js";
import { getSeatRuntimeConfig } from "./runtime-config.js";
import { getPrimaryEngagement } from "./service.js";

export interface RosterMigrationReport {
  projectId: string;
  status: "migrated" | "already" | "busy" | "no-team" | "failed";
  detail?: string;
  agents?: number;
}

const openTask = "state NOT IN ('done','failed','cancelled','declined','superseded')";

/**
 * Pinned snapshots were written by older Hosts. Keys a later version removed (e.g. the game module's `leadWorkflow`) are
 * dropped instead of failing the migration; anything else that does not match still fails.
 */
export function parsePinnedManifest(value: unknown): ReturnType<typeof packManifestSchema.parse> {
  let candidate = structuredClone(value);
  for (let round = 0; round < 8; round += 1) {
    const parsed = packManifestSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
    const unknown = parsed.error.issues.filter((issue) => issue.code === "unrecognized_keys");
    if (!unknown.length || unknown.length !== parsed.error.issues.length) throw parsed.error;
    for (const issue of unknown) {
      const target = issue.path.reduce<unknown>((node, key) => (node as Record<string | number, unknown> | undefined)?.[key as string], candidate);
      if (target !== null && typeof target === "object") for (const key of (issue as { keys: string[] }).keys) delete (target as Record<string, unknown>)[key];
    }
  }
  return packManifestSchema.parse(candidate);
}

interface SourceTeam { team_id: string; name: string; pack_key: string | null; pack_version: string | null; pack_digest: string | null }

function loadedPack(raw: Database, team: SourceTeam): { pack: LoadedPack; detail?: string } {
  if (team.pack_digest !== null) {
    const snapshot = raw.prepare("SELECT manifest_json FROM pack_snapshots WHERE digest = ?").get(team.pack_digest) as
      { manifest_json: string } | undefined;
    if (snapshot) {
      const manifest = parsePinnedManifest(JSON.parse(snapshot.manifest_json) as unknown);
      const files = raw.prepare("SELECT path, kind, name, description, content FROM pack_files WHERE digest = ?")
        .all(team.pack_digest) as { path: string; kind: string; name: string | null; description: string | null; content: string }[];
      const skills = new Map(files.filter((file) => file.kind === "skill").map((file) => [file.path, file]));
      return { pack: { manifest, digest: team.pack_digest, dir: "", files: {
        profiles: files.filter((file) => file.kind === "profile").map((file) => ({ path: file.path, content: file.content })),
        skills: manifest.skills.map((directory) => {
          const path = `${directory.replaceAll("\\", "/")}/SKILL.md`;
          const file = skills.get(path);
          if (!file?.name) throw new Error("Pinned pack skill unavailable");
          return { path, name: file.name, description: file.description ?? "", content: file.content };
        }), workflows: [],
      } } };
    }
  }
  const seats = raw.prepare("SELECT id, name, role, runtime, slots, is_lead FROM seats WHERE team_id = ? ORDER BY id")
    .all(team.team_id) as { id: string; name: string; role: string; runtime: LoadedPack["manifest"]["seats"][number]["runtime"]; slots: number; is_lead: number }[];
  if (!seats.length) throw new Error("Legacy team has no seats");
  const profiles = seats.map((seat) => ({ path: `legacy-${seat.id}.md`, content: "" }));
  const manifest: LoadedPack["manifest"] = { key: team.pack_key ?? "legacy-team", version: team.pack_version ?? "0.0.0",
    name: team.name, description: `Migrated from team ${team.name}`, seats: seats.map((seat, index) => ({ name: seat.name,
      role: seat.role, profile: profiles[index]!.path, runtime: seat.runtime, slots: seat.slots, isLead: seat.is_lead === 1 })),
    skills: [], workflows: [] };
  const digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  return { detail: `team ${team.team_id} had no pinned pack snapshot; seat rows were used`, pack: { manifest, digest, dir: "",
    files: { profiles, skills: [], workflows: [] } } };
}

function migrateProject(raw: Database, projectId: string, deps: RosterDeps): { agents: number; detail?: string } {
  const engagements = raw.prepare(`SELECT e.id, e.team_id, t.name, t.pack_key, t.pack_version, t.pack_digest
    FROM engagements e JOIN teams t ON t.id = e.team_id WHERE e.project_id = ? AND e.state IN ('active','paused') AND t.kind <> 'roster'
    ORDER BY (e.id = ?) DESC, e.created_at, e.id`).all(projectId, getPrimaryEngagement(raw, projectId)?.id ?? "") as (SourceTeam & { id: string })[];
  const primary = engagements[0];
  if (!primary) throw new Error("Legacy team engagement unavailable");
  const seatMap = new Map<string, string>();
  let rosterId: string | undefined;
  const details: string[] = [];
  let count = 0;
  for (const engagement of engagements) {
    const { pack, detail } = loadedPack(raw, engagement);
    if (detail) details.push(detail);
    const result = agentsFromPack(raw, { projectId, pack, actorId: "operator", groupName: engagement.name }, deps);
    count += result.created;
    rosterId = result.rosterId;
    const oldSeats = raw.prepare("SELECT id, name FROM seats WHERE team_id = ?").all(engagement.team_id) as { id: string; name: string }[];
    for (const oldSeat of oldSeats) {
      const newAgentId = result.agentIds.get(oldSeat.name);
      if (!newAgentId) continue;
      if (!seatMap.has(oldSeat.id)) seatMap.set(oldSeat.id, newAgentId);
      const runtime = getSeatRuntimeConfig(raw, oldSeat.id);
      if (runtime) {
        const agent = getAgent(raw, projectId, newAgentId);
        const current = currentAgentConfig(raw, newAgentId);
        if (!agent || !current) throw new Error("New agent configuration unavailable");
        const { config } = current;
        config.runtime = { ...config.runtime, adapter: runtime.runtime === "native-opencode" ? "opencode"
          : runtime.cli === "claude" ? "claude-code" : "codex",
          model: runtime.model, effort: runtime.effort, permission: runtime.permission };
        writeAgentRevision(raw, { agentId: newAgentId, projectId, existing: agent, config,
          actorId: "operator", note: "runtime settings carried over", clock: deps.clock });
      }
    }
  }
  if (!rosterId) throw new Error("Roster unavailable after migration");
  if (primary.pack_key === null)
    raw.prepare("UPDATE teams SET pack_key = NULL, pack_version = NULL, pack_digest = NULL WHERE id = ?").run(rosterId);
  const activeRosterEngagements = raw.prepare<[string, string], { id: string }>(`SELECT id FROM engagements
    WHERE project_id = ? AND team_id = ? AND state = 'active'`);
  const rosterEngagement = activeRosterEngagements.get(projectId, rosterId);
  if (!rosterEngagement) throw new Error("Active roster engagement unavailable");
  const owner = raw.prepare(`UPDATE tasks SET owner_seat_id = ? WHERE project_id = ? AND owner_seat_id = ? AND ${openTask}`);
  const conversation = raw.prepare("UPDATE conversations SET seat_id = ? WHERE project_id = ? AND seat_id = ?");
  for (const [oldSeat, newAgent] of seatMap) {
    owner.run(newAgent, projectId, oldSeat);
    conversation.run(newAgent, projectId, oldSeat);
  }
  raw.prepare(`UPDATE tasks SET engagement_id = ? WHERE project_id = ? AND ${openTask}`).run(rosterEngagement.id, projectId);
  const retargetRequest = raw.prepare(`UPDATE ctr_meta SET target_team_id = ? WHERE project_id = ? AND target_team_id = ?
    AND task_id IN (SELECT id FROM tasks WHERE project_id = ? AND ${openTask})`);
  const end = raw.prepare("UPDATE engagements SET state = 'ended', revision = revision + 1 WHERE project_id = ? AND id = ?");
  for (const engagement of engagements) {
    retargetRequest.run(rosterId, projectId, engagement.team_id, projectId);
    end.run(projectId, engagement.id);
  }
  const liveOwner = raw.prepare(`SELECT t.owner_seat_id FROM tasks t LEFT JOIN seats s ON s.id = t.owner_seat_id
    WHERE t.project_id = ? AND t.${openTask}
    AND t.owner_seat_id IS NOT NULL AND (s.project_id IS NOT ? OR s.config_revision IS NULL) LIMIT 1`).get(projectId, projectId);
  if (liveOwner) throw new Error("Non-terminal task owner is not a project agent");
  if (activeRosterEngagements.all(projectId, rosterId).length !== 1)
    throw new Error("Project does not have exactly one active roster engagement");
  return { agents: count, ...(details.length ? { detail: details.join("; ") } : {}) };
}

export function migrateProjectsToRosters(raw: Database, deps: RosterDeps & { backup?: () => void }): RosterMigrationReport[] {
  const projects = raw.prepare("SELECT id FROM projects WHERE disposition <> 'archived' ORDER BY id").all() as { id: string }[];
  const reports: RosterMigrationReport[] = [];
  const candidates: string[] = [];
  const live = [...LIVE_ATTEMPT_STATES];
  for (const project of projects) {
    const agents = raw.prepare("SELECT 1 FROM seats WHERE project_id = ? AND config_revision IS NOT NULL LIMIT 1").get(project.id);
    if (agents) { reports.push({ projectId: project.id, status: "already" }); continue; }
    if (raw.prepare(`SELECT 1 FROM attempts WHERE project_id = ? AND state IN (${live.map(() => "?").join(",")}) LIMIT 1`)
      .get(project.id, ...live)) { reports.push({ projectId: project.id, status: "busy" }); continue; }
    if (!raw.prepare(`SELECT 1 FROM engagements e JOIN teams t ON t.id = e.team_id
      WHERE e.project_id = ? AND e.state IN ('active','paused') AND t.kind <> 'roster' LIMIT 1`).get(project.id)) {
      reports.push({ projectId: project.id, status: "no-team" }); continue;
    }
    candidates.push(project.id);
  }
  let backupFailure: string | undefined;
  if (candidates.length && deps.backup) {
    try { deps.backup(); }
    catch (error) { backupFailure = error instanceof Error ? error.message : "Migration backup failed"; }
  }
  for (const projectId of candidates) {
    if (backupFailure !== undefined) { reports.push({ projectId, status: "failed", detail: backupFailure }); continue; }
    try {
      const result = raw.transaction(() => migrateProject(raw, projectId, deps)).immediate();
      reports.push({ projectId, status: "migrated", ...result });
    } catch (error) { reports.push({ projectId, status: "failed", detail: error instanceof Error ? error.message : "Roster migration failed" }); }
  }
  return reports.sort((a, b) => a.projectId.localeCompare(b.projectId));
}
