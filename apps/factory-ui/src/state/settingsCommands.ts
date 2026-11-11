import type { Command } from '@factory/contracts';

export type SettingsCommand = Extract<Command, { type: 'autonomy.set' | 'standing-approvals.create' | 'standing-approvals.revoke' }>;
export function autonomyPendingKey(subject: 'project' | 'team', ref: string) { return `settings:autonomy:${subject}:${ref}`; }
export function standingPendingKey(id = 'new') { return `settings:standing:${id}`; }
export function settingsPendingKey(command: SettingsCommand) {
  if (command.type === 'autonomy.set') return autonomyPendingKey(command.payload.subject, command.payload.subjectRef);
  return standingPendingKey(command.type === 'standing-approvals.create' ? undefined : command.payload.standingId);
}
