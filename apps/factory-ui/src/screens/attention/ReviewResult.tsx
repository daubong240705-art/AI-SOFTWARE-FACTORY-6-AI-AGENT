import { useEffect } from 'react';
import type { Approval } from '@factory/contracts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useT } from '../../i18n';
import type { Store } from '../../state/store';
import { parseDiff } from '../../state/diff';
import { ProgressTimeline } from '../ProgressTimeline';
import { TaskContext } from '../TaskContext';
import { ReviewChanges } from './ReviewChanges';
import { ReviewDocuments } from './ReviewDocuments';
import { ReviewAside } from './ReviewAside';
import { Fold, Facts } from './ReviewShared';
import { readableText } from './presentation';

export function ReviewResult({ store, taskId, approval }: { store: Store; taskId: string; approval?: Approval }) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  useEffect(() => { void store.openTask(taskId); return () => store.closeTask(taskId); }, [store, taskId]);
  const task = state.tasks.find(item => item.id === taskId); const detail = state.details[taskId];
  const attempt = detail?.attempts[0];
  const patch = attempt ? detail?.patches[attempt.id] : undefined;
  const patchLoaded = attempt ? Object.hasOwn(detail?.patches ?? {}, attempt.id) : false;
  useEffect(() => { if (attempt && !patchLoaded) void store.loadPatch(taskId, attempt.id); }, [store, taskId, attempt?.id, patchLoaded]);
  const files = parseDiff(patch?.patch ?? '').files;
  const totals = patch ? {
    files: files.length,
    additions: files.reduce((sum, file) => sum + file.lines.filter(line => line.kind === 'added').length, 0),
    deletions: files.reduce((sum, file) => sum + file.lines.filter(line => line.kind === 'removed').length, 0),
  } : undefined;
  const events = attempt ? detail?.events[attempt.id] ?? [] : [];
  const error = state.errors[`detail:${taskId}`];
  const eventError = attempt ? state.errors[`attempt-events:${taskId}:${attempt.id}`] : undefined;
  return <Tabs defaultValue="result" className="min-w-0 flex-1 gap-0">
    <div className="px-6">
      <TabsList variant="line" aria-label={t('workUi.sections')} className="h-10 gap-0 overflow-x-auto p-0">
        {(['result', 'activity', 'context'] as const).map(tab => <TabsTrigger key={tab} value={tab} className="rounded-none px-3 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground after:!bottom-[-1px]">{t(`reviewUi.${tab}`)}</TabsTrigger>)}
      </TabsList>
    </div>
    {error && <div className="px-6 pt-5"><ErrorNotice error={error} /><Button variant="outline" onClick={() => { void store.loadTaskDetail(taskId); }}>{t('errors.retry')}</Button></div>}
    <div className="grid min-w-0 flex-1 items-start gap-6 p-6 min-[1400px]:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        {(!detail || (detail.loading && !attempt)) && !error && <div role="status" className="space-y-3"><span className="sr-only">{t('viewStates.loading')}</span><Skeleton className="h-7 w-2/3" /><Skeleton className="h-64 w-full" /></div>}
        <TabsContent value="result" className="m-0 space-y-5">
          {detail && <>
            {attempt ? <ReviewChanges store={store} taskId={taskId} code={task?.code ?? ''} attempt={attempt} /> : <Card className="gap-0 border-border p-5 text-sm text-muted-foreground shadow-none">{t('reviewUi.noChanges')}</Card>}
            <ReviewDocuments store={store} taskId={taskId} documents={detail.artifacts} attemptId={attempt?.id} />
            <Fold title={t('reviewUi.history')}>
              <div className="divide-y divide-border">
                {detail.attempts.slice(1).map(older => <div key={older.id} className="space-y-2 py-3 text-xs text-muted-foreground">
                  <p className="flex flex-wrap items-center justify-between gap-2"><span>{t('reviewUi.attempt')} {older.epoch}</span><span className="flex items-center gap-2"><span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground" />{t(`workUi.states.${older.state}`)}</span></p>
                  <Fold title={t('reviewUi.changes')}><ReviewChanges store={store} taskId={taskId} code={task?.code ?? ''} attempt={older} /></Fold>
                </div>)}
                {detail.artifacts.flatMap(document => document.versions.filter(version => version.producedByAttemptId !== attempt?.id).map(version => <div key={`${document.artifactId}:${version.version}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs text-muted-foreground"><span>{t(`knowledgeUi.kinds.${document.kind}`)} <span className="ml-2">{t('workUi.version')} {version.version}</span></span><span>{t(`workUi.statuses.${version.status}`)}</span></div>))}
                {detail.attempts.length < 2 && !detail.artifacts.some(document => document.versions.some(version => version.producedByAttemptId !== attempt?.id)) && <p className="py-3 text-xs text-muted-foreground">{t('reviewUi.noHistory')}</p>}
              </div>
            </Fold>
            <Fold title={t('attention.technicalDetails')}>
              <Facts rows={[
                [t('reviewUi.attempt'), String(attempt?.epoch ?? '—')], [t('attention.identifier'), attempt?.id ?? '—'],
                [t('reviewUi.patchHash'), patch?.sha256 ?? '—'],
                ...(approval ? [[t('reviewUi.record'), approval.id], [t('attention.digest'), approval.context.digest], [t('reviewUi.recordNumber'), String(approval.revision)]] : []),
                ...detail.artifacts.map(document => [readableText(document.title), document.artifactId]),
              ]} mono />
            </Fold>
          </>}
        </TabsContent>
        <TabsContent value="activity" className="m-0 space-y-4">
          {eventError && <><ErrorNotice error={eventError} /><Button variant="outline" onClick={() => { if (attempt) void store.loadAttemptEvents(taskId, attempt.id); }}>{t('errors.retry')}</Button></>}
          <ProgressTimeline events={events} />
        </TabsContent>
        <TabsContent value="context" className="m-0 space-y-4">
          {task && <>
            <Card className="gap-3 border-border p-5 shadow-none"><h3 className="text-sm font-semibold">{t('taskUi.goal')}</h3><p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{readableText(task.goal)}</p>{task.brief && <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{readableText(task.brief)}</p>}</Card>
            <Card className="gap-3 border-border p-5 shadow-none"><h3 className="text-sm font-semibold">{t('taskUi.dependencies')}</h3><ul className="space-y-2 text-sm text-muted-foreground">{task.dependsOn.map(dependency => <li key={dependency} className="font-mono">{state.tasks.find(item => item.id === dependency)?.code ?? dependency}</li>)}</ul><Facts rows={task.holds.map(hold => [t(`workUi.holdKinds.${hold.kind}`), readableText(hold.reason)])} /></Card>
            <TaskContext store={store} taskId={taskId} />
          </>}
        </TabsContent>
      </div>
      <ReviewAside store={store} taskId={taskId} events={events} {...(totals ? { totals } : {})} />
    </div>
  </Tabs>;
}
