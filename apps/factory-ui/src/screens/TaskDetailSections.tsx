import { isLiveAttempt, type Task } from '@factory/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ErrorNotice } from '../components/ErrorNotice';
import type { Attempt } from '../api/client';
import { i18n, useT } from '../i18n';
import type { Store, TaskDetailState } from '../state/store';
import { pendingApproval } from './DecisionDialog';
import { ProgressTimeline } from './ProgressTimeline';
import { Facts } from './attention/ReviewShared';
import { briefBeyondGoal, readableText } from './attention/presentation';

export function TaskOverview({ store, task }: { store: Store; task: Task }) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  return <>
    <Card className="gap-3 border-border p-5 text-sm shadow-none"><h3 className="font-semibold">{t('taskUi.goal')}</h3><p className="leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{readableText(task.goal)}</p>{briefBeyondGoal(task.goal, task.brief) && <p className="leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{readableText(task.brief)}</p>}<Separator /><h3 className="font-semibold">{t('taskUi.acceptance')}</h3><ul className="list-disc space-y-2 pl-5">{task.acceptance.map((item, index) => <li className="leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]" key={index}>{readableText(item)}</li>)}</ul></Card>
    <Card className="gap-4 border-border p-5 text-sm shadow-none"><h3 className="font-semibold">{t('taskUi.dependencies')}</h3>{task.dependsOn.length ? <ul className="flex flex-wrap gap-2">{task.dependsOn.map(dependency => <li key={dependency}><Badge variant="secondary" className="font-mono">{state.tasks.find(item => item.id === dependency)?.code ?? dependency}</Badge></li>)}</ul> : <p className="text-muted-foreground">{t('taskUi.dash')}</p>}<Separator /><h3 className="font-semibold">{t('workUi.holds')}</h3>{task.holds.length ? <ul className="space-y-3">{task.holds.map((hold, index) => <li key={index} className="space-y-1"><Badge variant="outline" className={hold.needsAction ? 'border-need/30 text-need' : ''}>{t(`workUi.holdKinds.${hold.kind}`)}</Badge><p className="text-muted-foreground [overflow-wrap:anywhere]">{readableText(hold.reason)}</p></li>)}</ul> : <p className="text-muted-foreground">{t('taskUi.dash')}</p>}<Separator /><Facts rows={(['placement', 'sideEffect', 'reviewPolicy'] as const).map(policy => [t(`taskUi.${policy}`), readableText(t(`taskUi.${policy === 'placement' ? 'placements' : policy === 'sideEffect' ? 'sideEffects' : 'reviewPolicies'}.${task[policy]}`))])} /></Card>
  </>;
}

export function TaskProgress({ store, taskId, detail, attempt, onSelect }: { store: Store; taskId: string; detail: TaskDetailState | undefined; attempt: Attempt | undefined; onSelect: (id: string) => void }) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : t('taskUi.dash');
  const error = attempt ? state.errors[`attempt-events:${taskId}:${attempt.id}`] : undefined;
  return <>
    <Card className="gap-4 border-border p-5 shadow-none"><h3 className="text-sm font-semibold">{t('workUi.attempts')}</h3>{!detail?.attempts.length && <p className="text-sm text-muted-foreground">{t('workUi.noAttempts')}</p>}
      <ul className="space-y-3">{detail?.attempts.map(item => <li key={item.id} className="space-y-2"><Button type="button" variant={attempt?.id === item.id ? 'secondary' : 'ghost'} aria-pressed={attempt?.id === item.id} onClick={() => onSelect(item.id)} className="h-auto w-full flex-wrap justify-start gap-2 px-3 py-2 text-left text-sm whitespace-normal"><span className="font-medium">{t('reviewUi.attempt')} {new Intl.NumberFormat(i18n.locale).format(item.epoch)}</span><Badge variant="outline">{t(`workUi.states.${item.state}`)}</Badge><span className="text-xs text-muted-foreground">{item.runtime} · {item.seatName ?? t('taskUi.dash')}</span></Button><Facts rows={[[t('workUi.started'), date(item.startedAt)], [t('workUi.ended'), date(item.endedAt)]]} /></li>)}</ul>
    </Card>
    {attempt && isLiveAttempt(attempt.state) && <Badge variant="outline" className="border-run/30 text-run">{t('workUi.live')}</Badge>}
    {error && <><ErrorNotice error={error} /><Button type="button" variant="outline" size="sm" onClick={() => { if (attempt) void store.loadAttemptEvents(taskId, attempt.id); }}>{t('errors.retry')}</Button></>}
    <Card className="gap-4 border-border p-5 shadow-none"><h3 className="text-sm font-semibold">{t('workUi.progress')}</h3><ProgressTimeline events={attempt ? detail?.events[attempt.id] ?? [] : []} /></Card>
  </>;
}

export function TaskReviews({ detail, onDecision }: { detail: TaskDetailState; onDecision: (id: string) => void }) {
  const t = useT();
  return <>
    {detail.approvals.filter(item => pendingApproval(item) && (item.kind === 'review' || item.kind === 'question')).map(item => <Card className="gap-3 border-border p-5 shadow-none" key={item.id}><h3 className="text-sm font-semibold">{t(item.kind === 'review' ? 'inboxUi.review' : 'inboxUi.question')}</h3><p className="text-sm whitespace-pre-wrap text-muted-foreground">{readableText(item.subject)}</p><Button type="button" className="self-start" onClick={() => onDecision(item.id)}>{t(item.kind === 'review' ? 'inboxUi.reviewResult' : 'inboxUi.answerQuestion')}</Button></Card>)}
    <Card className="gap-4 border-border p-5 text-sm shadow-none"><h3 className="font-semibold">{t('inboxUi.history')}</h3>{!detail.approvals.length && <p className="text-muted-foreground">{t('inboxUi.noHistory')}</p>}<ul className="space-y-4">{[...detail.approvals].sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt)).map(item => <li key={item.id} className="space-y-2 border-t border-border pt-3"><div className="flex flex-wrap items-center gap-2"><strong className="font-medium">{readableText(item.subject)}</strong><Badge variant="secondary">{t(`inboxUi.states.${item.state}`)}</Badge></div>{item.outcome && <><p>{readableText(item.options.find(option => option.id === item.outcome?.optionId)?.label ?? '')}</p><p className="whitespace-pre-wrap text-muted-foreground">{readableText(item.outcome.comment ?? '')}</p></>}</li>)}</ul></Card>
  </>;
}
