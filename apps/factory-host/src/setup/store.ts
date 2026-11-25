import { setupProposalViewSchema, type SetupIssue, type SetupProposalView } from "@factory/contracts";
import type { Database } from "better-sqlite3";

export interface ProposalRow {
  project_id: string; id: string; revision: number; state: SetupProposalView["state"]; request: string;
  mode: "project" | "flow"; flow_id: string | null; flow_revision: number | null;
  proposal_json: string | null; issues_json: string; applied_json: string | null;
}

export const getProposal = (raw: Database, projectId: string, id: string) =>
  raw.prepare<[string, string], ProposalRow>("SELECT * FROM setup_proposals WHERE project_id=? AND id=?").get(projectId, id);

export function finishGeneration(raw: Database, row: ProposalRow, state: "ready" | "invalid" | "failed", issues: SetupIssue[], proposal?: string) {
  raw.prepare(`UPDATE setup_proposals SET state=?, revision=revision+1, issues_json=?, proposal_json=?
    WHERE project_id=? AND id=? AND state='generating'`).run(state, JSON.stringify(issues), proposal ?? null, row.project_id, row.id);
}

export const issue = (path: string, message: string): SetupIssue => ({ path: path.slice(0, 256), message: message.slice(0, 500) });

export function readView(raw: Database, row: ProposalRow): SetupProposalView {
  const usage = raw.prepare<[string, string], { count: number; reported: number; total: number | null }>(`
    SELECT count(*) AS count, count(input_tokens + output_tokens) AS reported, sum(input_tokens + output_tokens) AS total
    FROM usage_records WHERE project_id=? AND setup_proposal_id=?`).get(row.project_id, row.id)!;
  return setupProposalViewSchema.parse({ id: row.id, revision: row.revision, state: row.state, request: row.request,
    ...(row.proposal_json === null ? {} : { proposal: JSON.parse(row.proposal_json) }), issues: JSON.parse(row.issues_json),
    ...(row.applied_json === null ? {} : { applied: JSON.parse(row.applied_json) }),
    tokens: usage.count === usage.reported ? usage.total : null });
}
