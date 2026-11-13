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
import type { ContentStore } from "../artifacts/content-store.js";
import type { DocumentConfig } from "../artifacts/limits.js";
import { mediaKind } from "../artifacts/media.js";
import { DocumentError, registerUpload } from "../artifacts/uploads.js";
import { extractionText, textWindow } from "../documents/records.js";
import { getSeatInstructions } from "../instructions/snapshot.js";
import type { Database } from "better-sqlite3";

const DOCUMENT_CHARS = 24_000, DOCUMENTS_TOTAL_CHARS = 60_000, MAX_DOCUMENTS = 5;
type NamedDocument = { fileName: string; title: string; artifactId: string; version: number; text: string; truncated: boolean };

/**
 * Latest usable version of every project document whose file name (or a distinctive title) the operator wrote in
 * one of the conversation's user messages. Text comes from the stored bytes (text types) or the extraction (PDF,
 * Office); images are not text and appear only in the reference list.
 */
function namedDocuments(raw: Database, store: ContentStore, projectId: string, userText: string): NamedDocument[] {
  const haystack = userText.toLowerCase();
  const rows = raw.prepare(`SELECT v.artifact_id AS artifactId, v.version, v.title, v.file_name AS fileName, v.media_type AS mediaType,
      v.content_hash AS hash, v.size_bytes AS size FROM artifact_versions v
    WHERE v.project_id = ? AND v.status NOT IN ('withdrawn', 'rejected')
      AND v.version = (SELECT MAX(x.version) FROM artifact_versions x WHERE x.project_id = v.project_id AND x.artifact_id = v.artifact_id)
    ORDER BY v.created_at DESC`).all(projectId) as Array<{ artifactId: string; version: number; title: string; fileName: string | null;
      mediaType: string; hash: string; size: number }>;
  const documents: NamedDocument[] = []; let total = 0;
  for (const row of rows) {
    if (documents.length >= MAX_DOCUMENTS || total >= DOCUMENTS_TOTAL_CHARS) break;
    const named = (row.fileName !== null && row.fileName.length >= 3 && haystack.includes(row.fileName.toLowerCase()))
      || (row.title.length >= 8 && haystack.includes(row.title.toLowerCase()));
    if (!named || row.mediaType.startsWith("image/")) continue;
    let text: string | null = null;
    try {
      if (mediaKind(row.mediaType) === "text") {
        const bytes = store.get(row.hash);
        text = bytes && bytes.length === row.size ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : null;
      } else text = extractionText(raw, store, { projectId, artifactId: row.artifactId, version: row.version });
    } catch { text = null; }
    if (text === null) continue;
    const window = textWindow(text, 0, Math.min(DOCUMENT_CHARS, DOCUMENTS_TOTAL_CHARS - total));
    total += window.text.length;
    documents.push({ fileName: row.fileName ?? row.title, title: row.title, artifactId: row.artifactId, version: row.version,
      text: window.text, truncated: window.next !== null });
  }
  return documents;
}
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
  getModelConfig?: () => Pick<LeadConfig, "model" | "effort">;
  /** Documents the Lead may read (named in chat) and the store/quota for the plan files it writes. */
  documents?: { store: ContentStore; config: DocumentConfig; afterRegister: (ref: { projectId: string; artifactId: string; version: number }) => void };
}): LeadRunner {
  const { raw } = deps.storage;
  const { hub, gateway } = deps;
  const clock = deps.clock ?? systemClock;
  const newId = deps.newId ?? createIdGenerator(clock);
  const baseConfig = { ...DEFAULT_LEAD_CONFIG, ...deps.config };
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
    let config = baseConfig;
    try { setTurnState(raw, turn.projectId, turn.id, "running", { now: clock().toISOString() }); }
    catch { return; } // Another processor may already have claimed this turn.
    let estimate: number | undefined;
    let taskId: string | null = null;
    let calling = false;
    let completed: ModelResult | undefined; // the provider answered: tokens were spent whatever happens next
    try {
      config = { ...baseConfig, ...deps.getModelConfig?.() };
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
      // The engaged team's own Lead profile (pinned pack snapshot) wins over the Host default pack's profile.
      let profileText = deps.profileText;
      try { profileText = (lead ? getSeatInstructions(raw, { seatId: lead.id })?.profile : undefined) ?? deps.profileText; } catch { /* default */ }
      const userText = history.filter((message) => message.speaker === "user").map((message) => message.text).join("\n");
      const documents = deps.documents ? namedDocuments(raw, deps.documents.store, turn.projectId, userText) : [];
      const references = (raw.prepare(`SELECT v.artifact_id AS artifactId, v.title, v.media_type AS mediaType, v.abstract_l1 AS note
        FROM artifact_versions v WHERE v.project_id = ? AND v.origin = 'upload' AND v.media_type LIKE 'image/%'
          AND v.status NOT IN ('withdrawn', 'rejected')
          AND v.version = (SELECT MAX(x.version) FROM artifact_versions x WHERE x.project_id = v.project_id AND x.artifact_id = v.artifact_id)
        ORDER BY v.created_at DESC LIMIT 40`).all(turn.projectId) as Array<{ artifactId: string; title: string; mediaType: string; note: string | null }>);
      const built = buildLeadRequest({ profileText,
        project: { name: project.name, workspaceRoot: project.workspace.root }, seats, tasks: listTasks(raw, turn.projectId),
        history, intent, config, documents, references });
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
        if (parsed.csv !== null && deps.documents) {
          // The plan file is an ordinary project document (kind plan): the operator opens or downloads it in Knowledge
          // and later asks the Lead to apply it. Saving it never creates tasks.
          try {
            const saved = registerUpload({ raw, store: deps.documents.store, hub, config: deps.documents.config, now: clock,
              afterRegister: deps.documents.afterRegister }, turn.projectId,
              { filename: parsed.csv.fileName, kind: "plan", title: parsed.csv.fileName.replace(/\.csv$/, "") }, "text/csv", Buffer.from(parsed.csv.text, "utf8"));
            systemMessage(turn, `Saved plan file ${parsed.csv.fileName} in Knowledge (version ${saved.version}). To create its tasks, ask the Lead to apply ${parsed.csv.fileName}.`, now);
          } catch (error) {
            systemMessage(turn, error instanceof DocumentError && error.reason === "quota"
              ? `Plan file ${parsed.csv.fileName} was not saved: the project's document quota is full.`
              : `Plan file ${parsed.csv.fileName} could not be saved.`, now);
          }
        }
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
