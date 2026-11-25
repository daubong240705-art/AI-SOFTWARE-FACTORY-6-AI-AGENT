import type { Database } from "better-sqlite3";
import type { Clock } from "../ids.js";
import { TraceRecorder } from "../trace/recorder.js";
import type { Entity } from "../trace/sources.js";

export class InsightsTraceRecorder extends TraceRecorder {
  constructor(private readonly db: Database, private readonly now: Clock, log?: (message: string) => void) { super(db, now, ...(log ? [log] : [])); }

  override entity(projectId: string, entity: Entity, at?: string, parent?: Entity): ReturnType<TraceRecorder["entity"]> {
    const timestamp = at ?? this.now().toISOString();
    const position = super.entity(projectId, entity, timestamp, parent);
    if (position && (entity.kind === "node-run" || entity.kind === "attempt")) {
      const span = this.db.prepare<[string, string], { status: string }>("SELECT status FROM trace_spans WHERE project_id=? AND id=?")
        .get(projectId, position.id);
      if (entity.kind === "node-run" && span?.status === "ready") {
        const [runId, nodeId, iteration, attemptNo] = entity.ref.split(":");
        this.db.prepare("INSERT OR IGNORE INTO insight_node_ready VALUES (?,?,?,?,?,?)")
          .run(projectId, runId, nodeId, Number(iteration), Number(attemptNo), timestamp);
      } else if (entity.kind === "attempt" && span?.status === "queued") {
        this.db.prepare("INSERT OR IGNORE INTO insight_attempt_queued VALUES (?,?,?)").run(projectId, entity.ref, timestamp);
      }
    }
    return position;
  }
}
