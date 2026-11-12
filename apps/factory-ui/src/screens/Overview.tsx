import { Skeleton } from '@/components/ui/skeleton';
import { Stagger, StaggerItem } from '@/components/motion/Stagger';
import { useId, useRef, useState } from 'react';
import type { Command } from '@factory/contracts';
import { useEffect } from 'react';
import { chatSend, conversationsCreate } from '../api/commands';
import { Button } from '@/components/ui/button';
import { Card, CardFooter, CardHeader } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import { ErrorNotice } from '../components/ErrorNotice';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';
import { relativeTime } from './Inbox';
import { attentionItems, type AttentionItem } from './shell/attention';
import { ProjectTile } from './shell/ProjectTile';
import { Select } from '../components/Select';
import { ActivityFeed } from './overview/ActivityFeed';
import { Page } from '../components/Page';

type Intent = 'discuss' | 'delegate';
// Keep command identities across retries, including unknown transport outcomes.
 type Attempt = { projectId: string; text: string; intent: Intent; create?: Command; send?: Command };
export function Overview({ store, onProject, onAttention, onCreate, operatorName, focusComposer, onTask }: {
  store: Store; onProject: (id: string) => void; onAttention: (item?: AttentionItem) => void; onCreate: () => void; operatorName?: string; focusComposer?: number; onTask?: (projectId: string, taskId: string) => void;
}) {
  const t = useT(); const id = useId(); const state = store.useStoreSelector(value => value);
  const [text, setText] = useState(''); const [chosen, setChosen] = useState(''); const [intent, setIntent] = useState<Intent>('delegate');
  const [busy, setBusy] = useState(false); const [problem, setProblem] = useState('');
  const attempt = useRef<Attempt | null>(null); const sending = useRef(false); const composing = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (focusComposer) composer.current?.focus(); }, [focusComposer]);
  const projectId = state.projects.some(project => project.id === chosen) ? chosen : state.projects[0]?.id ?? '';
  const pending = attempt.current?.send ?? attempt.current?.create;
  const error = pending ? state.pending[pending.commandId]?.error : undefined;
  const tooLong = text.length > 32_000;
  const disabled = !text.trim() || !projectId || tooLong || busy || state.session !== 'authenticated';
  async function submit(retry = false) {
    if (sending.current || (!retry && disabled)) return;
    const entry = retry ? attempt.current : { projectId, text, intent };
    if (!entry) return;
    attempt.current = entry; sending.current = true; setBusy(true); setProblem('');
    const current = () => store.getState().session === 'authenticated' && store.getState().selectedProjectId === entry.projectId;
    async function send(command: Command) {
      return store.getState().pending[command.commandId]?.status === 'failed' ? store.retry(command.commandId) : store.send(command);
    }
    try {
      if (store.getState().selectedProjectId !== entry.projectId) await store.selectProject(entry.projectId);
      if (!current()) return;
      const lead = store.getState().team?.seats.find(seat => seat.isLead);
      if (!lead) { setProblem('chatUi.noLead'); return; }
      let conversation = store.getState().conversations.find(item => item.agentId === lead.id && item.workItemId === null);
      if (!conversation) {
        entry.create ??= conversationsCreate({ projectId: entry.projectId, seatId: lead.id, title: 'Lead' });
        if (!await send(entry.create) || !current()) return;
        await store.loadConversations();
        if (!current()) return;
        conversation = store.getState().conversations.find(item => item.agentId === lead.id && item.workItemId === null);
      }
      if (!conversation) { setProblem('overview.conversationUnavailable'); return; }
      entry.send ??= chatSend({ projectId: entry.projectId, conversationId: conversation.id, conversationRevision: conversation.revision, text: entry.text, intent: entry.intent });
      if (!await send(entry.send) || !current()) {
        if (current() && store.getState().pending[entry.send.commandId]?.error?.code === 'conflict') await store.loadConversations();
        return;
      }
      await Promise.all([store.loadMessages(conversation.id), store.loadBudget()]);
      if (!current()) return;
      attempt.current = null; setText(''); onProject(entry.projectId);
    } finally { sending.current = false; setBusy(false); }
  }
  const items = attentionItems(state.globalInbox).slice(0, 5);
  const hour = new Date().getHours();
  const dayPart = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  useEffect(() => {
    if (state.projects.length && state.selectedProjectId === null) void store.selectProject(state.projects[0]!.id);
  }, [store, state.projects, state.selectedProjectId]);
  return <Page className="overview min-w-0">
    <h1 className="m-0 font-display text-3xl font-semibold tracking-tight">{t('overview.greetingStart')} <span className="text-project-1">{t(`overview.${dayPart}`)}</span>{operatorName && <>, {operatorName}</>}</h1>
    {attentionItems(state.globalInbox).length > 0 && <p className="mt-2 text-base text-muted-foreground">{t('overview.waiting').replace('{count}', new Intl.NumberFormat(i18n.locale).format(attentionItems(state.globalInbox).length))}</p>}
    <div className="mt-7 grid min-w-0 grid-cols-[minmax(0,1fr)_360px] items-start gap-6 max-[1023px]:grid-cols-1">
      <div className="grid min-w-0 gap-5">
      {state.projects.length ? <Card className="gap-0 rounded-xl border-border p-5 shadow-none"><form aria-label={t('overview.composer')} onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label className="sr-only" htmlFor={`${id}-text`}>{t('overview.message')}</label>
        <Textarea ref={composer} id={`${id}-text`} placeholder={t('overview.placeholder')} value={text} disabled={busy} aria-invalid={tooLong || undefined} aria-describedby={tooLong ? `${id}-limit` : `${id}-shortcut`} className="min-h-[120px] resize-y rounded-lg border border-border bg-background px-3 py-3 text-base shadow-none"
          onChange={event => { setText(event.target.value); attempt.current = null; }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={event => { if (event.ctrlKey && event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) { event.preventDefault(); void submit(); } }} />
        {tooLong && <p id={`${id}-limit`} className="mt-2 text-sm text-destructive" role="alert">{t('chatUi.tooLong')}</p>}
        <Separator className="my-4" />
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3"><label htmlFor={`${id}-project`} className="text-sm text-muted-foreground">{t('overview.project')}</label><Select id={`${id}-project`} value={projectId} disabled={busy} onValueChange={next => { setChosen(next); attempt.current = null; }} options={state.projects.map(project => ({ value: project.id, label: project.name }))} className="w-48" /></div>
          <ToggleGroup type="single" value={intent} disabled={busy} onValueChange={value => { if (value === 'discuss' || value === 'delegate') { setIntent(value); attempt.current = null; } }} aria-label={t('chatUi.intent')} spacing={0} className="rounded-md border border-border">
            <ToggleGroupItem value="discuss" className="h-8 min-h-8 rounded-md border-0 px-3 text-sm font-normal data-[state=on]:bg-secondary">{t('overview.ask')}</ToggleGroupItem>
            <ToggleGroupItem value="delegate" className="h-8 min-h-8 rounded-md border-0 px-3 text-sm font-normal data-[state=on]:bg-secondary">{t('overview.delegate')}</ToggleGroupItem>
          </ToggleGroup>
          <div className="ml-auto flex items-center gap-3"><span className="whitespace-nowrap text-xs text-muted-foreground" id={`${id}-shortcut`}><Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> {t('overview.toSend')}</span>
          <Button type="submit" variant="default" className="h-9 border-0 px-4" disabled={disabled}>{t('chatUi.send')}</Button></div>
        </div>
        {error && <ErrorNotice error={error} />}{problem && <p role="alert">{t(problem)}</p>}
        {(error || problem) && <Button type="button" variant="outline" disabled={busy} onClick={() => { void submit(true); }}>{t('errors.retry')}</Button>}
      </form></Card> : <Card className="rounded-xl border-border p-5 shadow-none" aria-label={t('overview.composer')}><p className="m-0 text-sm text-muted-foreground">{t('projects.empty')}</p><Button className="mt-4" onClick={onCreate}>{t('projects.create')}</Button></Card>}
      <ActivityFeed store={store} onCreate={onCreate} onTask={(projectId, taskId) => { if (onTask) onTask(projectId, taskId); else onProject(projectId); }} />
      </div>
      <Card className="gap-0 overflow-hidden rounded-xl border-border border-l-2 border-l-need py-0 shadow-none" aria-labelledby={`${id}-needs`}>
        <CardHeader className="flex flex-row items-center justify-between gap-3 p-5 pb-3"><h2 id={`${id}-needs`} className="font-display text-lg font-semibold">{t('nav.attention')}</h2><Badge className="border-0 bg-need text-need-foreground">{items.length}</Badge></CardHeader>
        {state.loading.globalInbox && <div role="status" aria-label={t('viewStates.loading')} className="space-y-3 px-5 pb-4"><span className="sr-only">{t('viewStates.loading')}</span><Skeleton className="h-5 w-4/5" /><Skeleton className="h-4 w-3/5" /></div>}
        {state.errors.globalInbox && <><ErrorNotice error={state.errors.globalInbox} /><Button onClick={() => { void store.loadGlobalInbox(); }}>{t('errors.retry')}</Button></>}
        {!items.length && !state.loading.globalInbox && !state.errors.globalInbox && <Empty className="border-0 px-5 py-10"><EmptyHeader><EmptyMedia variant="icon"><CheckCircle2 aria-hidden="true" /></EmptyMedia><EmptyDescription>{t('overview.caughtUp')}</EmptyDescription></EmptyHeader></Empty>}
        <Stagger className="m-0 list-none p-0">{items.map((item, index) => {
          const name = item.projectName ?? state.projects.find(project => project.id === item.projectId)?.name ?? t('overview.project');
          return <StaggerItem key={item.key} index={index}><Button type="button" variant="ghost" className="h-auto w-full items-start justify-start gap-3 rounded-none border-0 border-t border-border px-5 py-3 text-left whitespace-normal hover:bg-secondary" onClick={() => onAttention(item)}>
            <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-need" />
            <span className="grid min-w-0 flex-1 gap-2">
              <span className="flex flex-wrap items-start gap-x-3 gap-y-1"><strong className="min-w-[8rem] flex-1 line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]">{item.title}</strong>{!item.since.startsWith('9999') && <time dateTime={item.since} className="ml-auto shrink-0 whitespace-nowrap text-xs font-normal text-muted-foreground">{relativeTime(item.since)}</time>}</span>
              <span className="flex min-w-0 items-center gap-2 text-xs font-normal text-muted-foreground"><ProjectTile id={item.projectId} name={name} className="size-6 rounded-md" /><span className="truncate">{name}</span>{item.code && <span className="shrink-0 font-mono">{item.code}</span>}</span>
            </span>
          </Button></StaggerItem>;
        })}</Stagger>
        <CardFooter className="p-3"><Button variant="ghost" className="h-9 w-full border-0 px-3 text-sm text-muted-foreground" onClick={() => onAttention()}>{t('overview.viewAll')}<ChevronRight className="size-4" /></Button></CardFooter>
      </Card>
    </div>
  </Page>;
}
