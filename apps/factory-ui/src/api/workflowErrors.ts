const messages: Record<string, string> = {
  'workflow not found': 'missing', 'patch not found': 'missing', 'patch limit reached': 'limit',
  'pending patch limit reached': 'pendingLimit', 'invalid patch': 'invalid', 'terminal workflow': 'terminal',
};
export function workflowErrorKey(message: string) {
  return Object.hasOwn(messages, message) ? `planPatch.errors.${messages[message]}` : undefined;
}
