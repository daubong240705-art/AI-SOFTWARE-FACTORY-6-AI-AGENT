import { idSchema, successResponseSchema, textSchema, usageSchema } from '@factory/contracts';

const ok = successResponseSchema.pick({ ok: true, apiVersion: true });
const object = ok.omit({ ok: true, apiVersion: true });
const text = textSchema.min(0);
const date = text.refine(value => Number.isFinite(Date.parse(value)));
const enumeration = <T extends string>(values: readonly T[]) => text.transform(value => values.find(item => item === value) ?? 'unknown');
const notification = object.extend({
  id: idSchema, category: enumeration(['action', 'important', 'digest'] as const),
  urgency: enumeration(['normal', 'urgent'] as const), title: text, body: text,
  entityKind: text.nullable(), entityId: idSchema.nullable(),
  state: enumeration(['unread', 'read', 'dismissed'] as const), createdAt: date, readAt: date.nullable(),
}).strip();
const integrationItem = object.extend({
  taskId: idSchema, code: text, title: text, state: enumeration(['pending', 'merged', 'conflict', 'skipped'] as const),
  branch: text, mergeSha: text.nullable(), errorKind: text.nullable(), createdAt: date, resolvedAt: date.nullable(),
}).strip();
export const notificationReadModels = {
  // These Host endpoints return plain objects. Strip optional envelope fields too.
  notifications: object.extend({ items: notification.array(), unread: usageSchema.shape.inputTokens }).strip(),
  integration: object.extend({ branch: text.nullable(), items: integrationItem.array() }).strip(),
};
export type NotificationItem = ReturnType<typeof notification.parse>;
export type NotificationsResponse = ReturnType<typeof notificationReadModels.notifications.parse>;
export type IntegrationResponse = ReturnType<typeof notificationReadModels.integration.parse>;
