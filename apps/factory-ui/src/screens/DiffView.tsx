import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT, i18n } from '../i18n';
import { parseDiff } from '../state/diff';

export function DiffView({ patch }: { patch: string }) {
  const t = useT();
  const parsed = useMemo(() => parseDiff(patch), [patch]);
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  let remaining = 20_000 * page;
  let more = false;
  return <Card className="max-h-[32rem] min-w-0 gap-0 overflow-auto rounded-xl border-border bg-card py-2 shadow-none" role="region" aria-label={t('workUi.diff')} tabIndex={0}>
    {parsed.files.map((file, index) => {
      const limit = Math.max(0, Math.min(file.lines.length, 5000 * page, remaining));
      remaining -= limit;
      if (limit < file.lines.length) more = true;
      const closed = collapsed[index] ?? (parsed.files.length > 10 && index > 0);
      return <Collapsible open={!closed} onOpenChange={open => setCollapsed(value => ({ ...value, [index]: !open }))} className="min-w-max" key={index}>
        <CollapsibleTrigger asChild><Button variant="ghost" className="group sticky left-0 h-auto max-w-full justify-start rounded-none px-4 py-2 font-mono text-xs text-muted-foreground"><ChevronDown className="size-3 transition-transform group-data-[state=closed]:-rotate-90" />{file.name.replace(/^a\/(.*?) b\/(.*)$/, '$2') || t('workUi.unnamed')}</Button></CollapsibleTrigger>
        <CollapsibleContent><pre className="m-0 w-full min-w-max font-mono text-[13px] leading-[1.7]">{file.lines.slice(0, limit).map((line, row) => <span className={cn('flex min-w-max border-l-2 border-transparent pr-4', line.kind === 'added' && 'border-l-ok bg-ok/10 text-ok', line.kind === 'removed' && 'border-l-destructive bg-destructive/10 text-destructive', line.kind === 'hunk' && 'bg-muted text-muted-foreground')} key={row}>
          <span className="w-10 shrink-0 pr-2 text-right text-xs text-muted-foreground select-none" aria-hidden="true">{line.oldLine === undefined ? '' : new Intl.NumberFormat(i18n.locale, { useGrouping: false }).format(line.oldLine)}</span>
          <span className="w-10 shrink-0 pr-3 text-right text-xs text-muted-foreground select-none" aria-hidden="true">{line.newLine === undefined ? '' : new Intl.NumberFormat(i18n.locale, { useGrouping: false }).format(line.newLine)}</span>
          {(line.kind === 'added' || line.kind === 'removed') && <span className="sr-only">{t(line.kind === 'added' ? 'workUi.added' : 'workUi.removed')} </span>}
          <span aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}</span><span>{line.text}</span>
        </span>)}</pre></CollapsibleContent>
      </Collapsible>;
    })}
    {more && <Button variant="ghost" className="m-2 self-start" onClick={() => setPage(value => value + 1)}>{t('workUi.showMore')}</Button>}
    {parsed.truncated && <p role="status" className="px-4 py-2 text-xs text-muted-foreground">{t('workUi.truncated')}</p>}
  </Card>;
}
