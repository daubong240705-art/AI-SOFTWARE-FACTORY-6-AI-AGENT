import { readableText } from '../artifactPresentation';

export { readableText, briefBeyondGoal } from '../artifactPresentation';

export function attentionTitle(title: string): string {
  return readableText(title.replace(/^(?:(?:review|duyệt|xét duyệt|question|câu hỏi)\s*:\s*)+/i, '')
    .replace(/^review\s+/i, '').trim());
}
