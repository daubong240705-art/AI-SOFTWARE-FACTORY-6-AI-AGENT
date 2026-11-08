import { McpToolError, sanitizeAgentText } from "../mcp/security.js";

/** Validate the supplied summary and the sanitized summary before any write. */
export function cleanArtifactSummary(l0: string, l1: string | undefined): string | null {
  if (l1 === undefined) return null;
  const clean = l1.split(/\r?\n/).map((line) => sanitizeAgentText(line).trim()).join("\n").trim();
  for (const text of [l1.trim(), clean]) {
    if (text.length < 80 || text.split(/\r?\n/).filter((line) => line.trim()).length < 2
      || text === l0.trim() || text === sanitizeAgentText(l0).trim())
      throw new McpToolError("summary (L1) is too short or unstructured");
  }
  return clean;
}
