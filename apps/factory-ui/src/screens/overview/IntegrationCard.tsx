import { useEffect, useId } from 'react';
import { ChevronDown, GitMerge } from 'lucide-react';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Section, StatusDot, TechDetails } from '@/components/app';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useT } from '@/i18n';
import { toneOf } from '@/lib/status';
import type { Store } from '@/state/store';
import { relativeTime } from '@/lib/inbox';

export function IntegrationCard({ store }: { store: Store }) {
  const t = useT(); const id = useId(); const state = store.useStoreSelector(s => s);
  useEffect(() => { void store.loadIntegration(); }, [store, state.selectedProjectId]);
  const items = [...state.integration.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 10);
  if (!items.length) return null;
  return <Collapsible><Section title={<span id={id}>{t('integrationUi.title')}</span>} actions={<CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="group" aria-describedby={id}><GitMerge className="size-4 text-muted-foreground" />{t('taskUi.details')}<Badge variant="secondary" className="text-xs">{state.integration.items.length}</Badge><ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger>}>
    <CollapsibleContent className="space-y-3">
      {state.integration.branch && <TechDetails><p className="text-xs text-muted-foreground">{t('integrationUi.target')}: <span className="break-all font-mono">{state.integration.branch}</span></p></TechDetails>}
      {state.errors.integration && <div className="space-y-2"><ErrorNotice error={state.errors.integration} /><Button variant="outline" size="sm" onClick={() => { void store.loadIntegration(); }}>{t('errors.retry')}</Button></div>}
      <ul className="m-0 list-none divide-y divide-border p-0">{items.map(item => <li key={item.taskId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-3"><span className="font-mono text-xs">{item.code}</span><span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{item.title}</span><StatusDot tone={toneOf('task', item.state === 'merged' ? 'done' : item.state === 'conflict' ? 'blocked' : item.state === 'pending' ? 'active' : item.state)} label={t(`integrationUi.states.${item.state}`)} />{item.state === 'merged' && item.mergeSha && <TechDetails identifier={item.mergeSha} />}<time dateTime={item.resolvedAt ?? item.createdAt} className="text-xs text-muted-foreground">{relativeTime(item.resolvedAt ?? item.createdAt)}</time></li>)}</ul>
      {state.selectedProjectId && <div className="border-t border-border px-2 py-3"><Button asChild variant="ghost" size="sm"><a href={`#/project/${encodeURIComponent(state.selectedProjectId)}/code`}>{t('codeUi.open')}</a></Button></div>}
    </CollapsibleContent>
  </Section></Collapsible>;
}
