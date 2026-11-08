import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap, HandlerResult } from "../commands/pipeline.js";
import type { Dispatcher } from "../dispatch/dispatcher.js";
import { getTask } from "../work/service.js";
import { appendRequestMessage, getRequest, RequestError, triageRequest } from "./service.js";

export const REQUEST_COMMANDS = ["requests.triage", "requests.message"] as const;
export function createRequestHandlers(deps: { multiTeam: boolean; dispatcher?: Dispatcher }): Partial<HandlerMap> {
  const apply = (ctx: HandlerContext, projectId: string, run: () => HandlerResult): HandlerResult => {
    if (!deps.multiTeam) throw new CommandError("unsupported", "multi-team is disabled", "contact-host");
    if (!ctx.raw.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId))
      throw new CommandError("not-found", "project not found", "correct-input");
    try { return run(); }
    catch (error) {
      if (!(error instanceof RequestError)) throw error;
      const code = error.code === "not-found" ? "not-found" : error.code === "validation" ? "validation" : "conflict";
      throw new CommandError(code, error.reason, code === "conflict" ? "refresh" : "correct-input");
    }
  };
  return {
    "requests.triage": (ctx, { projectId, payload }) => apply(ctx, projectId, () => {
      if (!deps.dispatcher) throw new CommandError("unsupported", "request dispatch is unavailable", "contact-host");
      return { effects: triageRequest(ctx.raw, { projectId, ...payload, actorId: ctx.actorId, now: ctx.clock().toISOString() },
        { raw: ctx.raw, multiTeam: deps.multiTeam, dispatcher: deps.dispatcher, now: ctx.clock, newId: ctx.newId }) };
    }),
    "requests.message": (ctx, { projectId, payload }) => apply(ctx, projectId, () => {
      getRequest(ctx.raw, { grantOrOperator: { projectId, operator: true }, requestId: payload.requestTaskId });
      appendRequestMessage(ctx.raw, { projectId, requestTaskId: payload.requestTaskId, author: "operator", text: payload.text, now: ctx.clock().toISOString() });
      ctx.raw.prepare("UPDATE tasks SET revision = revision + 1 WHERE project_id = ? AND id = ?").run(projectId, payload.requestTaskId);
      return { effects: [{ kind: "task", id: payload.requestTaskId, revision: getTask(ctx.raw, projectId, payload.requestTaskId)!.revision }] };
    }),
  };
}
