import { improvementProposalSchema, type EntityRef, type ImprovementProposal } from "@factory/contracts";
import type { Database } from "better-sqlite3";

type ProposalRow = { project_id: string; id: string; flow_id: string; base_version: number | null; base_draft_revision: number;
  state: ImprovementProposal["state"]; source: ImprovementProposal["source"]; findings_json: string; patch_json: string;
  setup_proposal_id: string | null; revision: number; created_at: string; updated_at: string };

function view(row: ProposalRow): ImprovementProposal {
  return improvementProposalSchema.parse({ projectId: row.project_id, id: row.id, flowId: row.flow_id, baseVersion: row.base_version,
    baseDraftRevision: row.base_draft_revision, state: row.state, source: row.source, findings: JSON.parse(row.findings_json),
    patch: JSON.parse(row.patch_json), setupProposalId: row.setup_proposal_id, revision: row.revision,
    createdAt: row.created_at, updatedAt: row.updated_at });
}

export function readProposal(raw: Database, projectId: string, id: string) {
  const row = raw.prepare<[string, string], ProposalRow>("SELECT * FROM improvement_proposals WHERE project_id=? AND id=?").get(projectId, id);
  return row && view(row);
}

export function listProposals(raw: Database, projectId: string) {
  return raw.prepare<[string], ProposalRow>("SELECT * FROM improvement_proposals WHERE project_id=? ORDER BY created_at DESC,id DESC")
    .all(projectId).map(view);
}

const ref = (id: string, revision: number): EntityRef => ({ kind: "improvement-proposal", id, revision });

export function insertProposal(raw: Database, proposal: ImprovementProposal) {
  const { projectId, id, flowId, baseVersion, baseDraftRevision, state, source, findings, patch, setupProposalId, revision, createdAt, updatedAt } = proposal;
  raw.prepare(`INSERT INTO improvement_proposals(project_id,id,flow_id,base_version,base_draft_revision,state,source,findings_json,
    patch_json,setup_proposal_id,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(projectId, id, flowId, baseVersion, baseDraftRevision, state, source, JSON.stringify(findings), JSON.stringify(patch),
      setupProposalId, revision, createdAt, updatedAt);
  return ref(id, revision);
}

export function setProposalState(raw: Database, row: ImprovementProposal, state: "applied" | "discarded", at: string) {
  raw.prepare("UPDATE improvement_proposals SET state=?,revision=revision+1,updated_at=? WHERE project_id=? AND id=?")
    .run(state, at, row.projectId, row.id);
  return ref(row.id, row.revision + 1);
}
