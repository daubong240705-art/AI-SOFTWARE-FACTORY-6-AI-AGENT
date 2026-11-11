import type { Extraction } from '@/api/documents';
import { Button } from '@/components/ui/button';
import { i18n, useT } from '@/i18n';

const indents = ['pl-3', 'pl-6', 'pl-9', 'pl-12', 'pl-15', 'pl-18'];
export function ExtractionOutline({ entries, onSelect }: { entries: Extraction['outline']; onSelect: (entry: Extraction['outline'][number]) => void }) {
  const t = useT();
  if (!entries.length) return <p className="rounded-xl border border-border p-5 text-sm text-muted-foreground">{t('knowledgeUi.extraction.noOutline')}</p>;
  return <ul aria-label={t('knowledgeUi.extraction.outlineTab')} className="max-h-[55dvh] list-none space-y-1 overflow-auto rounded-xl border border-border p-2">
    {entries.map((entry, index) => <li key={`${entry.offset}-${index}`}><Button variant="ghost" className={`h-auto w-full justify-between gap-4 py-2 pr-3 text-left font-normal whitespace-normal text-muted-foreground ${indents[entry.level - 1] ?? indents[0]}`} onClick={() => onSelect(entry)}>
      <span className="min-w-0 [overflow-wrap:anywhere]">{entry.title}</span>{entry.page !== null && <span className="shrink-0 font-mono text-xs">{t('knowledgeUi.extraction.pageShort').replace('{page}', new Intl.NumberFormat(i18n.locale).format(entry.page))}</span>}
    </Button></li>)}
  </ul>;
}
