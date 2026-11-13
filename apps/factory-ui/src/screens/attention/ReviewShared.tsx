import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useT } from '../../i18n';
import { readableText } from './presentation';
import { MarkdownContent } from '@/components/MarkdownContent';

export function Fold({ title, children }: { title: string; children: ReactNode }) {
  return <Collapsible className="min-w-0">
    <CollapsibleTrigger asChild><Button variant="ghost" className="group h-auto max-w-full justify-start gap-2 px-0 py-2 text-sm font-normal whitespace-normal text-muted-foreground hover:bg-transparent hover:text-foreground"><ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />{title}</Button></CollapsibleTrigger>
    <CollapsibleContent className="min-w-0 pt-2">{children}</CollapsibleContent>
  </Collapsible>;
}

export function Facts({ rows, mono = false }: { rows: string[][]; mono?: boolean }) {
  return <dl className="grid gap-2 text-sm">{rows.map(([label, value], index) => <div key={index} className="flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-muted-foreground">{label}</dt><dd className={cn('m-0 min-w-0 break-all text-right', mono && 'font-mono text-xs text-muted-foreground')}>{value}</dd></div>)}</dl>;
}

export function AgentSummary({ text }: { text: string }) {
  const t = useT(); const [expanded, setExpanded] = useState(false);
  const long = text.length > 240 || text.split('\n').length > 3;
  // Sanitized markdown (no HTML, only http(s) links); collapsed to a short preview until expanded.
  return <div className="mt-3 max-w-3xl">
    <div className={cn('relative text-muted-foreground', long && !expanded && 'max-h-28 overflow-hidden')}>
      {text ? <MarkdownContent content={readableText(text)} className="text-muted-foreground [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm" /> : <p className="text-sm">{t('reviewUi.noSummary')}</p>}
      {long && !expanded && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent" />}
    </div>
    {long && <Button variant="ghost" size="sm" aria-expanded={expanded} className="mt-1 h-auto px-0 text-xs text-muted-foreground" onClick={() => setExpanded(value => !value)}>{t(expanded ? 'reviewUi.showLess' : 'workUi.showMore')}</Button>}
  </div>;
}
