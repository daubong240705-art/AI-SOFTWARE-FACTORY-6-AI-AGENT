import { messageSchema, type FactoryEvent } from "@factory/contracts";
import { appendMessage, getConversation, listPendingTurns, setTurnState, type LeadTurn } from "../chat/service.js";
import type { EventHub } from "../events/hub.js";
import { createIdGenerator, systemClock, type Clock } from "../ids.js";
import { ModelError, type ModelGateway, type ModelResult, type ReasoningEffort } from "../models/gateway.js";
import { findLeadSeat, getPrimaryEngagement, listSeats } from "../org/service.js";
import { checkAndReserve, DEFAULT_BUDGET_CONFIG, recordUsage, type BudgetConfig } from "../policy/budget.js";
import { getProject } from "../projects/service.js";
import type { Storage } from "../storage/database.js";
import { createProposedTasks, listTasks } from "../work/service.js";
import { buildLeadRequest } from "./prompt.js";
import { parseLeadOutput } from "./protocol.js";

export interface LeadConfig {
  model: string; effort: ReasoningEffort | null; maxOutputTokens: number; maxHistoryMessages: number;
  maxHistoryChars: number; maxTasksInContext: number; timeoutMs: number;
}
export const DEFAULT_LEAD_CONFIG: LeadConfig = {
  model: "gpt-6.1-sol", effort: "medium", maxOutputTokens: 4096, maxHistoryMessages: 20,
  maxHistoryChars: 40_000, maxTasksInContext: 50, timeoutMs: 120_000,
};
export interface LeadRunner {
  kick(): void; recover(): number; idle(): Promise<void>; stop(): Promise<void>;
}

