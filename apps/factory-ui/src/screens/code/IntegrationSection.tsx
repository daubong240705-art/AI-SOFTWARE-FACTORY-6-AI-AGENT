import { GitBranch, GitMerge } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { relativeTime } from '../Inbox';
import { CodeCard, CodeStatus } from './CodeCard';
import { ConflictActions } from './ConflictActions';

export function IntegrationSection({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT(); const state = store.useStoreSelector(s => s);
  const items = [...state.integration.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const firstLoad = Boolean(state.loading.integration && !items.length && !state.integration.branch);
  return <CodeCard title={t('codeUi.integration')} icon={<GitMerge aria-hidden="true" className="size-4 text-muted-foreground" />}
    loading={firstLoad} error={state.errors.integration} onRetry={() => { void store.loadIntegration(); }}
    empty={!items.length && t('codeUi.emptyIntegration')}
    meta={<>
      {!firstLoad && <p className="break-all font-mono text-xs text-muted-foreground">{state.integration.branch ?? t('codeUi.noBranch')}</p>}
      <div className="flex flex-wrap gap-2">{(['merged', 'pending', 'conflict', 'skipped'] as const).map(value => <Badge key={value} variant="outline" className="gap-2 rounded-full px-2.5 py-1 font-normal">
        <CodeStatus value={value} label={t(`codeUi.states.${value}`)} /><span className="text-xs tabular-nums text-muted-foreground">{items.filter(item => item.state === value).length}</span>
      </Badge>)}</div>
    </>}>
    <ul className="m-0 list-none divide-y divide-border p-0">{items.map(item => <li key={item.taskId} className="min-w-0 space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="font-mono text-xs leading-5">{item.code}</span><span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{item.title}</span>
        <CodeStatus value={item.state} label={t(`codeUi.states.${item.state === 'unknown' ? 'unrecognized' : item.state}`)} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex min-w-0 items-start gap-1.5"><GitBranch aria-hidden="true" className="size-3.5 shrink-0" /><span className="break-all font-mono">{item.branch}</span></span>
        {item.state === 'merged' && item.mergeSha && <span className="font-mono" title={item.mergeSha}>{item.mergeSha.slice(0, 8)}</span>}
        <time dateTime={item.resolvedAt ?? item.createdAt} title={item.resolvedAt ?? item.createdAt}>{relativeTime(item.resolvedAt ?? item.createdAt)}</time>
      </div>
      {item.errorKind && <p className="text-sm leading-relaxed text-muted-foreground">{t(`integrationUi.errors.${item.errorKind === 'conflict' || item.errorKind === 'git-failed' ? item.errorKind : 'unknown'}`)}</p>}
      {item.state === 'conflict' && <ConflictActions store={store} projectId={projectId} item={item} />}
    </li>)}</ul>
  </CodeCard>;
}
