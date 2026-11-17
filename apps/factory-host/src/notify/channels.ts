import type { PushChannel } from "./push.js";
import { TelegramClient, telegramAllowedUsers, type TelegramTransport } from "./telegram-bot.js";

export type NotifyErrorKind = "retry-later" | "permanent" | "retryable";

export class NotifySendError extends Error {
  constructor(readonly kind: NotifyErrorKind, readonly retryAfterMs?: number) {
    super(kind);
    this.name = "NotifySendError";
  }
}

type FetchLike = typeof fetch;
const responseError = (status: number, retryAfter: string | null): NotifySendError => {
  if (status === 429) {
    const seconds = retryAfter !== null && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : NaN;
    const parsedDate = retryAfter === null ? NaN : Date.parse(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(parsedDate) ? Math.max(0, parsedDate - Date.now()) : undefined;
    return new NotifySendError("retry-later", delay);
  }
  return new NotifySendError(status >= 300 && status < 500 ? "permanent" : "retryable");
};
const post = async (url: string, body: unknown, fetchImpl: FetchLike): Promise<void> => {
  try {
    const response = await fetchImpl(url, { method: "POST", redirect: "manual", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const error = response.ok ? null : responseError(response.status, response.headers.get("retry-after"));
    // Never consume remote response bodies (which can contain credentials or arbitrary error text).
    await response.body?.cancel().catch(() => undefined);
    if (error) throw error;
  } catch (error) {
    if (error instanceof NotifySendError) throw error;
    throw new NotifySendError("retryable");
  }
};

export function notificationText(payload: Parameters<PushChannel["send"]>[0]): string {
  return `${payload.title}\n${Array.from(payload.body.trim()).slice(0, 300).join("")}${payload.link ? `\n${payload.link}` : ""}`;
}

function validateTelegram(botToken: string, chatId: string): void {
  if (/\s/.test(botToken) || !/^[1-9]\d{4,19}:[A-Za-z0-9_-]{35}$/.test(botToken)) throw new Error("Invalid Telegram bot token configuration");
  if (/\s/.test(chatId) || !/^(?:-?[1-9]\d{0,19}|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(chatId)) throw new Error("Invalid Telegram chat configuration");
}

function validateDiscord(webhookUrl: string): void {
  if (/\s/.test(webhookUrl) || !/^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/[1-9]\d{16,19}\/[A-Za-z0-9_-]{60,100}$/.test(webhookUrl))
    throw new Error("Invalid Discord webhook configuration");
}

export function createTelegramChannel(input: { botToken: string; chatId: string; fetchImpl?: FetchLike; client?: TelegramClient }): PushChannel {
  validateTelegram(input.botToken, input.chatId);
  const client = input.client ?? new TelegramClient({ token: input.botToken, ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }) });
  return { name: "telegram", async send(payload) {
    if (payload.approval) await client.sendApproval(input.chatId, payload);
    else await client.sendMessage(input.chatId, notificationText(payload));
  } };
}

export function createDiscordChannel(input: { webhookUrl: string; fetchImpl?: FetchLike }): PushChannel {
  validateDiscord(input.webhookUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  return { name: "discord", async send(payload) {
    await post(input.webhookUrl, { content: notificationText(payload) }, fetchImpl);
  } };
}

export function createFanOutChannel(channels: readonly PushChannel[]): PushChannel {
  return { name: "external", async send(payload) {
    const results = await Promise.allSettled(channels.map(async (channel) => channel.send(payload)));
    if (results.some((result) => result.status === "fulfilled")) return;
    const errors = results.flatMap((result) => result.status === "rejected" && result.reason instanceof NotifySendError ? [result.reason] : []);
    // Keep retrying if any destination could recover. Stop only when every destination is permanent.
    const limited = errors.filter((error) => error.kind === "retry-later");
    if (limited.length) throw new NotifySendError("retry-later", Math.max(...limited.map((error) => error.retryAfterMs ?? 300_000)));
    if (errors.length !== results.length || errors.some((error) => error.kind === "retryable")) throw new NotifySendError("retryable");
    throw new NotifySendError("permanent");
  } };
}

export interface ExternalNotifications { channels: readonly PushChannel[]; baseUrl?: string; telegram?: TelegramTransport }

export function notificationConfig(input: {
  botToken?: string; chatId?: string; webhookUrl?: string; baseUrl?: string; fetchImpl?: FetchLike; allowedUsers?: string;
}): ExternalNotifications {
  let baseUrl: string | undefined;
  if (input.baseUrl !== undefined) {
    try {
      if (!/^https?:\/\/[^/]/.test(input.baseUrl) || input.baseUrl.length > 2048 || /[\s\\?#]/.test(input.baseUrl)) throw new Error();
      const url = new URL(input.baseUrl);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
      baseUrl = url.href.replace(/\/+$/, "");
    } catch { throw new Error("Invalid notification base URL configuration"); }
  }
  if ((input.botToken === undefined) !== (input.chatId === undefined)) throw new Error("Telegram requires both bot token and chat ID");
  const channels: PushChannel[] = [];
  let telegram: TelegramTransport | undefined;
  const fetchOption = input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl };
  if (input.botToken !== undefined && input.chatId !== undefined) {
    validateTelegram(input.botToken, input.chatId);
    const client = new TelegramClient({ token: input.botToken, ...fetchOption });
    telegram = { client, chatId: input.chatId, allowedUsers: telegramAllowedUsers(input.allowedUsers, input.chatId) };
    channels.push(createTelegramChannel({ botToken: input.botToken, chatId: input.chatId, client }));
  }
  if (input.webhookUrl !== undefined) channels.push(createDiscordChannel({ webhookUrl: input.webhookUrl, ...fetchOption }));
  return { channels, ...(baseUrl === undefined ? {} : { baseUrl }), ...(telegram === undefined ? {} : { telegram }) };
}
