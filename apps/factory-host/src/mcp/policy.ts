import type { Database } from "better-sqlite3";
import type { AgentConfig } from "@factory/contracts";
import type { TokenGrant } from "../proxy/tokens.js";
import { getSeatTools } from "../instructions/snapshot.js";
import { currentAgentConfig } from "../org/agents.js";

type Mode = NonNullable<AgentConfig["tools"]>[number]["mode"];
/** Identity comes from the attempt, never tool arguments. Reviewers (U6) only read, comment, block and report. */
export function createToolPolicy(raw: Database) {
  return (grant: TokenGrant) => {
    const review = Boolean(raw.prepare("SELECT 1 FROM collab_assignments WHERE project_id=? AND task_id=? AND kind='review'")
      .get(grant.projectId, grant.taskId));
    const seat = raw.prepare("SELECT seat_id FROM attempt_seats WHERE project_id = ? AND attempt_id = ?")
      .get(grant.projectId, grant.attemptId) as { seat_id: string } | undefined;
    const agent = seat && currentAgentConfig(raw, seat.seat_id);
    const tools = agent ? agent.config.tools : seat ? getSeatTools(raw, { seatId: seat.seat_id })?.map((tool) => ({ tool, mode: "allow" as const })) ?? null : [];
    const reviewerMay = (name: string) => !review || name === "task.result" || name === "task.comment" || name === "task.block"
      || name === "project.briefing" || name.startsWith("knowledge.");
    const mode = (name: string): Mode => {
      if (!reviewerMay(name)) return "deny";
      const matches = (tools ?? []).filter(({ tool }) => tool === name || (tool.endsWith(".*") && name.startsWith(tool.slice(0, -1))));
      if (matches.some((entry) => entry.mode === "deny")) return "deny";
      if (matches.some((entry) => entry.mode === "ask")) return "ask";
      if (matches.length || (tools === null && !/^(ext|http)\./.test(name) && name !== "notify.send-internal")) return "allow";
      return "deny";
    };
    return { review, mode, allows: (name: string) => mode(name) !== "deny", explicit: (name: string) =>
      (tools ?? []).some(({ tool }) => tool === name || (tool.endsWith(".*") && name.startsWith(tool.slice(0, -1)))),
      referencesExternal: (server: string) => !review && (tools ?? []).some(({ tool, mode: m }) => m !== "deny" && tool.startsWith(`ext.${server}.`)) };
  };
}
