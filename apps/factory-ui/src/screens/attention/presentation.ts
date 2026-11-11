import { i18n } from '../../i18n';

/** Host record names are useful for diagnostics, but are not review copy. */
export function readableText(text: string): string {
  return text.replace(/\bepochs?\b/gi, i18n.t('reviewUi.attempt'))
    .replace(/\bartifacts?\b/gi, i18n.t('reviewUi.document'))
    .replace(/\brevisions?\b/gi, i18n.t('reviewUi.record'));
}

export function attentionTitle(title: string): string {
  return readableText(title.replace(/^(?:(?:review|duyệt|xét duyệt|question|câu hỏi)\s*:\s*)+/i, '')
    .replace(/^review\s+/i, '').trim());
}
