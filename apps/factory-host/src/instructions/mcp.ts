import type { Database } from "better-sqlite3";
import { skillGetInputSchema } from "@factory/contracts";
import type { TokenGrant } from "../proxy/tokens.js";
import { assertActiveGrant, McpToolError } from "../mcp/security.js";
import type { ToolResult } from "../mcp/tools.js";
import { getSkill } from "./snapshot.js";

function boundedText(content: string): string {
  const bytes = Buffer.from(content);
  // Leave room for the MCP envelope even when JSON escaping expands the text.
  if (bytes.length <= 32768 && Buffer.byteLength(JSON.stringify(content)) <= 60000) return content;
  const marker = "\n[truncated]";
  let text = ""; let size = 0; let encodedSize = Buffer.byteLength(JSON.stringify(marker));
  for (const character of content) {
    const length = Buffer.byteLength(character);
    const encodedLength = Buffer.byteLength(JSON.stringify(character)) - 2;
    if (size + length > 32768 - Buffer.byteLength(marker) || encodedSize + encodedLength > 60000) break;
    text += character; size += length; encodedSize += encodedLength;
  }
  return text + marker;
}

/** Identity is taken only from the fenced attempt's persisted seat. Skill text is returned as data. */
export function createSkillsMcp(deps: { raw: Database; now?: () => Date }) {
  const calls = new Map<string, number>();
  const result = (text: string, isError = false): ToolResult => ({ content: [{ type: "text", text }], isError });
  return { call(grant: TokenGrant, name: string, input: unknown): ToolResult {
    try {
      assertActiveGrant(deps.raw, grant, deps.now?.());
      const key = `${grant.projectId}:${grant.attemptId}`;
      const used = calls.get(key) ?? 0;
      if (used >= 200) throw new McpToolError("tool limit reached");
      calls.set(key, used + 1);
      const parsed = skillGetInputSchema.safeParse(input);
      if (name !== "skill.get" || !parsed.success) throw new McpToolError("invalid tool input");
      const seat = deps.raw.prepare("SELECT seat_id FROM attempt_seats WHERE project_id = ? AND attempt_id = ?")
        .get(grant.projectId, grant.attemptId) as { seat_id: string } | undefined;
      const content = seat ? getSkill(deps.raw, { seatId: seat.seat_id, name: parsed.data.name }) : null;
      if (content === null) throw new McpToolError("skill not found");
      return result(boundedText(content));
    } catch (error) {
      return result(error instanceof McpToolError ? error.reason : "skill not found", true);
    }
  } };
}
