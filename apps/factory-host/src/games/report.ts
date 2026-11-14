import { gameReportSchema, type GameReport, type TaskState, type WorkflowDefinition } from "@factory/contracts";
import type { Database } from "better-sqlite3";
import { publicApprovalText } from "../approvals/service.js";
import { sanitizeAgentText } from "../mcp/security.js";

type Tokens = NonNullable<GameReport["totals"]["tokens"]>;
interface Link { stage_key: string; iteration: number; id: string; code: string; state: TaskState; acceptance_json: string }
interface Attempt { id: string; state: string; started_at: string | null; ended_at: string | null }
const emptyTokens = (): Tokens => ({ input: null, cachedInput: null, output: null, reasoning: null });
function sumTokens(rows: Array<Tokens | null>): Tokens | null {
  const total = emptyTokens();
  for (const row of rows) if (row) for (const key of Object.keys(total) as Array<keyof Tokens>) {
    if (row[key] !== null) total[key] = (total[key] ?? 0) + row[key];
  }
  return Object.values(total).some((value) => value !== null) ? total : null;
}
const clean = (text: string): string => publicApprovalText(sanitizeAgentText(text));
const duration = (attempt: Attempt): number => attempt.started_at && attempt.ended_at
  ? Math.max(0, Date.parse(attempt.ended_at) - Date.parse(attempt.started_at)) : 0;

export function gameReport(raw: Database, projectId: string): GameReport {
  const instance = raw.prepare(`SELECT id,definition_json FROM workflow_instances
    WHERE project_id=? AND key='game-build' ORDER BY created_at DESC,id DESC LIMIT 1`)
    .get(projectId) as { id: string; definition_json: string } | undefined;
  if (!instance) return { stages: [], totals: { durationMs: 0, attempts: 0, tokens: null }, qaRounds: [] };
  const definition = JSON.parse(instance.definition_json) as WorkflowDefinition;
  const links = raw.prepare(`SELECT l.stage_key,l.iteration,t.id,t.code,t.state,t.acceptance_json
    FROM workflow_stage_tasks l JOIN tasks t ON t.project_id=l.project_id AND t.id=l.task_id
    WHERE l.project_id=? AND l.instance_id=? ORDER BY l.iteration,t.code,t.id`).all(projectId, instance.id) as Link[];
  const attemptsFor = raw.prepare("SELECT id,state,started_at,ended_at FROM attempts WHERE project_id=? AND task_id=? ORDER BY epoch");
  const usageFor = raw.prepare(`SELECT input_tokens AS input,cached_input_tokens AS cachedInput,
    output_tokens AS output,reasoning_output_tokens AS reasoning FROM usage_records WHERE project_id=? AND task_id=? AND attempt_id IS NOT NULL`);
  const attempts = new Map(links.map((link) => [link.id, attemptsFor.all(projectId, link.id) as Attempt[]]));
  const stages = definition.stages.map((spec) => ({ key: spec.key, title: clean(spec.title),
    iterations: links.filter((link) => link.stage_key === spec.key).map((link) => {
      const runs = attempts.get(link.id)!;
      const starts = runs.flatMap((run) => run.started_at ? [run.started_at] : []).sort();
      const ends = runs.flatMap((run) => run.ended_at ? [run.ended_at] : []).sort();
      const unfinished = runs.some((run) => run.ended_at === null);
      return { iteration: link.iteration, taskCode: link.code, state: link.state,
        startedAt: starts[0] ?? null, endedAt: unfinished ? null : ends.at(-1) ?? null,
        durationMs: starts.length === 0 || unfinished ? null : runs.reduce((sum, run) => sum + duration(run), 0),
        attempts: runs.length, tokens: sumTokens(usageFor.all(projectId, link.id) as Tokens[]) };
    }) }));
  const qaSources = new Set(definition.edges.filter((edge) => edge.type === "rework").map((edge) => edge.from));
  const qaRounds: GameReport["qaRounds"] = links.filter((link) => qaSources.has(link.stage_key)).map((link) => {
    const last = attempts.get(link.id)!.at(-1);
    const rows = last ? raw.prepare(`SELECT body_json FROM attempt_events
      WHERE project_id=? AND attempt_id=? AND kind='evidence' ORDER BY seq DESC`).all(projectId, last.id) as Array<{ body_json: string }> : [];
    const latest = new Map<string, { passed: boolean | null; evidence: string | null }>();
    for (const row of rows) {
      const body = JSON.parse(row.body_json) as Record<string, unknown>;
      if (body.name === "criterion" && typeof body.criterion === "string" && !latest.has(body.criterion.trim()))
        latest.set(body.criterion.trim(), { passed: typeof body.passed === "boolean" ? body.passed : null,
          evidence: typeof body.evidence === "string" ? clean(body.evidence).slice(0, 300) : null });
    }
    const criteria = (JSON.parse(link.acceptance_json) as string[]).map((criterion) => ({
      criterion: clean(criterion), passed: latest.get(criterion.trim())?.passed ?? null,
      evidence: latest.get(criterion.trim())?.evidence ?? null,
    }));
    // Missing checks on a finished QA run request changes, just as automatic review does.
    const finished = last !== undefined && last.ended_at !== null;
    const verdict = !finished ? "running" : last.state === "succeeded" && criteria.length > 0 && criteria.every((criterion) => criterion.passed === true)
      ? "passed" : "changes-requested";
    return { iteration: link.iteration, taskCode: link.code, verdict, criteria };
  });
  const iterations = stages.flatMap((stage) => stage.iterations);
  return gameReportSchema.parse({ stages, qaRounds, totals: {
    durationMs: [...attempts.values()].flat().reduce((sum, run) => sum + duration(run), 0),
    attempts: iterations.reduce((sum, iteration) => sum + iteration.attempts, 0),
    tokens: sumTokens(iterations.map((iteration) => iteration.tokens)),
  } });
}
