import { z } from "zod";
import { artifactKindSchema, artifactRefSchema, decisionRequestInputSchema, knowledgeGetInputSchema, knowledgeSearchInputSchema, labelSchema, taskProgressInputSchema, requestCreateInputSchema, requestReplyInputSchema, requestGetInputSchema } from "@factory/contracts";
import type { TokenGrant } from "../proxy/tokens.js";
import { McpToolError, sanitizeAgentText } from "./security.js";
import { cleanArtifactSummary } from "../artifacts/summary.js";
import { skillGetInputSchema } from "@factory/contracts";

export const agentOutputInputSchema = z.strictObject({
  title: labelSchema, kind: artifactKindSchema,
  mediaType: z.enum(["text/markdown", "text/plain", "application/json"]), path: z.string().min(1).max(4096),
  abstractL0: z.string().min(1).max(400), abstractL1: z.string().max(6000).optional(),
  inputs: z.array(artifactRefSchema).max(100).default([]),
});
export type AgentOutputInput = z.infer<typeof agentOutputInputSchema>;
export type DecisionRequestInput = z.infer<typeof decisionRequestInputSchema>;

/** Validate both the original contract input and the text that will actually be stored. */
export function cleanDecisionRequest(input: unknown): DecisionRequestInput {
  const parsed = decisionRequestInputSchema.safeParse(input);
  if (!parsed.success) throw new McpToolError("invalid tool input");
  const value = parsed.data;
  const clean = decisionRequestInputSchema.safeParse({
    subject: sanitizeAgentText(value.subject).trim().slice(0, 160),
    summary: sanitizeAgentText(value.summary).slice(0, 4000),
    options: value.options.map((option) => ({ id: sanitizeAgentText(option.id).trim().slice(0, 160),
      label: sanitizeAgentText(option.label).trim().slice(0, 160), consequence: sanitizeAgentText(option.consequence).slice(0, 1000) })),
    ...(value.recommendation === undefined ? {} : { recommendation: sanitizeAgentText(value.recommendation).trim().slice(0, 160) }),
    impactIfWaiting: sanitizeAgentText(value.impactIfWaiting).slice(0, 1000),
  });
  if (!clean.success || new Set(clean.data.options.map((option) => option.id)).size !== value.options.length)
    throw new McpToolError("invalid tool input");
  return clean.data;
}
export interface McpDeps {
  skills?: { call(grant: TokenGrant, name: string, input: unknown): ToolResult };
  briefing?: { call(grant: TokenGrant, name: string, input: unknown): ToolResult };
  requests?: { call(grant: TokenGrant, name: string, input: unknown): ToolResult };
  knowledge?: { call(grant: TokenGrant, name: string, input: unknown): ToolResult };
  progress(grant: TokenGrant, input: { summary: string; percent?: number }): void;
  registerOutput(grant: TokenGrant, input: AgentOutputInput): { artifactId: string; version: number };
  requestDecision(grant: TokenGrant, input: DecisionRequestInput): { approvalId: string };
}
export interface ToolResult { content: { type: "text"; text: string }[]; isError: boolean }
const result = (text: string, isError = false): ToolResult => ({ content: [{ type: "text", text }], isError });

export const toolDefinitions = [
  { name: "skill.get", description: "Read a skill from this team's pinned pack snapshot.", inputSchema: z.toJSONSchema(skillGetInputSchema) },
  { name: "project.briefing", description: "Read the project resume briefing and knowledge freshness.", inputSchema: z.toJSONSchema(z.strictObject({})) },
  { name: "request.create", description: "Ask another team asynchronously from this task.", inputSchema: z.toJSONSchema(requestCreateInputSchema) },
  { name: "request.reply", description: "Reply to or acknowledge a request from this task.", inputSchema: z.toJSONSchema(requestReplyInputSchema) },
  { name: "request.get", description: "Read a request thread and readable deliverables.", inputSchema: z.toJSONSchema(requestGetInputSchema) },
  { name: "task.progress", description: "Report a meaningful milestone. Never include secrets.",
    inputSchema: z.toJSONSchema(taskProgressInputSchema) },
  { name: "output.register", description: "Register a deliverable file using its workspace-relative path. Never include secrets.",
    inputSchema: z.toJSONSchema(agentOutputInputSchema) },
  { name: "decision.request", description: "Use ONLY for business decisions you cannot make yourself. Then stop: finish without further tool calls.",
    inputSchema: z.toJSONSchema(decisionRequestInputSchema) },
  { name: "knowledge.search", description: "Search readable knowledge using a query and optional filters.",
    inputSchema: z.toJSONSchema(knowledgeSearchInputSchema) },
  { name: "knowledge.get", description: "Read a visible artifact at summary or full text level.",
    inputSchema: z.toJSONSchema(knowledgeGetInputSchema) },
];

export function createMcpTools(deps: McpDeps, options: { maxProgressPerAttempt?: number } = {}): { call(grant: TokenGrant, name: string, args: unknown): ToolResult } {
  const maxProgress = options.maxProgressPerAttempt ?? 500;
  const progressCalls = new Map<string, number>();
  return { call(grant, name, args) {
    try {
      if (name === "skill.get") return deps.skills?.call(grant, name, args) ?? result("tool is not available", true);
      if (name === "project.briefing") return deps.briefing?.call(grant,name,args) ?? result("tool is not available",true);
      if (name === "request.create" || name === "request.reply" || name === "request.get")
        return deps.requests?.call(grant, name, args) ?? result("multi-team is disabled", true);
      if (name === "knowledge.search" || name === "knowledge.get")
        return deps.knowledge?.call(grant, name, args) ?? result("tool is not available", true);
      if (name === "decision.request") {
        deps.requestDecision(grant, cleanDecisionRequest(args));
        return result("Decision requested. Stop working now and finish without further tool calls.");
      }
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
        cleanArtifactSummary(parsed.data.abstractL0, parsed.data.abstractL1);
        const ref = deps.registerOutput(grant, parsed.data);
        return result(JSON.stringify({ artifactId: ref.artifactId, version: ref.version }));
      }
      return result("tool is not available", true);
    } catch (error) {
      return result(error instanceof McpToolError ? error.reason : "tool could not be completed", true);
    }
  } };
}
