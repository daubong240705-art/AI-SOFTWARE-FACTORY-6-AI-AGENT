import { useEffect, useId } from 'react';
import { ChevronDown, GitMerge } from 'lucide-react';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { Store } from '@/state/store';
import { relativeTime } from '../Inbox';

export function IntegrationCard({ store }: { store: Store }) {
  const t = useT(); const id = useId(); const state = store.useStoreSelector(s => s);
  useEffect(() => { void store.loadIntegration(); }, [store, state.selectedProjectId]);
  const items = [...state.integration.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 10);
  if (!items.length) return null;
  return <Card className="gap-0 overflow-hidden rounded-xl border-border py-0 shadow-none"><Collapsible>
    <CollapsibleTrigger asChild><Button variant="ghost" className="group h-auto w-full justify-start gap-3 rounded-none p-5 hover:bg-secondary" aria-labelledby={id}><GitMerge className="size-4 text-muted-foreground" /><span id={id} className="font-display text-lg font-semibold">{t('integrationUi.title')}</span><Badge variant="secondary" className="ml-auto text-xs">{state.integration.items.length}</Badge><ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger>
    <CollapsibleContent className="border-t border-border">
      {state.integration.branch && <p className="px-5 pt-4 text-xs text-muted-foreground">{t('integrationUi.target')}: <span className="break-all font-mono">{state.integration.branch}</span></p>}
      {state.errors.integration && <div className="px-5 pt-4"><ErrorNotice error={state.errors.integration} /><Button variant="outline" size="sm" onClick={() => { void store.loadIntegration(); }}>{t('errors.retry')}</Button></div>}
      <ul className="m-0 list-none divide-y divide-border p-0">{items.map(item => <li key={item.taskId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4"><span className="font-mono text-xs">{item.code}</span><span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{item.title}</span><span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span aria-hidden="true" className={cn('size-1.5 rounded-full', item.state === 'merged' ? 'bg-ok' : item.state === 'conflict' ? 'bg-need' : item.state === 'pending' ? 'bg-run' : 'bg-muted-foreground')} />{t(`integrationUi.states.${item.state}`)}</span>{item.state === 'merged' && item.mergeSha && <span className="font-mono text-xs text-muted-foreground" title={item.mergeSha}>{item.mergeSha.slice(0, 7)}</span>}<time dateTime={item.resolvedAt ?? item.createdAt} className="text-xs text-muted-foreground">{relativeTime(item.resolvedAt ?? item.createdAt)}</time></li>)}</ul>
      {state.selectedProjectId && <div className="border-t border-border px-5 py-3"><Button asChild variant="ghost" size="sm"><a href={`#/project/${encodeURIComponent(state.selectedProjectId)}/code`}>{t('codeUi.open')}</a></Button></div>}
    </CollapsibleContent>
  </Collapsible></Card>;
}