export function createLeadRunner(deps: {
  storage: Storage; hub: EventHub; gateway: ModelGateway | null; profileText: string;
  config?: Partial<LeadConfig>; budgetConfig?: BudgetConfig; clock?: Clock; newId?: () => string;
}): LeadRunner {
  const { raw } = deps.storage;
  const { hub, gateway } = deps;
  const clock = deps.clock ?? systemClock;
  const newId = deps.newId ?? createIdGenerator(clock);
  const config = { ...DEFAULT_LEAD_CONFIG, ...deps.config };
  const budgetConfig = deps.budgetConfig ?? DEFAULT_BUDGET_CONFIG;
  let stopped = false;
  let running = false;
  let again = false;
  let scheduled: ReturnType<typeof setImmediate> | undefined;
  let controller: AbortController | undefined;
  const waiters = new Set<() => void>();
  const settle = (): void => {
    if (running || scheduled !== undefined) return;
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  const event = (turn: LeadTurn, payload: FactoryEvent["payload"]): void => {
    hub.append({ projectId: turn.projectId, causationId: turn.id, rootCausationId: turn.id, payload });
  };
  const systemMessage = (turn: LeadTurn, text: string, now: string): void => {
    const { message } = appendMessage(raw, { projectId: turn.projectId, conversationId: turn.conversationId,
      id: newId(), speaker: "system", agentId: null, text, createdAt: now });
    event(turn, { type: "message.appended", message });
  };
  const terminal = (turn: LeadTurn, state: "failed" | "budget-blocked", kind: string, text: string,
    usage?: () => void): void => {
    hub.transaction(() => {
      const now = clock().toISOString();
      usage?.();
      systemMessage(turn, text, now);
      setTurnState(raw, turn.projectId, turn.id, state, { now, errorKind: kind });
    });
  };
  const processTurn = async (turn: LeadTurn): Promise<void> => {
    try { setTurnState(raw, turn.projectId, turn.id, "running", { now: clock().toISOString() }); }
    catch { return; } // Another processor may already have claimed this turn.
    let estimate: number | undefined;
    let taskId: string | null = null;
    let calling = false;
    let completed: ModelResult | undefined; // the provider answered: tokens were spent whatever happens next
    try {
      const conversation = getConversation(raw, turn.projectId, turn.conversationId);
      const project = getProject(raw, turn.projectId);
      if (!conversation || !project) throw new Error("Missing turn context");
      taskId = conversation.workItemId;
      const engagement = getPrimaryEngagement(raw, turn.projectId);
      const lead = engagement && findLeadSeat(raw, engagement.teamId);
      const seats = lead && engagement ? listSeats(raw, engagement.teamId) : [];
      const user = raw.prepare("SELECT body_json, ordinal FROM messages WHERE project_id = ? AND conversation_id = ? AND id = ?")
        .get(turn.projectId, turn.conversationId, turn.id) as { body_json: string; ordinal: number } | undefined;
      if (!user) throw new Error("Missing user message");
      const intent = JSON.parse(user.body_json).intent === "delegate" ? "delegate" : "discuss";
      // Bound by the triggering ordinal BEFORE limiting history; later messages cannot displace it.
      const rows = raw.prepare(`SELECT body_json FROM messages WHERE project_id = ? AND conversation_id = ?
        AND ordinal <= ? AND json_extract(body_json, '$.message.speaker') != ? ORDER BY ordinal DESC LIMIT ?`)
        .all(turn.projectId, turn.conversationId, user.ordinal, "system", Math.max(1, config.maxHistoryMessages)) as { body_json: string }[];
      const history = rows.reverse().map((row) => messageSchema.parse(JSON.parse(row.body_json).message));
      const built = buildLeadRequest({ profileText: deps.profileText,
        project: { name: project.name, workspaceRoot: project.workspace.root }, seats, tasks: listTasks(raw, turn.projectId),
        history, intent, config });
      if (gateway === null) {
        terminal(turn, "failed", "not-configured", "The model gateway is not configured. Set NINE_ROUTER_API_KEY and restart the Host.");
        return;
      }
      const reservation = checkAndReserve(raw, { projectId: turn.projectId, taskId, now: clock(),
        estimateTokens: built.estimateTokens, config: budgetConfig });
      if (!reservation.ok) {
        terminal(turn, "budget-blocked", `budget-${reservation.scope}-${reservation.verdict}`,
          `Budget limit reached (${reservation.scope}): ${reservation.used} of ${reservation.limit} tokens used.`);
        return;
      }
      estimate = built.estimateTokens;
      controller = new AbortController();
      calling = true;
      const result = await gateway.complete({ ...built.request, signal: controller.signal });
      calling = false;
      completed = result;
      // Reasoning models spend output tokens before any visible text; a cut answer must not look like "no answer".
      if (result.finishReason === "length") {
        terminal(turn, "failed", "output-limit",
          `The model ran out of output tokens (${config.maxOutputTokens}) before finishing its answer. `
          + "Raise FACTORY_LEAD_MAX_OUTPUT_TOKENS on the Host, then send the message again.",
          () => recordUsage(raw, { id: newId(), projectId: turn.projectId, taskId, attemptId: null,
            conversationId: turn.conversationId, provider: result.provider, model: result.model, effort: config.effort,
            usage: result.usage, estimatedTokens: built.estimateTokens, recordedAt: clock().toISOString() }));
        return;
      }
      const parsed = parseLeadOutput(result.text, intent);
      hub.transaction(() => {
        const now = clock().toISOString();
        recordUsage(raw, { id: newId(), projectId: turn.projectId, taskId, attemptId: null,
          conversationId: conversation.id, provider: result.provider, model: result.model, effort: config.effort,
          usage: result.usage, estimatedTokens: built.estimateTokens, recordedAt: now });
        const { message } = appendMessage(raw, { projectId: turn.projectId, conversationId: conversation.id,
          id: newId(), speaker: "agent", agentId: conversation.agentId, text: parsed.reply, createdAt: now });
        const tasks = parsed.plan === null ? [] : createProposedTasks(raw, { projectId: turn.projectId,
          turnId: turn.id, plan: parsed.plan, engagementId: engagement?.id ?? null });
        event(turn, { type: "message.appended", message });
        if (parsed.note !== null) systemMessage(turn, parsed.note, now);
        setTurnState(raw, turn.projectId, turn.id, "done", { now, replyMessageId: message.id });
        for (const task of tasks) event(turn, { type: "entity.changed", entity: { kind: "task", id: task.id, revision: task.revision } });
      });
    } catch (error) {
      const kind = calling && error instanceof ModelError ? error.kind : "internal";
      const uncertain = ["timeout", "unavailable", "bad-response", "cancelled"].includes(kind);
      // Spend must reach the ledger even when only the bookkeeping after a successful call failed.
      const spend = completed !== undefined || (uncertain && estimate !== undefined && gateway !== null);
      terminal(turn, "failed", kind,
        `The Lead could not answer (${kind}). Your message was kept; send it again to retry.`,
        spend && estimate !== undefined && gateway !== null ? () => recordUsage(raw, {
          id: newId(), projectId: turn.projectId, taskId, attemptId: null, conversationId: turn.conversationId,
          provider: completed?.provider ?? gateway.providerId, model: completed?.model ?? config.model,
          effort: config.effort, usage: completed?.usage ?? null,
          estimatedTokens: estimate as number, recordedAt: clock().toISOString(),
        }) : undefined);
    } finally { controller = undefined; }
  };
  const loop = async (): Promise<void> => {
    running = true;
    try {
      do {
        again = false;
        for (const turn of listPendingTurns(raw)) {
          if (stopped) break;
          if (turn.state === "queued") await processTurn(turn);
        }
      } while (again && !stopped);
    } catch { /* A storage/bookkeeping failure must not escape a scheduled kick or retry a call. */ }
    finally { running = false; settle(); }
  };
  const idle = (): Promise<void> => running || scheduled !== undefined
    ? new Promise((resolve) => { waiters.add(resolve); }) : Promise.resolve();
  return {
    kick() {
      if (stopped) return;
      if (running) { again = true; return; }
      if (scheduled !== undefined) return;
      scheduled = setImmediate(() => { scheduled = undefined; void loop(); });
    },
    recover() {
      return hub.transaction(() => {
        let count = 0;
        for (const turn of listPendingTurns(raw)) {
          if (turn.state !== "running") continue;
          const now = clock().toISOString();
          setTurnState(raw, turn.projectId, turn.id, "unknown", { now });
          systemMessage(turn, "The Lead's answer was interrupted by a restart. Send your message again if you still need it.", now);
          count++;
        }
        return count;
      });
    },
    idle,
    async stop() {
      stopped = true;
      if (scheduled !== undefined) { clearImmediate(scheduled); scheduled = undefined; }
      controller?.abort();
      settle();
      await idle();
    },
  };
}
