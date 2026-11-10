import { z } from "zod";
import { idSchema, timestampSchema } from "./base.js";

export const REMINDER_FRACTIONS = [0.5, 0.9] as const;
export const QUIET_HOURS = { startHour: 22, endHour: 7 } as const;
export const DIGEST_HOUR = 18;
export const PUSH_MAX_ATTEMPTS = 3;
export const PUSH_RETRY_MS = 300_000;
export const notificationCategorySchema = z.enum(["action", "important", "digest"]);
export const notificationUrgencySchema = z.enum(["normal", "urgent"]);
export const notificationStateSchema = z.enum(["unread", "read", "dismissed"]);
export const notificationViewSchema = z.strictObject({
  id: idSchema, category: notificationCategorySchema, urgency: notificationUrgencySchema,
  title: z.string().min(1).max(200), body: z.string().max(1000),
  entityKind: z.string().nullable(), entityId: idSchema.nullable(), state: notificationStateSchema,
  createdAt: timestampSchema, readAt: timestampSchema.nullable(),
}).refine((value) => (value.state === "unread") === (value.readAt === null), "Invalid read timestamp");
export const notificationIdPayloadSchema = z.strictObject({ notificationId: idSchema });
export type NotificationView = z.infer<typeof notificationViewSchema>;
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;
export type NotificationUrgency = z.infer<typeof notificationUrgencySchema>;
