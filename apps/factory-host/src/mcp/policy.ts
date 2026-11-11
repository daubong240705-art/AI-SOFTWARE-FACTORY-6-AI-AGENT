import type { Database } from "better-sqlite3";
import type { TokenGrant } from "../proxy/tokens.js";
import { getSeatTools } from "../instructions/snapshot.js";

/** Policy only removes optional tools. Identity comes from the attempt, never tool arguments. */
export function createToolPolicy(raw: Database): (grant: TokenGrant) => { allows(name: string): boolean; referencesExternal(server: string): boolean } {
  return (grant) => {
    const seat = raw.prepare("SELECT seat_id FROM attempt_seats WHERE project_id = ? AND attempt_id = ?")
      .get(grant.projectId, grant.attemptId) as { seat_id: string } | undefined;
    const tools = seat ? getSeatTools(raw, { seatId: seat.seat_id }) : [];
    return { allows: (name) => (tools === null && !name.startsWith("ext.") && name !== "workflow.patch" && name !== "notify.send-internal") || (tools ?? []).some((tool) => tool === name
      || (tool.endsWith(".*") && name.startsWith(tool.slice(0, -1)))),
      referencesExternal: (server) => (tools ?? []).some((tool) => tool.startsWith(`ext.${server}.`)) };
  };
}
