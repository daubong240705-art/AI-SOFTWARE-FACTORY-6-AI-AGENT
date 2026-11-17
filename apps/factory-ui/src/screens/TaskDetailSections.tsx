import type { Task } from '@factory/contracts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Section } from '@/components/app';
import { ErrorNotice } from '../components/ErrorNotice';
import type { Attempt } from '../api/client';
import { useT } from '../i18n';
import type { Store, TaskDetailState } from '../state/store';
import { shallowSelectionEqual } from '../state/storeSelector';
import { pendingApproval } from './DecisionDialog';
import { AttemptTimeline } from './agent/AttemptTimeline';
import { readableText } from './attention/presentation';

export function TaskOverview({ store, task, onOpenTask }: { store: Store; task: Task; onOpenTask?: (id: string) => void }) {
  const t = useT();
  const state = store.useStoreSelector(value => ({ tasks: value.tasks }), shallowSelectionEqual);
  return <div className="space-y-6 text-sm">
    <Section title={t('taskUi.goal')}><p className="whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">{readableText(task.goal)}</p></Section>
    <Section title={t('taskUi.acceptance')}><ul className="space-y-2">{task.acceptance.map((item, index) => <li className="flex gap-2 leading-relaxed whitespace-pre-wrap" key={index}><span aria-hidden="true">□</span><span>{readableText(item)}</span></li>)}</ul></Section>
    <Section title={t('taskUi.dependencies')}>
      {task.dependsOn.length ? <ul className="space-y-2">{task.dependsOn.map(dependency => { const target = state.tasks.find(item => item.id === dependency); return <li key={dependency}>{onOpenTask && target ? <Button type="button" variant="link" className="h-auto p-0 font-mono" onClick={() => onOpenTask(target.id)}>{target.code}</Button> : <span className="font-mono">{target?.code ?? dependency}</span>}</li>; })}</ul> : <p className="text-muted-foreground">{t('taskUi.dash')}</p>}
    </Section>
  </div>;
}

export function PendingReviews({ detail, onDecision }: { detail: TaskDetailState; onDecision: (id: string) => void }) {
  const t = useT();
  const items = detail.approvals.filter(item => pendingApproval(item) && (item.kind === 'review' || item.kind === 'question'));
  if (!items.length) return null;
  return <Section title={t('workUi.pendingDecisions')}>{items.length ? <ul className="space-y-3">{items.map(item => <li key={item.id} className="space-y-2 border-l-2 border-need pl-3"><p className="font-medium">{t(item.kind === 'review' ? 'inboxUi.review' : 'inboxUi.question')}</p><p className="whitespace-pre-wrap text-muted-foreground">{readableText(item.subject)}</p><Button type="button" size="sm" onClick={() => onDecision(item.id)}>{t('workUi.decide')}</Button></li>)}</ul> : <p className="text-muted-foreground">{t('taskUi.dash')}</p>}</Section>;
}

export function TaskProgress({ store, taskId, detail, attempt }: { store: Store; taskId: string; detail: TaskDetailState | undefined; attempt: Attempt | undefined }) {
  const t = useT(); const { error } = store.useStoreSelector(value => ({ error: attempt ? value.errors[`attempt-events:${taskId}:${attempt.id}`] : undefined }), shallowSelectionEqual);
  return <div className="space-y-3">{error && <><ErrorNotice error={error} /><Button type="button" variant="outline" size="sm" onClick={() => { if (attempt) void store.loadAttemptEvents(taskId, attempt.id); }}>{t('errors.retry')}</Button></>}<AttemptTimeline attempts={detail?.attempts ?? []} events={detail?.events ?? {}} onLoadAttempt={id => { void store.loadAttemptEvents(taskId, id); }} /></div>;
}

export function TaskHistory({ detail }: { detail: TaskDetailState }) {
  const t = useT();
  return <Section title={t('inboxUi.history')}>{!detail.approvals.length ? <p className="text-muted-foreground">{t('inboxUi.noHistory')}</p> : <ul className="space-y-4">{[...detail.approvals].sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt)).map(item => <li key={item.id} className="space-y-2 border-t border-border pt-3"><div className="flex flex-wrap items-center gap-2"><strong className="font-medium">{readableText(item.subject)}</strong><Badge variant="secondary">{t(`inboxUi.states.${item.state}`)}</Badge></div>{item.outcome && <><p>{readableText(item.options.find(option => option.id === item.outcome?.optionId)?.label ?? '')}</p><p className="whitespace-pre-wrap text-muted-foreground">{readableText(item.outcome.comment ?? '')}</p></>}</li>)}</ul>}</Section>;
}
