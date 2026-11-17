import { createHash, randomBytes, randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { Database } from "better-sqlite3";
import type { Cursor } from "@factory/contracts";
import type { ContentStore } from "../artifacts/content-store.js";
import { listTaskArtifacts } from "../artifacts/service.js";
import { getApprovalView } from "../approvals/service.js";
import { listConversations } from "../chat/service.js";
import { findLeadSeat, getPrimaryEngagement } from "../org/service.js";
import type { EventHub } from "../events/hub.js";
import type { createCommandPipeline } from "../commands/pipeline.js";
import type { LeadRunner } from "../lead/runner.js";
import type { PortalOpsService } from "../portalops/service.js";
import { portalProjectId } from "../portalops/project.js";
import { NotifySendError } from "./channels.js";
import type { PushChannel } from "./push.js";

interface TelegramMessage {
  message_id: number; chat?: { id: number | string }; from?: { id: number };
  text?: string; reply_to_message?: { message_id: number };
}
interface TelegramCallback { id: string; from?: { id: number }; data?: string; message?: TelegramMessage }
interface TelegramUpdate { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallback }
interface TelegramFile { bytes: Buffer; mediaType: string; filename: string }
interface CallbackRow { short_id: string; project_id: string; approval_id: string; message_id: number | null }
type NotificationPayload = Parameters<PushChannel["send"]>[0];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const STALE = "Mục này đã được xử lý";
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const optionCodes: Record<string, string> = { accept: "a", "request-changes": "c", approve: "p", reject: "r" };
const optionLabels: Record<string, string> = { accept: "✅ Duyệt", "request-changes": "✏️ Yêu cầu sửa", approve: "✅ Làm", reject: "✖ Không" };

function telegramApiBase(): string {
  const input = process.env.FACTORY_TELEGRAM_API_BASE;
  if (input === undefined) return "https://api.telegram.org";
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new Error("Invalid Telegram API base configuration"); }
}
function responseError(status: number, retry: string | null): NotifySendError {
  if (status === 429) {
    const seconds = retry !== null && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) : NaN;
    const date = retry === null ? NaN : Date.parse(retry);
    return new NotifySendError("retry-later", Number.isFinite(seconds) ? seconds * 1000
      : Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined);
  }
  return new NotifySendError(status >= 300 && status < 500 ? "permanent" : "retryable");
}

