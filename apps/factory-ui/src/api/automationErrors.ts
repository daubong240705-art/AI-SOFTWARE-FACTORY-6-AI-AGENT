// Only fixed messages from the automation handlers become UI detail keys.
// Unknown server text stays private, as it may contain request data.
const messages: Record<string, string> = {
  'project not found': 'projectMissing',
  'rule not found': 'ruleMissing',
  'monitor not found': 'monitorMissing',
  'revision changed': 'revisionChanged',
  'rule name already exists': 'duplicateName',
  'monitor name already exists': 'duplicateName',
  'rule id already exists': 'duplicateId',
  'monitor id already exists': 'duplicateId',
  'rule limit reached': 'ruleLimit',
  'monitor limit reached': 'monitorLimit',
  'invalid rule input': 'ruleInvalid',
  'invalid monitor input': 'monitorInvalid',
};
export function automationErrorKey(message: string) {
  return Object.hasOwn(messages, message) ? `automationWrite.hostErrors.${messages[message]}` : undefined;
}
