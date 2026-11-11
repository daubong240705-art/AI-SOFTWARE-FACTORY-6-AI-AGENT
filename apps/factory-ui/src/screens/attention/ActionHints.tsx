import { useT } from '../../i18n';

export function ActionHints() {
  const t = useT();
  return <span className="attention-hints"><kbd>J</kbd> <kbd>K</kbd> {t('attention.move')} <kbd>A</kbd> {t('attention.approve')} <kbd>R</kbd> {t('attention.requestChanges')}</span>;
}
