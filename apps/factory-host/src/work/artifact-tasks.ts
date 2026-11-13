import type { Database } from "better-sqlite3";

export interface ArtifactTaskRef { id: string; code: string; title: string; state: string }

/**
 * Task lookups for document grouping. The knowledge module receives these as functions
 * so that it never reads the work tables itself.
 */
export function createArtifactTaskRefs(raw: Database) {
  /** Maps producing attempt ids to their task. Unknown ids are left out. */
  const forAttempts = (projectId: string, attemptIds: readonly string[]): Map<string, ArtifactTaskRef> => {
    const refs = new Map<string, ArtifactTaskRef>();
    const unique = [...new Set(attemptIds)];
    for (let start = 0; start < unique.length; start += 500) {
      const slice = unique.slice(start, start + 500);
      const rows = raw.prepare(`SELECT a.id AS attemptId, t.id, t.code, t.title, t.state
        FROM attempts a JOIN tasks t ON t.project_id = a.project_id AND t.id = a.task_id
        WHERE a.project_id = ? AND a.id IN (${slice.map(() => "?").join(",")})`)
        .all(projectId, ...slice) as Array<ArtifactTaskRef & { attemptId: string }>;
      for (const { attemptId, ...task } of rows) refs.set(attemptId, task);
    }
    return refs;
  };
  /** Every attempt of one task, or null when the task does not exist in the project. */
  const attemptsOf = (projectId: string, taskId: string): string[] | null => {
    if (!raw.prepare("SELECT 1 FROM tasks WHERE project_id = ? AND id = ?").get(projectId, taskId)) return null;
    return (raw.prepare("SELECT id FROM attempts WHERE project_id = ? AND task_id = ?").all(projectId, taskId) as { id: string }[])
      .map((row) => row.id);
  };
  return { forAttempts, attemptsOf };
}
export type ArtifactTaskRefs = ReturnType<typeof createArtifactTaskRefs>;
