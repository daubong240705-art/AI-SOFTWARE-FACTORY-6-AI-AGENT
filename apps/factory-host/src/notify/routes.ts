import { notifyStatusSchema, notifyTestResponseSchema } from "@factory/contracts";
import type { FastifyInstance } from "fastify";
import type { ApiGuards } from "../api/server.js";
import { failure } from "../api/http.js";
import { createIdGenerator } from "../ids.js";
import { NotifySendError, type ExternalNotifications } from "./channels.js";
import { notificationLink } from "./push.js";

export function registerNotifyRoutes(app: FastifyInstance, guards: ApiGuards, config: ExternalNotifications,
  inbound?: { ignored(): number }): void {
  const newId = createIdGenerator();
  app.get("/system/notify", { preHandler: guards.session }, async () => notifyStatusSchema.parse({
    telegram: config.channels.some((channel) => channel.name === "telegram"),
    discord: config.channels.some((channel) => channel.name === "discord"), baseUrl: Boolean(config.baseUrl),
    telegramInbound: Boolean(inbound), telegramIgnored: inbound?.ignored() ?? 0,
  }));
  app.post("/notify/test", { preHandler: guards.write }, async (_request, reply) => {
    if (!config.channels.length) return failure(reply, 404, "not-found", "Notifications not configured.", "correct-input", newId);
    const channels = await Promise.all(config.channels.map(async (channel) => {
      try {
        await channel.send({ title: "Thông báo thử từ Factory", body: "", level: "action", urgency: "normal",
          link: notificationLink(config.baseUrl, "action", "") });
        return { name: channel.name, ok: true, error: null };
      } catch (error) {
        return { name: channel.name, ok: false, error: error instanceof NotifySendError ? error.kind : "retryable" };
      }
    }));
    return notifyTestResponseSchema.parse({ channels });
  });
}
