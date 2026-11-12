import { useT } from '../../i18n';
import { Kbd } from '@/components/ui/kbd';

export function ActionHints() {
  const t = useT();
  return <span className="ml-auto hidden flex-wrap items-center gap-1.5 text-xs font-normal text-muted-foreground xl:inline-flex"><Kbd>J</Kbd><Kbd>K</Kbd> {t('attention.move')}<span aria-hidden="true" className="px-1">·</span><Kbd>A</Kbd> {t('attention.approve')}<span aria-hidden="true" className="px-1">·</span><Kbd>R</Kbd> {t('attention.requestChanges')}</span>;
}
