import { basename } from "node:path";
import { gamesResponseSchema, type GamesResponse, type GameSummary, type ReleaseState, type WorkflowInstanceState } from "@factory/contracts";
import type { Database } from "better-sqlite3";

interface SummaryRow {
  project_id: string; name: string; workspace_root: string;
  instance_id: string; workflow_state: WorkflowInstanceState; definition_json: string;
  version: number | null; release_state: ReleaseState | null; play_path: string | null; release_created: string | null;
  updated_at: string;
}

export function listGameSummaries(raw: Database, publicUrl: string | null = null): GamesResponse {
  const rows = raw.prepare(`SELECT p.id AS project_id,p.name,p.workspace_root,
      w.id AS instance_id,w.state AS workflow_state,w.definition_json,
      r.version,r.state AS release_state,r.play_path,r.created_at AS release_created,
      MAX(w.created_at,
        COALESCE((SELECT MAX(MAX(i.created_at,COALESCE(i.last_progress_at,''),COALESCE(i.ended_at,'')))
          FROM workflow_instances i WHERE i.project_id=p.id AND i.key='game-build'),''),
        COALESCE((SELECT MAX(MAX(a.started_at,COALESCE(a.ended_at,''))) FROM attempts a WHERE a.project_id=p.id),''),
        COALESCE((SELECT MAX(e.at) FROM attempt_events e WHERE e.project_id=p.id),''),
        COALESCE((SELECT MAX(u.recorded_at) FROM usage_records u WHERE u.project_id=p.id),''),
        COALESCE((SELECT MAX(MAX(x.created_at,COALESCE(x.completed_at,''))) FROM game_releases x WHERE x.project_id=p.id),''),
        COALESCE((SELECT MAX(json_extract(e.body_json,'$.occurredAt')) FROM event_log e WHERE e.project_id=p.id),'')
      ) AS updated_at
    FROM projects p JOIN workflow_instances w ON w.project_id=p.id AND w.id=(
      SELECT id FROM workflow_instances WHERE project_id=p.id AND key='game-build' ORDER BY created_at DESC,id DESC LIMIT 1)
    LEFT JOIN game_releases r ON r.project_id=p.id AND r.id=(
      SELECT id FROM game_releases WHERE project_id=p.id AND kind='publish' ORDER BY created_at DESC,id DESC LIMIT 1)
    ORDER BY updated_at DESC,p.id`).all() as SummaryRow[];
  const games = rows.map((row): GameSummary => {
    const stages = raw.prepare("SELECT stage_key,state,loop_count FROM workflow_stages WHERE project_id=? AND instance_id=?")
      .all(row.project_id, row.instance_id) as Array<{ stage_key: string; state: string; loop_count: number }>;
    const definition = JSON.parse(row.definition_json) as { stages: Array<{ key: string }> };
    const ordered = definition.stages.map((spec) => stages.find((stage) => stage.stage_key === spec.key));
    const current = ordered.find((stage) => stage?.state === "active")
      ?? ordered.findLast((stage) => stage?.state === "done");
    return { projectId: row.project_id, name: row.name, gameId: basename(row.workspace_root),
      workflow: { instanceId: row.instance_id, state: row.workflow_state,
        currentStage: current?.stage_key ?? null, loops: Math.max(0, ...stages.map((stage) => stage.loop_count)) },
      release: row.release_state === null ? null : { version: row.version, state: row.release_state,
        playUrl: row.play_path && publicUrl ? `${publicUrl}${row.play_path}` : null, createdAt: row.release_created! },
      updatedAt: row.updated_at };
  });
  return gamesResponseSchema.parse({ games });
}
