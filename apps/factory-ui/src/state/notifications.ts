import type { Command } from '@factory/contracts';
import type { IntegrationResponse, NotificationsResponse } from '../api/notificationModels';

export type NotificationCommand = Extract<Command, { type: 'notifications.mark-read' | 'notifications.dismiss' }>;
export type IntegrationCommand = Extract<Command, { type: 'integration.retry' | 'integration.skip' }>;
export const notificationPendingKey = (id: string) => `notifications:${id}`;
export const integrationPendingKey = (id: string) => `integration:${id}`;
export const emptyNotifications = (): NotificationsResponse => ({ items: [], unread: 0 });
export const emptyIntegration = (): IntegrationResponse => ({ branch: null, items: [] });
