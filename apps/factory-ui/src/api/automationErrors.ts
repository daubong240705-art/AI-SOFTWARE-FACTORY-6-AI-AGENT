// Only fixed messages from the automation handlers become UI detail keys.
// Unknown server text stays private, as it may contain request data.
const messages: Record<string, string> = {
  'project not found': 'projectMissing',
  'schedule not found': 'scheduleMissing',
  'rule not found': 'ruleMissing',
  'monitor not found': 'monitorMissing',
  'revision changed': 'revisionChanged',
  'schedule name already exists': 'duplicateName',
  'rule name already exists': 'duplicateName',
  'monitor name already exists': 'duplicateName',
  'schedule id already exists': 'duplicateId',
  'rule id already exists': 'duplicateId',
  'monitor id already exists': 'duplicateId',
  'schedule limit reached': 'scheduleLimit',
  'rule limit reached': 'ruleLimit',
  'monitor limit reached': 'monitorLimit',
  'invalid schedule input': 'scheduleInvalid',
  'invalid rule input': 'ruleInvalid',
  'invalid monitor input': 'monitorInvalid',
  'invalid schedule timezone': 'timezoneInvalid',
  'invalid cron expression': 'cronInvalid',
  'cron has no future occurrence': 'cronFuture',
  'cron interval must be at least 60 seconds': 'cronInterval',
  'once must be in the future': 'onceFuture',
  'ambiguous workflow definition': 'workflowAmbiguous',
  'workflow definition not found': 'workflowMissing',
  'invalid workflow definition': 'workflowInvalid',
  'invalid workflow parameters': 'workflowParameters',
};
export function automationErrorKey(message: string) {
  return Object.hasOwn(messages, message) ? `automationWrite.hostErrors.${messages[message]}` : undefined;
}
