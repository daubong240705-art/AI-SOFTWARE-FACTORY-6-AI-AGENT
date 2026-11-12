import { ChevronDown, Upload } from 'lucide-react';
import type { CodeEffect } from '@/api/codeModels';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import type { Store, StoreState } from '@/state/store';
import { relativeTime } from '../Inbox';
import { CodeCard, CodeStatus } from './CodeCard';

function taskCode(state: StoreState, attemptId: string) {
  const attempt = Object.values(state.details).flatMap(detail => detail.attempts).find(item => item.id === attemptId)
    ?? Object.values(state.liveAttempts).find(item => item.id === attemptId);
  return attempt && (state.tasks.find(task => task.id === attempt.taskId)?.code
    ?? state.integration.items.find(item => item.taskId === attempt.taskId)?.code);
}

function EffectRow({ store, effect }: { store: Store; effect: CodeEffect }) {
  const t = useT(); const state = store.useStoreSelector(s => s);
  const unknown = effect.state === 'unknown' || effect.outcome === 'unknown' || effect.outcome === 'outcome-unknown';
  const status = unknown ? 'unknown' : effect.state;
  const area = `reconcile:${effect.id}`; const code = taskCode(state, effect.attemptId);
  const errorKey = ['auth', 'rejected', 'network', 'timeout', 'other', 'not-pushed'].includes(effect.error ?? '') ? effect.error : 'unknown';
  return <li className="min-w-0 space-y-3 px-5 py-4" aria-busy={Boolean(state.loading[area])}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-sm font-medium">{t(effect.kind === 'git.push-branch' ? 'codeUi.push' : 'codeUi.otherEffect')}</span>
      {code && <span className="font-mono text-xs">{code}</span>}
      <CodeStatus value={status} label={t(`codeUi.states.${status}`)} />
      <time dateTime={effect.completedAt ?? effect.createdAt} title={effect.completedAt ?? effect.createdAt} className="ml-auto text-xs text-muted-foreground">{relativeTime(effect.completedAt ?? effect.createdAt)}</time>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"><span className="break-all font-mono">{effect.remote}</span><span className="break-all font-mono">{effect.branch}</span></div>
    {effect.error && <p className="text-sm text-muted-foreground">{t(`codeUi.errors.${errorKey}`)}</p>}
    {state.errors[area] && <ErrorNotice error={state.errors[area]} />}
    <div className="flex flex-wrap items-start gap-3">
      {unknown && <Button variant="ghost" size="sm" disabled={Boolean(state.loading[area]) || state.session !== 'authenticated'} onClick={() => { void store.reconcileProjectEffect(effect.id); }}>{t('codeUi.reconcile')}</Button>}
      <Collapsible className="min-w-0 flex-1">
        <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="group text-xs text-muted-foreground"><ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />{t('codeUi.technical')}</Button></CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 px-3 pt-2 text-xs text-muted-foreground">
          <p>{t('codeUi.effect')}: <span className="font-mono">{effect.id.slice(0, 8)}</span> · <span className="break-all font-mono">{effect.kind}</span></p>
          <p>{t('codeUi.attempt')}: <span className="font-mono">{effect.attemptId.slice(0, 8)}</span></p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  </li>;
}

export function EffectsSection({ store }: { store: Store }) {
  const t = useT(); const state = store.useStoreSelector(s => s);
  const effects = [...(state.projectEffects ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return <CodeCard title={t('codeUi.pushes')} icon={<Upload aria-hidden="true" className="size-4 text-muted-foreground" />}
    loading={state.projectEffects === null && !state.errors.effects} error={state.errors.effects}
    empty={!effects.length && t('codeUi.emptyEffects')} onRetry={() => { void store.loadEffects(); }}
    meta={<>
      {state.errors.remotes ? <div className="space-y-2"><ErrorNotice error={state.errors.remotes} /><Button size="sm" variant="outline" disabled={Boolean(state.loading.remotes)} onClick={() => { void store.loadRemotes(true); }}>{t('errors.retry')}</Button></div>
        : state.remotes === null ? <Skeleton className="h-3 w-48" /> : <p className="text-xs leading-relaxed text-muted-foreground">{state.remotes.length ? t('codeUi.remotes').replace('{names}', state.remotes.join(', ')) : t('codeUi.noRemotes')}</p>}
    </>}>
    <ul className="m-0 list-none divide-y divide-border p-0">{effects.map(effect => <EffectRow key={effect.id} store={store} effect={effect} />)}</ul>
  </CodeCard>;
}
