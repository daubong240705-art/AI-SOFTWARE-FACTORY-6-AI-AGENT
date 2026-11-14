import { i18n } from '../i18n';

/** Host record names are useful for diagnostics, but are not review copy. */
export function readableText(text: string): string {
  return text.replace(/\bepochs?\b/gi, i18n.t('reviewUi.attempt'))
    .replace(/\bartifacts?\b/gi, i18n.t('reviewUi.document'))
    .replace(/\brevisions?\b/gi, i18n.t('reviewUi.record'));
}

/** The task brief only when it says more than the goal; older tasks stored the goal as their brief. */
export function briefBeyondGoal(goal: string, brief: string): string | null {
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
  return clean(brief) && clean(brief) !== clean(goal) ? brief : null;
}

export function artifactTitle(title: string): string {
  const match = /^(summary|changes)\s+(.+?)\s*\(epoch\s+(\d+)\)$/i.exec(title.trim());
  if (!match) return readableText(title);
  const label = i18n.t(match[1]?.toLowerCase() === 'summary' ? 'reviewUi.summary' : 'reviewUi.changes');
  return `${label} ${match[2]} · ${i18n.t('reviewUi.attempt').toLocaleLowerCase(i18n.locale)} ${match[3]}`;
}
