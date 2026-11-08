import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import { dossierSchema, taskStateSchema, type ArtifactRef, type ProjectDossier } from "@factory/contracts";
import { sanitizeAgentText } from "../mcp/security.js";
import { publicApprovalText } from "../approvals/service.js";
import { visibleToScope, type KnowledgeScope } from "../knowledge/permissions.js";

/** Keep declared artifact references, but no private identities or structured text in prose. */
export function dossierPlain(value: string, artifactIds: ReadonlySet<string> = new Set()): string {
  return sanitizeAgentText(publicApprovalText(value))
    .replace(/\bBearer\s+\S+|\b(?:token|api[_-]?key|password|secret)\s*[:=]\s*\S+/gi, " ")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      (id) => artifactIds.has(id.toLowerCase()) ? id : " ")
    .replace(/\{[^}]*\}|\[[^\]]*\]/g, " ").replace(/[{}\[\]<>`]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 400);
}

export interface DossierVersion {
  artifactId: string; version: number; status: string; createdAt: string; contentHash: string;
}
export function newestDossier(raw: Database, projectId: string, scope?: KnowledgeScope): DossierVersion | undefined {
  const p = scope ? visibleToScope(scope) : { sql: "1", params: [] };
  return raw.prepare(`SELECT v.artifact_id AS artifactId,v.version,v.status,v.created_at AS createdAt,v.content_hash AS contentHash
    FROM artifact_versions v WHERE v.project_id = ? AND v.kind = 'dossier' AND ${p.sql}
    ORDER BY v.created_at DESC,v.version DESC,v.artifact_id LIMIT 1`).get(projectId, ...p.params) as DossierVersion | undefined;
}

export function dossierRisks(raw: Database, projectId: string, scope?: KnowledgeScope): ProjectDossier["risks"] {
  const p = scope ? visibleToScope(scope) : { sql: "1", params: [] };
  const newer = scope ? visibleToScope(scope, "newer") : { sql: "1", params: [] };
  const rows = raw.prepare(`SELECT v.artifact_id AS artifactId,v.version,v.title,
      s.because_artifact_id AS source,s.because_version AS sourceVersion
    FROM knowledge_stale s JOIN artifact_versions v ON v.project_id=s.project_id AND v.artifact_id=s.artifact_id AND v.version=s.version
    WHERE s.project_id=? AND ${p.sql}
    UNION ALL
    SELECT v.artifact_id,v.version,v.title,v.artifact_id,MAX(newer.version)
    FROM artifact_versions v JOIN artifact_versions newer ON newer.project_id=v.project_id AND newer.artifact_id=v.artifact_id
      AND newer.version>v.version AND newer.status IN ('draft','in-review','reviewed')
    WHERE v.project_id=? AND v.status='approved' AND ${p.sql} AND ${newer.sql}
    GROUP BY v.artifact_id,v.version
    ORDER BY 1,2,4,5 LIMIT 20`)
    .all(projectId,...p.params,projectId,...p.params,...newer.params) as {
      artifactId: string; version: number; title: string; source: string; sourceVersion: number;
    }[];
  return rows.map((row) => ({ ref: { artifactId: row.artifactId, version: row.version }, title: dossierPlain(row.title),
    // A cause can itself be private; never expose that identity without checking the same policy.
    because: raw.prepare(`SELECT 1 FROM artifact_versions v WHERE v.project_id=? AND v.artifact_id=? AND v.version=? AND ${p.sql}`)
      .get(projectId,row.source,row.sourceVersion,...p.params)
      ? `Superseded input or newer draft: ${row.source}@${row.sourceVersion}` : "A dependency changed; refresh this artifact" }));
}

export function buildDossier(raw: Database, input: { projectId: string; now: Date | string }): ProjectDossier {
  const { projectId } = input;
  const project = raw.prepare("SELECT name,workspace_kind AS workspaceKind FROM projects WHERE id=?").get(projectId) as
    { name: string; workspaceKind: "git" | "directory" | "artifact" } | undefined;
  if (!project) throw new Error("Project not found.");
  const ids = new Set((raw.prepare("SELECT DISTINCT artifact_id AS id FROM artifact_versions WHERE project_id=?").all(projectId) as { id: string }[])
    .map((row) => row.id.toLowerCase()));
  const clean = (text: string): string => dossierPlain(text, ids);
  const approved = raw.prepare(`SELECT v.artifact_id AS artifactId,v.version,v.kind,v.title,v.abstract_l0 AS l0,v.created_at AS createdAt
    FROM artifact_versions v WHERE v.project_id=? AND v.status='approved' AND NOT EXISTS (
      SELECT 1 FROM artifact_versions newer WHERE newer.project_id=v.project_id AND newer.artifact_id=v.artifact_id
        AND newer.status='approved' AND newer.version>v.version) ORDER BY (v.kind='dossier'),v.kind,v.artifact_id,v.version DESC`)
    .all(projectId) as { artifactId: string; version: number; kind: ProjectDossier["canonical"][number]["kind"]; title: string; l0: string; createdAt: string }[];
  const ref = (row: { artifactId: string; version: number }): ArtifactRef => ({ artifactId: row.artifactId, version: row.version });
  const tasks = Object.fromEntries(taskStateSchema.options.map((state) => [state, 0])) as ProjectDossier["stage"]["tasks"];
  for (const row of raw.prepare("SELECT state,COUNT(*) AS n FROM tasks WHERE project_id=? GROUP BY state").all(projectId) as { state: keyof typeof tasks; n: number }[])
    tasks[row.state] = row.n;
  const canonical: ProjectDossier["canonical"] = [];
  for (const row of approved.slice(0,30)) {
    let group = canonical.find((item) => item.kind === row.kind);
    if (!group) { group = { kind: row.kind, items: [] }; canonical.push(group); }
    group.items.push({ ref: ref(row), title: clean(row.title), l0: clean(row.l0) });
  }
  const decisions = raw.prepare(`SELECT subject,options_json,outcome_option_id FROM approvals WHERE project_id=? AND kind='question'
    AND state='applied' ORDER BY decided_at DESC,rowid DESC LIMIT 20`).all(projectId) as { subject: string; options_json: string; outcome_option_id: string }[];
  const questions = raw.prepare(`SELECT subject,summary FROM approvals WHERE project_id=? AND kind='question' AND state='pending'
    ORDER BY requested_at DESC,rowid DESC LIMIT 10`).all(projectId) as { subject: string; summary: string }[];
  const requests = raw.prepare(`SELECT t.code,t.request_kind AS kind,t.title AS subject,t.state,m.triage_state AS triageState,
    team.name AS targetTeamName,(SELECT COUNT(*) FROM ctr_waits w WHERE w.project_id=t.project_id AND w.ctr_task_id=t.id AND w.resolved_at IS NULL) AS waitingCount
    FROM tasks t JOIN ctr_meta m ON m.project_id=t.project_id AND m.task_id=t.id JOIN teams team ON team.id=m.target_team_id
    WHERE t.project_id=? AND t.origin_kind='cross-team' AND t.state NOT IN ('done','cancelled','declined','superseded')
    ORDER BY t.code,t.id LIMIT 20`).all(projectId) as ProjectDossier["openRequests"];
  const teams = raw.prepare(`SELECT t.name AS teamName,e.priority,e.max_concurrent AS maxConcurrent,e.state FROM engagements e
    JOIN teams t ON t.id=e.team_id WHERE e.project_id=? ORDER BY e.priority DESC,t.name,e.id LIMIT 100`).all(projectId) as ProjectDossier["teams"];
  const next = raw.prepare(`SELECT code,title,state FROM tasks WHERE project_id=? AND state IN ('ready','awaiting-go','active')
    ORDER BY code,id LIMIT 10`).all(projectId) as ProjectDossier["nextSteps"];
  return dossierSchema.parse({
    goal: { name: clean(project.name), workspaceKind: project.workspaceKind,
      requirements: approved.filter((row) => row.kind === "requirements").sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.artifactId.localeCompare(b.artifactId)).slice(0,5).map(ref) },
    stage: { tasks, awaitingGo: tasks["awaiting-go"], pendingApprovals: (raw.prepare("SELECT COUNT(*) AS n FROM approvals WHERE project_id=? AND state='pending'").get(projectId) as { n: number }).n },
    canonical, decisions: decisions.map((row) => clean(`${row.subject}: ${(JSON.parse(row.options_json) as { id: string; label: string }[]).find((o) => o.id === row.outcome_option_id)?.label ?? "Decision recorded"}`)),
    openQuestions: questions.map((row) => clean(`${row.subject}: ${row.summary}`)),
    openRequests: requests.map((row) => ({ ...row, code: clean(row.code), kind: clean(row.kind), subject: clean(row.subject), triageState: clean(row.triageState), targetTeamName: clean(row.targetTeamName) })),
    risks: dossierRisks(raw,projectId), teams: teams.map((row) => ({ ...row, teamName: clean(row.teamName) })),
    nextSteps: next.map((row) => ({ ...row, code: clean(row.code), title: clean(row.title) })),
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b))
    .map(([key,item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function dossierDigest(dossier: ProjectDossier): string {
  // Self references are omitted: registering/reviewing the snapshot cannot invalidate itself.
  const self = new Set(dossier.canonical.filter((group) => group.kind === "dossier").flatMap((group) => group.items.map((item) => item.ref.artifactId)));
  return createHash("sha256").update(canonicalJson({ ...dossier, canonical: dossier.canonical.filter((group) => group.kind !== "dossier"),
    risks: dossier.risks.filter((item) => !self.has(item.ref.artifactId)) })).digest("hex");
}
export function renderDossierMarkdown(dossier: ProjectDossier): string {
  const lines = [`<!-- digest:${dossierDigest(dossier)} -->`, "# Project Dossier"];
  const section = (title: string, items: string[]): void => { lines.push("",`## ${title}`,...(items.length ? items : ["None"]).map((item) => `- ${item}`)); };
  const ref = (value: ArtifactRef): string => `${value.artifactId}@${value.version}`;
  section("Goal",[`${dossier.goal.name} (${dossier.goal.workspaceKind})`,...dossier.goal.requirements.map(ref)]);
  section("Stage",[...Object.entries(dossier.stage.tasks).map(([state,n]) => `${state}: ${n}`),`Awaiting Go: ${dossier.stage.awaitingGo}`,`Pending approvals: ${dossier.stage.pendingApprovals}`]);
  section("Canonical",dossier.canonical.flatMap((group) => group.items.map((item) => `${group.kind}: ${ref(item.ref)} - ${item.title}: ${item.l0}`)));
  section("Decisions",dossier.decisions); section("Open Questions",dossier.openQuestions);
  section("Open Requests",dossier.openRequests.map((item) => `${item.code} (${item.kind}): ${item.subject}; ${item.state}; ${item.triageState}; ${item.targetTeamName}; waiting: ${item.waitingCount}`));
  section("Risks",dossier.risks.map((item) => `${ref(item.ref)} - ${item.title}; because ${item.because}`));
  section("Teams",dossier.teams.map((item) => `${item.teamName}: priority ${item.priority}, maxConcurrent ${item.maxConcurrent}, ${item.state}`));
  section("Next Steps",dossier.nextSteps.map((item) => `${item.code}: ${item.title} (${item.state})`));
  return lines.join("\n") + "\n";
}
