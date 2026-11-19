import type { Database } from "better-sqlite3";
import { z } from "zod";
import { CommandError } from "../commands/errors.js";
import type { Clock } from "../ids.js";
import { rpcError, type createMcpHandler } from "../mcp/rpc.js";
import { assertActiveGrant, McpToolError } from "../mcp/security.js";
import { saveTaskResult } from "./work.js";

const inputSchema = z.strictObject({ result: z.json() });
const call = z.strictObject({ jsonrpc: z.literal("2.0"), method: z.literal("tools/call"), id: z.union([z.string().max(512), z.number().int()]),
  params: z.strictObject({ name: z.literal("task.result"), arguments: inputSchema, _meta: z.record(z.string(), z.unknown()).optional() }) });

export function withFlowResultTool(raw: Database, clock: Clock, next: ReturnType<typeof createMcpHandler>): ReturnType<typeof createMcpHandler> {
  return { async handle(grant, body) {
    let input = body;
    if (typeof body === "string" || Buffer.isBuffer(body)) {
      try { input = JSON.parse(typeof body === "string" ? body : new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown; }
      catch { return next.handle(grant, body); }
    }
    const rpc = input as { method?: string; params?: { name?: string } } | null;
    if (rpc?.method === "tools/call" && rpc.params?.name === "task.result") {
      const parsed = call.safeParse(input);
      if (!parsed.success) return rpcError(-32602);
      let text = "Task result recorded";
      let isError = false;
      try {
        assertActiveGrant(raw, grant, clock());
        saveTaskResult(raw, grant.projectId, grant.taskId, grant.attemptId, parsed.data.params.arguments.result);
      } catch (error) {
        text = error instanceof CommandError || error instanceof McpToolError ? error.message : "Task result could not be recorded";
        isError = true;
      }
      return { status: 200, body: { jsonrpc: "2.0", id: parsed.data.id, result: { content: [{ type: "text", text }], isError } } };
    }
    const response = await next.handle(grant, body);
    if (rpc?.method === "tools/list" && raw.prepare("SELECT 1 FROM flow_tasks WHERE project_id=? AND task_id=?").get(grant.projectId, grant.taskId)) {
      const reply = response.body as { result?: { tools?: unknown[] } } | undefined;
      const tools = reply?.result?.tools;
      if (tools) {
        const tool = { name: "task.result", description: "Report the structured result of the current flow task.", inputSchema: z.toJSONSchema(inputSchema) };
        if (Buffer.byteLength(JSON.stringify([...tools, tool])) < 64000) tools.push(tool);
      }
    }
    return response;
  } };
}
