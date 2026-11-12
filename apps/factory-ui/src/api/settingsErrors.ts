// Translate only fixed Host messages, following automationErrors.
const messages: Record<string, string> = {
  'project not found': 'projectMissing',
  'team not found': 'teamMissing',
  'project subject must match project id': 'projectMismatch',
  'project scope must match project id': 'projectMismatch',
  'autonomy revision changed': 'revisionChanged',
  'autonomy setting does not exist': 'settingMissing',
  'standing approval revision changed': 'revisionChanged',
  'standing approval not found': 'approvalMissing',
  'standing approval id already exists': 'duplicateId',
  'active standing approval limit reached': 'approvalLimit',
  'standing approval must expire in the future within 30 days': 'expiryInvalid',
  'invalid standing approval': 'approvalInvalid',
  'Unsupported standing action kind': 'actionInvalid',
};
export function settingsErrorKey(message: string) {
  return Object.hasOwn(messages, message) ? `settingsWrite.hostErrors.${messages[message]}` : undefined;
}
