import type { Command } from "@factory/contracts";
import { CommandError } from "../commands/errors.js";
import type { HandlerContext, HandlerMap, HandlerResult } from "../commands/pipeline.js";
import { ArtifactLifecycleError, clearStale, collectLifecycleChanges, shareArtifactVersion, transitionArtifactVersion } from "./lifecycle.js";

function apply(ctx: HandlerContext, projectId: string, run: () => HandlerResult): HandlerResult {
  if (!ctx.raw.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId))
    throw new CommandError("not-found", "project not found", "correct-input");
  try {
    const result = run();
    // Receipts allow at most 100 effects. Larger impact sets still publish every change
    // through the pipeline's transaction, including entities beyond that receipt budget.
    if (result.effects.length <= 100) return result;
    return { ...result, effects: result.effects.slice(0, 100), events: [
      ...(result.events ?? []), ...result.effects.slice(100).map((entity) => ({ type: "entity.changed" as const, entity })),
    ] };
  } catch (error) {
    if (!(error instanceof ArtifactLifecycleError)) throw error;
    const code = error.code === "not-found" ? "not-found" : error.code === "validation" ? "validation" : "conflict";
    throw new CommandError(code, error.message, code === "conflict" ? "refresh" : "correct-input");
  }
}
export const artifactsTransitionHandler: HandlerMap["artifacts.transition"] = (ctx, { projectId, payload }) =>
  apply(ctx, projectId, () => ({ effects: transitionArtifactVersion(ctx.raw, {
    projectId, ...payload, actorId: ctx.actorId, now: ctx.clock().toISOString(),
  }) }));
export const artifactsShareHandler: HandlerMap["artifacts.share"] = (ctx, { projectId, payload }) =>
  apply(ctx, projectId, () => ({ effects: shareArtifactVersion(ctx.raw, { projectId, ...payload }) }));
export const artifactsClearStaleHandler: HandlerMap["artifacts.clear-stale"] = (ctx, { projectId, payload }) =>
  apply(ctx, projectId, () => ({ effects: clearStale(ctx.raw, { projectId, ...payload }) }));
export const knowledgeHandlers = {
  "artifacts.transition": artifactsTransitionHandler,
  "artifacts.share": artifactsShareHandler,
  "artifacts.clear-stale": artifactsClearStaleHandler,
};

export function createKnowledgeHandlers(options: { multiTeam: boolean }): typeof knowledgeHandlers {
  return { ...knowledgeHandlers, "artifacts.transition": (ctx, { projectId, payload }) =>
    apply(ctx, projectId, () => ({ effects: transitionArtifactVersion(ctx.raw, {
      projectId, ...payload, actorId: ctx.actorId, now: ctx.clock().toISOString(), multiTeam: options.multiTeam,
    }) })) };
}

/** Review decisions keep their existing effects and add the versions/tasks changed by approval. */
export function withKnowledgeEffects<T extends Command["type"]>(handler: HandlerMap[T]): HandlerMap[T] {
  return ((ctx: HandlerContext, command: Parameters<HandlerMap[T]>[1]) => apply(ctx, command.projectId, () => {
    // Completing a task is the operator's decision even with stale inputs. Retire its
    // advisory input hold in the same transaction so the done-without-holds invariant holds.
    const completion = command as Command;
    let completingTask: string | undefined;
    if (completion.type === "tasks.transition" && completion.payload.to === "done") completingTask = completion.payload.taskId;
    if (completion.type === "approvals.decide" && completion.payload.optionId === "accept") {
      const review = ctx.raw.prepare("SELECT task_id FROM approvals WHERE project_id = ? AND id = ? AND kind = 'review'")
        .get(completion.projectId, completion.payload.approvalId) as { task_id: string | null } | undefined;
      completingTask = review?.task_id ?? undefined;
    }
    if (completingTask) ctx.raw.prepare("DELETE FROM task_holds WHERE project_id = ? AND task_id = ? AND kind = 'input'")
      .run(command.projectId, completingTask);
    const { result, effects } = collectLifecycleChanges(ctx.raw, () => handler(ctx, command));
    return { ...result, effects: [...new Map([...result.effects, ...effects]
      .map((e) => [`${e.kind}:${e.id}:${e.revision}`, e])).values()] };
  })) as HandlerMap[T];
}
