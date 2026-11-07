import { z } from "zod";
import { artifactKindSchema, artifactRefSchema, labelSchema, taskProgressInputSchema } from "@factory/contracts";
import type { TokenGrant } from "../proxy/tokens.js";
import { McpToolError, sanitizeAgentText } from "./security.js";

export const agentOutputInputSchema = z.strictObject({
  title: labelSchema, kind: artifactKindSchema,
  mediaType: z.enum(["text/markdown", "text/plain", "application/json"]), path: z.string().min(1).max(4096),
  abstractL0: z.string().min(1).max(400), abstractL1: z.string().max(6000).optional(),
  inputs: z.array(artifactRefSchema).max(100).default([]),
});
export type AgentOutputInput = z.infer<typeof agentOutputInputSchema>;
export interface McpDeps {
  progress(grant: TokenGrant, input: { summary: string; percent?: number }): void;
  registerOutput(grant: TokenGrant, input: AgentOutputInput): { artifactId: string; version: number };
}
export interface ToolResult { content: { type: "text"; text: string }[]; isError: boolean }
const result = (text: string, isError = false): ToolResult => ({ content: [{ type: "text", text }], isError });

export const toolDefinitions = [
  { name: "task.progress", description: "Report a meaningful milestone. Never include secrets.",
    inputSchema: z.toJSONSchema(taskProgressInputSchema) },
  { name: "output.register", description: "Register a deliverable file using its workspace-relative path. Never include secrets.",
    inputSchema: z.toJSONSchema(agentOutputInputSchema) },
];

export function createMcpTools(deps: McpDeps, options: { maxProgressPerAttempt?: number } = {}): { call(grant: TokenGrant, name: string, args: unknown): ToolResult } {
  const maxProgress = options.maxProgressPerAttempt ?? 500;
  const progressCalls = new Map<string, number>();
  return { call(grant, name, args) {
    try {
      if (name === "task.progress") {
        const parsed = taskProgressInputSchema.safeParse(args);
        if (!parsed.success) return result("invalid tool input", true);
        const used = progressCalls.get(grant.attemptId) ?? 0;
        if (used >= maxProgress) return result("tool limit reached", true);
        deps.progress(grant, { summary: sanitizeAgentText(parsed.data.summary),
          ...(parsed.data.percent === undefined ? {} : { percent: parsed.data.percent }) });
        progressCalls.set(grant.attemptId, used + 1);
        return result("progress recorded");
      }
      if (name === "output.register") {
        const parsed = agentOutputInputSchema.safeParse(args);
        if (!parsed.success) return result("invalid tool input", true);
        const ref = deps.registerOutput(grant, parsed.data);
        return result(JSON.stringify({ artifactId: ref.artifactId, version: ref.version }));
      }
      return result("tool is not available", true);
    } catch (error) {
      return result(error instanceof McpToolError ? error.reason : "tool could not be completed", true);
    }
  } };
}
