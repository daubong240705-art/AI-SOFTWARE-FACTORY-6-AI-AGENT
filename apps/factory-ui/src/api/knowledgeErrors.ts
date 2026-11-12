const messages: Record<string, string> = {
  'visibility-not-allowed': 'knowledgeWrite.visibilityDenied',
};

export function knowledgeErrorKey(message: string) {
  return Object.hasOwn(messages, message) ? messages[message] : undefined;
}
