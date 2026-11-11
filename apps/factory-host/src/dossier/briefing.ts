import type { Database } from "better-sqlite3";
import { resumeBriefingSchema, type ResumeBriefing } from "@factory/contracts";
import type { ContentStore } from "../artifacts/content-store.js";
import { visibleToScope, type KnowledgeScope } from "../knowledge/permissions.js";
import { buildDossier, dossierDigest, dossierPlain, dossierRisks, newestDossier } from "./build.js";
import { storedDossierDigest } from "./commands.js";

export const BRIEFING_LIMITS = ["Profile/skill diffs are not tracked yet.", "Git HEAD changes are not tracked yet.",
  "Approval and supersession times are counted only when recorded by a command or a replacement version.",
  "Task completion/failure and request opening times are counted only when recorded in retained events or messages."];
export function validSince(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)) && resumeBriefingSchema.shape.baseline.shape.since.safeParse(value).success;
}

export function buildBriefing(raw: Database, input: { projectId: string; since?: string; now: Date | string;
  scope?: KnowledgeScope; store?: ContentStore }): ResumeBriefing {
  const { projectId, scope } = input;
  if (!raw.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId)) throw new Error("Project not found.");
  if (input.since !== undefined && !validSince(input.since)) throw new Error("Invalid since timestamp.");
  const baseline = newestDossier(raw,projectId,scope);
  const first = raw.prepare("SELECT MIN(json_extract(body_json,'$.occurredAt')) AS at FROM event_log WHERE project_id=?").get(projectId) as { at: string | null };
  const since = input.since ?? baseline?.createdAt ?? first.at ?? "1970-01-01T00:00:00.000Z";
  const after = (at: string | null): boolean => at !== null && Date.parse(at) > Date.parse(since);
  const p = scope ? visibleToScope(scope) : { sql: "1", params: [] };
  const versions = raw.prepare(`SELECT v.artifact_id AS artifactId,v.version,v.title,v.status,v.created_at AS at,v.supersedes_version AS supersedes
    FROM artifact_versions v WHERE v.project_id=? AND ${p.sql} ORDER BY v.created_at DESC,v.artifact_id,v.version DESC`)
    .all(projectId,...p.params) as { artifactId: string; version: number; title: string; status: string; at: string; supersedes: number | null }[];
  const visible = new Set(versions.map((row) => `${row.artifactId}@${row.version}`));
  const ids = new Set(versions.map((row) => row.artifactId.toLowerCase()));
  const clean = (value: string): string => dossierPlain(value,ids);
  const summary = (rows: { label: string; at: string }[]): { count: number; examples: string[] } => ({ count: rows.length,
    examples: rows.sort((a,b) => b.at.localeCompare(a.at) || a.label.localeCompare(b.label)).slice(0,10).map((row) => clean(row.label)) });
  const label = (row: typeof versions[number]): string => `${row.title} (${row.artifactId}@${row.version})`;
  const approved = new Map<string,{ label: string; at: string }>();
  const superseded = new Map<string,{ label: string; at: string }>();
  for (const row of versions) if (row.supersedes !== null && after(row.at) && visible.has(`${row.artifactId}@${row.supersedes}`))
    superseded.set(`${row.artifactId}@${row.supersedes}`,{ label: `${row.title} (${row.artifactId}@${row.supersedes})`, at: row.at });
  const decisions = raw.prepare(`SELECT subject,options_json,outcome_option_id,decided_at AS at FROM approvals
    WHERE project_id=? AND kind='question' AND state='applied' ORDER BY decided_at DESC,rowid DESC`).all(projectId) as
    { subject: string; options_json: string; outcome_option_id: string; at: string }[];
  const requests = raw.prepare(`SELECT t.code,t.title,m.closed_at AS closed,
    (SELECT MIN(at) FROM ctr_messages msg WHERE msg.project_id=t.project_id AND msg.task_id=t.id) AS opened
    FROM tasks t JOIN ctr_meta m ON m.project_id=t.project_id AND m.task_id=t.id WHERE t.project_id=? AND t.origin_kind='cross-team'`)
    .all(projectId) as { code: string; title: string; closed: string | null; opened: string | null }[];
  const events = raw.prepare(`SELECT json_extract(body_json,'$.occurredAt') AS at,json_extract(body_json,'$.payload') AS payload
    FROM event_log WHERE project_id=? ORDER BY sequence`).all(projectId) as { at: string; payload: string }[];
  const taskRows = raw.prepare("SELECT id,code,title,state,revision FROM tasks WHERE project_id=?").all(projectId) as
    { id: string; code: string; title: string; state: string; revision: number }[];
  const done = new Map<string,{ label: string; at: string }>();
  const failed = new Map<string,{ label: string; at: string }>();
  for (const event of events) {
    if (!after(event.at)) continue;
    const payload = JSON.parse(event.payload) as { type: string; artifactId?: string; version?: number; taskId?: string; to?: string };
    if (payload.type === "artifact.status-changed") {
      const key = `${payload.artifactId}@${payload.version}`;
      const row = versions.find((row) => row.artifactId === payload.artifactId && row.version === payload.version);
      if (row && visible.has(key) && payload.to === "approved") approved.set(key,{ label: label(row),at: event.at });
      if (row && visible.has(key) && payload.to === "superseded") superseded.set(key,{ label: label(row),at: event.at });
    }
    if (payload.type === "task.status-changed") {
      const row = taskRows.find((row) => row.id === payload.taskId);
      if (row && payload.to === "done") done.set(row.id,{ label: `${row.code}: ${row.title}`,at: event.at });
      if (row && payload.to === "failed") failed.set(row.id,{ label: `${row.code}: ${row.title}`,at: event.at });
    }
  }
  for (const row of raw.prepare(`SELECT a.task_id AS id,t.code,t.title,a.ended_at AS at FROM attempts a
    JOIN tasks t ON t.project_id=a.project_id AND t.id=a.task_id WHERE a.project_id=? AND a.state='failed' AND t.state='failed'
    ORDER BY a.ended_at`).all(projectId) as { id: string; code: string; title: string; at: string }[])
    if (after(row.at)) failed.set(row.id,{ label: `${row.code}: ${row.title}`,at: row.at });
  for (const row of raw.prepare(`SELECT task_id AS id,decided_at AS at FROM approvals WHERE project_id=? AND kind='review'
    AND state='applied' AND outcome_option_id='accept' ORDER BY decided_at`).all(projectId) as { id: string; at: string }[]) {
    const task = taskRows.find((task) => task.id === row.id);
    if (task && after(row.at)) done.set(row.id,{ label: `${task.code}: ${task.title}`,at: row.at });
  }
  // An approval has no dedicated approved_at column. An applied task review provides a real decided_at.
  const reviews = raw.prepare(`SELECT a.decided_at AS at,v.artifact_id AS artifactId,v.version,v.title FROM approvals a
    JOIN attempts attempt ON attempt.project_id=a.project_id AND attempt.task_id=a.task_id
    JOIN artifact_versions v ON v.project_id=attempt.project_id AND v.produced_by_attempt_id=attempt.id
    WHERE a.project_id=? AND a.kind='review' AND a.state='applied' AND a.outcome_option_id='accept'
      AND v.status IN ('approved','superseded') AND v.created_at<=a.decided_at AND ${p.sql}`).all(projectId,...p.params) as { at: string; artifactId: string; version: number; title: string }[];
  for (const row of reviews) if (after(row.at)) approved.set(`${row.artifactId}@${row.version}`,{ label: `${row.title} (${row.artifactId}@${row.version})`, at: row.at });
  const now = new Date(input.now).getTime();
  const stale = dossierRisks(raw,projectId,scope);
  const awaitingReview = versions.filter((row) => ["in-review","reviewed"].includes(row.status) && now-Date.parse(row.at)>3*86400000)
    .sort((a,b) => a.at.localeCompare(b.at) || a.artifactId.localeCompare(b.artifactId) || a.version-b.version).slice(0,20)
    .map((row) => ({ ref: { artifactId: row.artifactId, version: row.version }, title: clean(row.title), ageDays: Math.floor((now-Date.parse(row.at))/86400000) }));
  const teams = raw.prepare(`SELECT t.name AS teamName,t.pack_key AS packKey,t.pack_version AS packVersion,e.state AS engagementState
    FROM engagements e JOIN teams t ON t.id=e.team_id WHERE e.project_id=? ORDER BY t.name,e.id LIMIT 100`).all(projectId) as ResumeBriefing["teams"];
  const suggestions: string[] = [];
  if (stale.length) suggestions.push(`Refresh ${stale.length} stale artifacts through a research request`);
  const go = taskRows.filter((row) => row.state === "awaiting-go").length;
  if (go) suggestions.push(`${go} tasks wait for your Go`);
  if (baseline && baseline.status !== "approved") suggestions.push("Approve the Dossier after reviewing it");
  if (!baseline) suggestions.push("Create the Project Dossier with dossier.refresh");
  else if ((!scope || versions.length === (raw.prepare("SELECT COUNT(*) AS n FROM artifact_versions WHERE project_id=?").get(projectId) as { n: number }).n)
    && input.store && storedDossierDigest(input.store.get(baseline.contentHash)?.toString("utf8") ?? "") !== dossierDigest(buildDossier(raw,{ projectId, now: input.now })))
    suggestions.push(`Refresh the Dossier: the project changed since version ${baseline.version}`);
  if (awaitingReview.length) suggestions.push(`Review ${awaitingReview.length} artifacts waiting longer than 3 days`);
  return resumeBriefingSchema.parse({ baseline: { since, dossierRef: baseline ? { artifactId: baseline.artifactId, version: baseline.version } : null },
    changes: { artifactsRegistered: summary(versions.filter((row) => after(row.at)).map((row) => ({ label: label(row), at: row.at }))),
      artifactsSuperseded: summary([...superseded.values()]), artifactsApproved: summary([...approved.values()]),
      decisionsApplied: summary(decisions.filter((row) => after(row.at)).map((row) => ({ at: row.at, label: `${row.subject}: ${(JSON.parse(row.options_json) as { id: string; label: string }[]).find((o) => o.id === row.outcome_option_id)?.label ?? "Decision recorded"}` }))),
      requestsOpened: summary(requests.filter((row) => after(row.opened)).map((row) => ({ label: `${row.code}: ${row.title}`, at: row.opened! }))),
      requestsClosed: summary(requests.filter((row) => after(row.closed)).map((row) => ({ label: `${row.code}: ${row.title}`, at: row.closed! }))),
      tasksDone: summary([...done.values()]), tasksFailed: summary([...failed.values()]) },
    freshness: { stale, awaitingReview, unapprovedDossier: baseline !== undefined && baseline.status !== "approved" },
    teams: teams.map((row) => ({ ...row, teamName: clean(row.teamName), packKey: row.packKey === null ? null : clean(row.packKey), packVersion: row.packVersion === null ? null : clean(row.packVersion) })),
    suggestions: suggestions.slice(0,8), limits: BRIEFING_LIMITS });
}
