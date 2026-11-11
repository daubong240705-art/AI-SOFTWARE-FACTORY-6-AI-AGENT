export interface KnowledgeScope {
  projectId: string; teamId: string | null; viewer: "operator" | "agent";
  grants?: readonly { artifactId: string; version: number }[];
}
export interface SqlPredicate { sql: string; params: (string | number | null)[] }

/** The sole read policy. Aliases are internal constants, never supplied by an HTTP/MCP caller. */
export function visibleToScope(scope: KnowledgeScope, alias: "v" | "newer" = "v"): SqlPredicate {
  const grants = scope.grants ?? [];
  const exact = grants.length ? grants.map(() => `(${alias}.artifact_id = ? AND ${alias}.version = ?)`).join(" OR ") : "0";
  const local = scope.viewer === "operator" ? "1" : `(
    ${alias}.status NOT IN ('withdrawn','rejected') AND (
      ${alias}.visibility IN ('project','organization') OR (
        ${alias}.visibility = 'team-draft' AND EXISTS (
          SELECT 1 FROM attempt_seats ownership JOIN seats seat ON seat.id = ownership.seat_id
          WHERE ownership.project_id = ${alias}.project_id
            AND ownership.attempt_id = ${alias}.produced_by_attempt_id AND seat.team_id = ?)) OR (${exact})))`;
  return {
    sql: `((${alias}.project_id = ? AND ${local}) OR
      (${alias}.project_id <> ? AND ${alias}.visibility = 'organization' AND ${alias}.status = 'approved'))`,
    params: scope.viewer === "operator" ? [scope.projectId, scope.projectId]
      : [scope.projectId, scope.teamId, ...grants.flatMap((ref) => [ref.artifactId, ref.version]), scope.projectId],
  };
}