/** Only selected fields of successful Telegram responses escape this boundary. Never surface a URL or remote error. */
export class TelegramClient {
  private readonly base = telegramApiBase();
  private readonly fetchImpl: typeof fetch;
  private readonly requests = new Set<AbortController>();
  private artifacts: { raw: Database; store: ContentStore } | undefined;
  constructor(private readonly input: { token: string; fetchImpl?: typeof fetch }) { this.fetchImpl = input.fetchImpl ?? fetch; }
  clean(text: string): string { return text.replaceAll(this.input.token, "[redacted]"); }
  bind(raw: Database, store: ContentStore): void { this.artifacts = { raw, store }; }
  cancelPending(): void { for (const request of this.requests) request.abort(); }
  private async call(method: string, body: Record<string, unknown> | FormData, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController(); this.requests.add(controller);
    try {
      const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(method === "getUpdates" ? 40_000 : 10_000), ...(signal ? [signal] : [])]);
      const response = await this.fetchImpl(`${this.base}/bot${this.input.token}/${method}`, {
        method: "POST", redirect: "manual", signal: combined,
        ...(body instanceof FormData ? { body } : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        const error = responseError(response.status, response.headers.get("retry-after"));
        await response.body?.cancel().catch(() => undefined); throw error;
      }
      const data: unknown = await response.json();
      if (typeof data !== "object" || data === null || !("ok" in data) || data.ok !== true || !("result" in data))
        throw new NotifySendError("retryable");
      return data.result;
    } catch (error) {
      if (error instanceof NotifySendError) throw error;
      throw new NotifySendError("retryable");
    } finally { this.requests.delete(controller); }
  }
  async sendMessage(chatId: string, text: string, replyMarkup?: unknown): Promise<number> {
    const result = await this.call("sendMessage", { chat_id: chatId, text: this.clean(text).slice(0, 4000), disable_web_page_preview: true,
      ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }) });
    if (typeof result !== "object" || result === null || !("message_id" in result) || !Number.isSafeInteger(result.message_id))
      throw new NotifySendError("retryable");
    return result.message_id as number;
  }
  private image(file: TelegramFile): void {
    if (!imageTypes.has(file.mediaType) || file.bytes.length === 0 || file.bytes.length >= MAX_IMAGE_BYTES) throw new NotifySendError("permanent");
  }
  private file(form: FormData, field: string, file: TelegramFile): void {
    form.set(field, new Blob([file.bytes], { type: file.mediaType }), file.filename);
  }
  async sendPhoto(chatId: string, photo: TelegramFile): Promise<void> {
    this.image(photo); const form = new FormData(); form.set("chat_id", chatId); this.file(form, "photo", photo);
    await this.call("sendPhoto", form);
  }
  async sendMediaGroup(chatId: string, photos: readonly TelegramFile[]): Promise<void> {
    if (photos.length < 1 || photos.length > 4) throw new NotifySendError("permanent");
    photos.forEach(photo => this.image(photo));
    // Telegram albums require at least two items.
    if (photos.length === 1) { await this.sendPhoto(chatId, photos[0]!); return; }
    const form = new FormData(); form.set("chat_id", chatId);
    form.set("media", JSON.stringify(photos.map((_, index) => ({ type: "photo", media: `attach://photo${index}` }))));
    photos.forEach((photo, index) => this.file(form, `photo${index}`, photo));
    await this.call("sendMediaGroup", form);
  }
  async sendDocument(chatId: string, markdown: Buffer): Promise<void> {
    const form = new FormData(); form.set("chat_id", chatId);
    this.file(form, "document", { bytes: Buffer.from(this.clean(markdown.toString("utf8"))), mediaType: "text/markdown", filename: "README.md" });
    await this.call("sendDocument", form);
  }
  async editMessageReplyMarkup(chatId: string, messageId: number): Promise<void> {
    await this.call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
  }
  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: id, ...(text === undefined ? {} : { text: this.clean(text).slice(0, 200) }) });
  }
  async sendChatAction(chatId: string): Promise<void> { await this.call("sendChatAction", { chat_id: chatId, action: "typing" }); }
  async getUpdates(offset: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    const result = await this.call("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] }, signal);
    if (!Array.isArray(result)) throw new NotifySendError("retryable");
    return result.filter((value: unknown): value is TelegramUpdate => typeof value === "object" && value !== null
      && "update_id" in value && Number.isSafeInteger(value.update_id) && Number(value.update_id) >= 0);
  }
  async sendApproval(chatId: string, payload: NotificationPayload): Promise<void> {
    const context = this.artifacts, ref = payload.approval;
    if (!context || !ref) { await this.sendMessage(chatId, notificationBody(payload)); return; }
    const approval = getApprovalView(context.raw, ref.projectId, ref.approvalId);
    if (!approval || approval.state !== "pending") { await this.sendMessage(chatId, notificationBody(payload)); return; }
    if (approval.kind === "review" && approval.taskId) {
      const versions = listTaskArtifacts(context.raw, ref.projectId, approval.taskId)
        .flatMap(artifact => artifact.versions.slice(0, 1).map(version => ({ ...version, title: artifact.title })))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version);
      const photos: TelegramFile[] = [];
      for (const version of versions) {
        if (photos.length >= 4 || !imageTypes.has(version.mediaType) || version.sizeBytes >= MAX_IMAGE_BYTES) continue;
        const bytes = context.store.get(version.contentHash);
        if (bytes && bytes.length > 0 && bytes.length < MAX_IMAGE_BYTES) photos.push({ bytes, mediaType: version.mediaType,
          filename: `sample.${version.mediaType === "image/png" ? "png" : version.mediaType === "image/jpeg" ? "jpg" : "webp"}` });
      }
      if (photos.length) await this.sendMediaGroup(chatId, photos);
      const markdown = versions.find(v => v.mediaType === "text/markdown" && /readme/i.test(`${v.fileName ?? ""} ${v.title}`))
        ?? versions.find(v => v.mediaType === "text/markdown");
      if (markdown) { const bytes = context.store.get(markdown.contentHash); if (bytes) await this.sendDocument(chatId, bytes); }
    }
    const shortId = randomBytes(8).toString("hex");
    // No credential or text goes into transport state. A late click always re-reads the current approval.
    context.raw.prepare("INSERT INTO telegram_callbacks(short_id,project_id,approval_id,message_id,created_at) VALUES(?,?,?,NULL,?)")
      .run(shortId, ref.projectId, ref.approvalId, new Date().toISOString());
    const buttons = approval.options.map((option, index) => ({ text: optionLabels[option.id] ?? option.label,
      callback_data: `a|${shortId}|${optionCodes[option.id] ?? String(index)}` }));
    const messageId = await this.sendMessage(chatId, notificationBody(payload), { inline_keyboard: [buttons] });
    context.raw.prepare("UPDATE telegram_callbacks SET message_id=? WHERE short_id=?").run(messageId, shortId);
  }
}
function notificationBody(payload: NotificationPayload): string {
  return `${payload.title}\n${payload.body.trim().slice(0, 3000)}${payload.link ? `\n${payload.link}` : ""}`;
}
export function telegramActorId(userId: number): string {
  const hash = createHash("sha256").update(`factory:telegram:${userId}`).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50; hash[8] = (hash[8]! & 0x3f) | 0x80;
  const h = hash.toString("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
export function telegramAllowedUsers(value: string | undefined, chatId: string): readonly number[] {
  if (value === undefined) return /^[1-9]\d*$/.test(chatId) && Number.isSafeInteger(Number(chatId)) ? [Number(chatId)] : [];
  const ids = value.split(",").map(id => id.trim());
  if (!ids.length || ids.some(id => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))))
    throw new Error("Invalid Telegram allowed users configuration");
  return [...new Set(ids.map(Number))];
}
export interface TelegramTransport { client: TelegramClient; chatId: string; allowedUsers: readonly number[] }
interface TelegramBotDeps extends TelegramTransport {
  raw: Database; hub: EventHub; pipeline: ReturnType<typeof createCommandPipeline>; lead: LeadRunner;
  portalOps: PortalOpsService; kickDispatch(): void; baseUrl?: string;
}
export function startTelegramBot(deps: TelegramBotDeps): { stop(): Promise<void>; ignored(): number } {
  const { raw, client, chatId } = deps, allowed = new Set(deps.allowedUsers), abort = new AbortController();
  const state = (key: string): string | undefined => (raw.prepare("SELECT value FROM telegram_state WHERE key=?").get(key) as { value: string } | undefined)?.value;
  const setState = (key: string, value: string): void => { raw.prepare("INSERT INTO telegram_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value); };
  let offset = Number(state("offset") ?? 0), ignored = Number(state("ignored") ?? 0), stopped = false;
  const subscriptions = new Map<string, () => void>();
  const typing = new Map<string, { projectId: string; expires: number }>();
  let sends = Promise.resolve();
  const enqueue = (run: () => Promise<void>): void => { sends = sends.then(async () => { if (!stopped) await run(); }).catch(() => undefined); };
  const say = (text: string): Promise<number> => client.sendMessage(chatId, text);
  const permitted = (chat: number | string | undefined, user: number | undefined): boolean => {
    if (chat !== undefined && String(chat) === chatId && user !== undefined && allowed.has(user)) return true;
    ignored++; setState("ignored", String(ignored)); return false;
  };
  const chatLink = (projectId: string): string => deps.baseUrl ? `\n${deps.baseUrl}/#/project/${encodeURIComponent(projectId)}/office` : "";
  const watch = (projectId: string): void => {
    if (subscriptions.has(projectId)) return;
    let after: Cursor | null = deps.hub.currentCursor(projectId);
    subscriptions.set(projectId, deps.hub.subscribe(projectId, () => {
      if (!after || stopped) return;
      for (;;) {
        const result = deps.hub.readAfter(projectId, after, 500);
        if (result.kind !== "events") { after = deps.hub.currentCursor(projectId); return; }
        for (const event of result.events) {
          after = event.cursor;
          if (event.payload.type !== "message.appended") continue;
          const message = event.payload.message;
          const telegramConversation = state(`conversation:${projectId}`);
          // Portal action settlement uses the manager's original conversation, even for Telegram approvals.
          const portalResult = message.speaker === "system" && projectId === portalProjectId(raw);
          if (message.speaker === "user" || !telegramConversation || (telegramConversation !== message.conversationId && !portalResult)) continue;
          enqueue(async () => { await say(`${client.clean(message.text).slice(0, 4000 - chatLink(projectId).length)}${chatLink(projectId)}`); });
        }
        if (!result.hasMore) break;
      }
    }));
  };
  // Reattach before the runner resumes pending work after a restart.
  for (const row of raw.prepare("SELECT key FROM telegram_state WHERE key LIKE 'conversation:%'").all() as { key: string }[])
    watch(row.key.slice("conversation:".length));
  for (const turn of raw.prepare("SELECT id,project_id,conversation_id,created_at FROM lead_turns WHERE state IN ('queued','running')").all() as
    { id: string; project_id: string; conversation_id: string; created_at: string }[]) {
    const expires = Date.parse(turn.created_at) + 120_000;
    if (expires > Date.now() && state(`conversation:${turn.project_id}`) === turn.conversation_id)
      typing.set(turn.id, { projectId: turn.project_id, expires });
  }
  const execute = (projectId: string, user: number, type: string, payload: unknown, commandId = randomUUID()) => deps.pipeline.execute({
    apiVersion: 1, projectId, commandId, type, payload,
  }, telegramActorId(user), true);
  const conversation = (projectId: string, user: number): { id: string; revision: number } => {
    let found = listConversations(raw, projectId).find(c => c.id === state(`conversation:${projectId}`) || c.title === "Telegram");
    if (!found) {
      const engagement = getPrimaryEngagement(raw, projectId), lead = engagement && findLeadSeat(raw, engagement.teamId);
      if (!lead) throw new Error("Lead unavailable");
      const id = randomUUID();
      const result = execute(projectId, user, "conversations.create", { conversationId: id, agentId: lead.id, title: "Telegram", workItemId: null });
      if (!result.body.ok) throw new Error("Conversation unavailable");
      found = { id, revision: 1, projectId, agentId: lead.id, title: "Telegram", workItemId: null };
    }
    setState(`conversation:${projectId}`, found.id); watch(projectId); return found;
  };
  const callback = (shortId: string): CallbackRow | undefined => raw.prepare("SELECT * FROM telegram_callbacks WHERE short_id=?").get(shortId) as CallbackRow | undefined;
  const removeButtons = async (row: CallbackRow): Promise<void> => {
    const copies = raw.prepare("SELECT message_id FROM telegram_callbacks WHERE project_id=? AND approval_id=? AND message_id IS NOT NULL")
      .all(row.project_id, row.approval_id) as { message_id: number }[];
    for (const copy of copies) await client.editMessageReplyMarkup(chatId, copy.message_id).catch(() => undefined);
  };
  const decide = async (row: CallbackRow, user: number, option: string, comment: string, queryId?: string): Promise<void> => {
    const approval = getApprovalView(raw, row.project_id, row.approval_id);
    let text = STALE;
    if (approval?.state === "pending") {
      const result = execute(row.project_id, user, "approvals.decide", { approvalId: approval.id, expectedRevision: approval.revision,
        contextDigest: approval.context.digest, optionId: option, comment: client.clean(comment) });
      text = result.body.ok ? option === "request-changes" ? "Đã gửi yêu cầu sửa cho agent." : option === "reject" ? "Đã từ chối." : "Đã duyệt."
        : result.body.error.message;
      if (result.body.ok) deps.kickDispatch();
    }
    if (queryId) await client.answerCallbackQuery(queryId, text).catch(() => undefined);
    await removeButtons(row); await say(text);
  };
  const handleCallback = async (query: TelegramCallback): Promise<void> => {
    if (!permitted(query.message?.chat?.id, query.from?.id)) return;
    const match = /^a\|([a-f0-9]{16})\|([acpr]|\d+)$/.exec(query.data ?? "");
    const row = match ? callback(match[1]!) : undefined;
    if (!row || (row.message_id !== null && row.message_id !== query.message?.message_id)) {
      await client.answerCallbackQuery(query.id, STALE); return;
    }
    const approval = getApprovalView(raw, row.project_id, row.approval_id);
    const code = match![2]!;
    const option = Object.entries(optionCodes).find(([, c]) => c === code)?.[0] ?? approval?.options[Number(code)]?.id;
    if (approval?.state !== "pending") { await decide(row, query.from!.id, option ?? "", "", query.id); return; }
    if (!option || !approval.options.some(o => o.id === option)) { await client.answerCallbackQuery(query.id, "Lựa chọn không hợp lệ."); return; }
    if (row.project_id === portalProjectId(raw)) conversation(row.project_id, query.from!.id);
    if (option !== "request-changes") { await decide(row, query.from!.id, option, "", query.id); return; }
    await client.answerCallbackQuery(query.id);
    const messageId = await client.sendMessage(chatId, "Gõ góp ý cho agent (trong 10 phút):", { force_reply: true, selective: false });
    raw.prepare("INSERT INTO telegram_prompts(message_id,user_id,short_id,expires_at) VALUES(?,?,?,?)")
      .run(messageId, String(query.from!.id), row.short_id, new Date(Date.now() + 600_000).toISOString());
  };
  const sendChat = async (projectId: string, text: string, user: number): Promise<void> => {
    const conv = conversation(projectId, user), messageId = randomUUID();
    const result = execute(projectId, user, "chat.send", { conversationId: conv.id, expectedRevision: conv.revision, messageId,
      text: client.clean(text), attachmentIds: [], intent: "delegate", context: [], draftRevision: null });
    if (!result.body.ok) { await say(result.body.error.message); return; }
    typing.set(messageId, { projectId, expires: Date.now() + 120_000 });
    enqueue(() => client.sendChatAction(chatId)); deps.lead.kick();
  };
  const handleMessage = async (message: TelegramMessage): Promise<void> => {
    if (!permitted(message.chat?.id, message.from?.id) || typeof message.text !== "string") return;
    const user = message.from!.id, text = client.clean(message.text).trim();
    const promptId = message.reply_to_message?.message_id;
    const prompt = promptId === undefined ? undefined : raw.prepare("SELECT short_id,expires_at FROM telegram_prompts WHERE message_id=?")
      .get(promptId) as { short_id: string; expires_at: string } | undefined;
    if (prompt) {
      if (Date.parse(prompt.expires_at) <= Date.now()) { await say("Đã hủy yêu cầu góp ý vì quá 10 phút."); return; }
      if (!text) return;
      // Fence the prompt before deciding. Duplicate replies cannot submit a second decision.
      raw.prepare("UPDATE telegram_prompts SET expires_at=? WHERE message_id=?").run(new Date(0).toISOString(), promptId);
      const row = callback(prompt.short_id); if (row) await decide(row, user, "request-changes", text);
      return;
    }
    if (!text) return;
    const command = /^\/(\w+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(text);
    if (command) {
      const name = command[1], args = command[2]?.trim() ?? "";
      if (name === "start" || name === "help") {
        await say("Gửi tin nhắn để chat với quản trị Portal.\n/pending — xem tối đa 10 phê duyệt\n/stats [gameId] — thống kê 7 ngày\n/game <gameId> <nội dung> — chat với Lead của game\nDùng nút Duyệt / Yêu cầu sửa hoặc Làm / Không để quyết định."); return;
      }
      if (name === "pending") {
        const rows = raw.prepare("SELECT project_id,id,subject,summary FROM approvals WHERE state='pending' AND expires_at>? ORDER BY requested_at,id LIMIT 10")
          .all(new Date().toISOString()) as { project_id: string; id: string; subject: string; summary: string }[];
        if (!rows.length) await say("Không có mục chờ duyệt.");
        for (const row of rows) await client.sendApproval(chatId, { title: `Approval needed: ${row.subject}`, body: row.summary,
          level: "action", urgency: "normal", link: deps.baseUrl ? `${deps.baseUrl}/#/attention` : "",
          approval: { projectId: row.project_id, approvalId: row.id } });
        return;
      }
      if (name === "stats") {
        if (args && !/^[a-z0-9][a-z0-9-]{1,39}$/.test(args)) { await say("Dùng /stats [gameId]."); return; }
        const projectId = portalProjectId(raw);
        if (!projectId) { await say("Portal chưa được cấu hình."); return; }
        const conv = conversation(projectId, user);
        await deps.portalOps.blocks([{ action: "stats", game: args || null, period: "week" }], conv.id); return;
      }
      if (name === "game") {
        const game = /^(\S+)\s+([\s\S]+)$/.exec(args);
        if (!game) { await say("Dùng /game <gameId> <nội dung>."); return; }
        const projects = (raw.prepare("SELECT id,workspace_root FROM projects WHERE disposition!='archived'").all() as { id: string; workspace_root: string }[])
          .filter(p => basename(p.workspace_root) === game[1]);
        if (projects.length !== 1) { await say("Không tìm thấy duy nhất một dự án cho game này."); return; }
        await sendChat(projects[0]!.id, game[2]!, user); return;
      }
      await say("Lệnh không hợp lệ. Gõ /help để xem hướng dẫn."); return;
    }
    if (text.startsWith("/")) { await say("Gõ /help để xem hướng dẫn."); return; }
    const projectId = portalProjectId(raw);
    if (!projectId) { await say("Portal chưa được cấu hình."); return; }
    await sendChat(projectId, text, user);
  };
  const timer = setInterval(() => {
    if (stopped) return;
    for (const [id, turn] of typing) {
      const row = raw.prepare("SELECT state FROM lead_turns WHERE project_id=? AND id=?").get(turn.projectId, id) as { state: string } | undefined;
      if (Date.now() >= turn.expires || !row || !["queued", "running"].includes(row.state)) typing.delete(id);
    }
    if (typing.size) enqueue(() => client.sendChatAction(chatId));
    // Retain expired prompt IDs so a late reply cannot become a new Portal request.
  }, 4000).unref();
  const pause = (ms: number): Promise<void> => new Promise(resolve => {
    const done = (): void => { clearTimeout(timer); abort.signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms); abort.signal.addEventListener("abort", done, { once: true });
    if (abort.signal.aborted) done();
  });
  const poll = async (): Promise<void> => {
    let delay = 5000;
    while (!stopped) {
      try {
        const updates = await client.getUpdates(offset, abort.signal);
        delay = 5000;
        for (const update of updates.sort((a, b) => a.update_id - b.update_id)) {
          if (stopped) break;
          if (update.update_id < offset) continue;
          // Persist before side effects: a crash must never replay a Portal approval or chat request.
          offset = update.update_id + 1; setState("offset", String(offset));
          try {
            if (update.callback_query) await handleCallback(update.callback_query);
            else if (update.message) await handleMessage(update.message);
          } catch { /* Remote errors and arbitrary response text never enter logs or storage. */ }
        }
        // Also tolerate test servers (or a faulty upstream) that return empty polls immediately.
        if (!updates.length) await pause(100);
      } catch {
        if (!stopped) { await pause(delay); delay = Math.min(60_000, delay * 2); }
      }
    }
  };
  const polling = poll();
  return {
    ignored: () => ignored,
    async stop() {
      stopped = true; abort.abort(); clearInterval(timer);
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      client.cancelPending(); await polling; await sends;
    },
  };
}
