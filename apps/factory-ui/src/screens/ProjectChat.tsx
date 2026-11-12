import { Mascot, MascotEmpty } from '@/components/mascot';
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { Command, Conversation, Task, TaskState } from '@factory/contracts';
import { ArrowUp, Check, MessageCircle, X } from 'lucide-react';
import { chatSend, conversationsCreate, tasksTransition } from '../api/commands';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorNotice } from '../components/ErrorNotice';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type Draft = { text: string; intent: 'discuss' | 'delegate' };
const drafts = new WeakMap<Store, Map<string, Draft>>();
function conversationDrafts(store: Store) { let entries = drafts.get(store); if (!entries) { entries = new Map(); drafts.set(store, entries); } return entries; }
const emptyDraft = (): Draft => ({ text: '', intent: 'discuss' });

function BudgetLine({ store }: { store: Store }) {
  const t = useT();
  const budget = store.useStoreSelector(value => value.budget);
  const day = budget?.day;
  if (!day) return null;
  const percent = Math.min(100, day.limit > 0 ? day.used / day.limit * 100 : 0);
  const color = day.verdict === 'exceeded' ? '[&_[data-slot=progress-indicator]]:bg-need' : day.verdict === 'warn' ? '[&_[data-slot=progress-indicator]]:bg-run' : '[&_[data-slot=progress-indicator]]:bg-ok';
  const number = new Intl.NumberFormat(i18n.locale);
  return <div className="shrink-0 space-y-1 border-b border-border p-4"><div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-muted-foreground"><span>{t('chatUi.budget')}</span><span className="tabular-nums">{number.format(day.used)} / {number.format(day.limit)} {t('chatUi.tokens')}</span></div><Progress value={percent} aria-label={t('chatUi.budget')} className={`h-1 ${color}`} /></div>;
}

function ChatHeader({ onClose }: { onClose?: (() => void) | undefined }) {
  const t = useT();
  return <header className="flex shrink-0 items-center gap-3 border-b border-border p-4"><Avatar size="sm" className="bg-secondary"><AvatarFallback className="bg-secondary text-foreground">L</AvatarFallback></Avatar><div className="min-w-0"><h2 className="font-display text-base font-semibold">Lead</h2><p className="text-xs text-muted-foreground">{t('chatUi.speakers.agent')}</p></div><span className="ml-auto"><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={t('projectUi.closeChat')} onClick={onClose}><X /></Button></TooltipTrigger><TooltipContent>{t('projectUi.closeChat')} <Kbd>Esc</Kbd></TooltipContent></Tooltip></span></header>;
}

export function ProjectChat({ store, projectId, showBudget = true, onClose }: { store: Store; projectId: string; showBudget?: boolean; onClose?: (() => void) | undefined }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const lead = state.team?.seats.find(seat => seat.isLead);
  const conversation = state.conversations.find(item => item.agentId === lead?.id && item.workItemId === null) ?? state.conversations[0];
  const [command, setCommand] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = command ? state.pending[command.commandId] : undefined;
  async function execute(created: Command, retry = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await (retry ? store.retry(created.commandId) : store.send(created));
      if (result && store.getState().session === 'authenticated') { await store.loadConversations(); setCommand(null); }
      else if (store.getState().pending[created.commandId]?.error?.code === 'conflict') await store.loadConversations();
    } finally { inFlight.current = false; setBusy(false); }
  }
  if (conversation) return <ConversationChat key={`${projectId}:${conversation.id}`} store={store} projectId={projectId} conversation={conversation} showBudget={showBudget} onClose={onClose} />;
  return <div className="flex h-full min-h-0 flex-col"><ChatHeader onClose={onClose} /><div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center"><MascotEmpty seat="Lead" size={64} fallback={<><MessageCircle className="size-6 text-muted-foreground" aria-hidden="true" /><p className="text-sm text-muted-foreground">{t('empty.conversations')}</p></>}><p className="text-sm text-muted-foreground">{t('empty.conversations')}</p><p className="text-sm text-muted-foreground">{t('chatUi.greeting')}</p></MascotEmpty>{state.errors.conversations && <ErrorNotice error={state.errors.conversations} />}{state.errors.team && <ErrorNotice error={state.errors.team} />}{state.team && !lead && <p role="alert" className="text-sm text-need">{t('chatUi.noLead')}</p>}{pending?.error && <ErrorNotice error={pending.error} />}{pending?.status === 'failed' && command ? <Button variant="outline" disabled={busy || state.session !== 'authenticated'} onClick={() => { void execute(command, true); }}>{t('errors.retry')}</Button> : <Button disabled={!state.team || !lead || busy || state.session !== 'authenticated'} onClick={() => { if (!lead || inFlight.current) return; const created = conversationsCreate({ projectId, seatId: lead.id, title: 'Lead' }); setCommand(created); void execute(created); }}>{t('chatUi.start')}</Button>}</div></div>;
}

function ProposalCard({ store, projectId, task }: { store: Store; projectId: string; task: Task }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const [command, setCommand] = useState<Command | null>(null);
  const busy = !!command && !state.pending[command.commandId]?.error;
  const actions: Array<{ to: TaskState; label: string; icon: typeof Check }> = [{ to: 'accepted', label: t('taskUi.actions.accepted'), icon: Check }, { to: 'declined', label: t('taskUi.actions.declined'), icon: X }];
  async function transition(to: TaskState) {
    if (busy || state.session !== 'authenticated') return;
    const created = tasksTransition({ projectId, taskId: task.id, expectedRevision: task.revision, to });
    setCommand(created);
    const result = await store.send(created);
    if (result) { await store.loadTasks(); setCommand(null); }
  }
  const error = command ? state.pending[command.commandId]?.error : undefined;
  return <Card className="gap-3 rounded-lg border-border bg-secondary/50 p-4 shadow-none"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-mono text-xs text-muted-foreground">{task.code}</p><h3 className="font-medium [overflow-wrap:anywhere]">{task.title}</h3></div><Badge variant="outline" className="text-info"><span className="mr-1.5 size-1.5 rounded-full bg-current" />{t('taskUi.lifecycle.proposed')}</Badge></div><p className="line-clamp-2 text-sm text-muted-foreground">{task.goal}</p><div className="flex flex-wrap gap-2">{actions.map(({ to, label, icon: Icon }) => <Button key={to} type="button" variant={to === 'accepted' ? 'default' : 'outline'} size="sm" disabled={busy} onClick={() => { void transition(to); }}><Icon className="size-3.5" />{label}</Button>)}</div>{error && <><ErrorNotice error={error} /><Button variant="outline" size="sm" disabled={busy} onClick={() => { void transition('accepted'); }}>{t('errors.retry')}</Button></>}</Card>;
}

function ConversationChat({ store, projectId, conversation, showBudget, onClose }: { store: Store; projectId: string; conversation: Conversation; showBudget: boolean; onClose?: (() => void) | undefined }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const id = useId();
  const draftKey = `${projectId}:${conversation.id}`;
  const entries = conversationDrafts(store);
  const [draft, setDraft] = useState<Draft>(() => entries.get(draftKey) ?? emptyDraft());
  const [attempt, setAttempt] = useState<{ command: ReturnType<typeof chatSend>; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const composing = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [jump, setJump] = useState(false);
  const messages = state.messages[conversation.id];
  const lastUser = messages?.findLast(item => item.message.speaker === 'user');
  const turn = lastUser && state.turns[conversation.id]?.find(item => item.id === lastUser.message.id);
  const pending = attempt ? state.pending[attempt.command.commandId] : undefined;
  const number = new Intl.NumberFormat(i18n.locale);
  const date = new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' });
  const tooLong = draft.text.length > 32_000;
  const disabled = !draft.text.trim() || tooLong || busy || state.session !== 'authenticated';
  const proposed = state.tasks.filter(task => task.state === 'proposed').slice(0, 3);
  useEffect(() => { void store.loadMessages(conversation.id); }, [store, conversation.id]);
  function latest() { const node = log.current; if (node) node.scrollTop = node.scrollHeight; nearBottom.current = true; setJump(false); }
  useLayoutEffect(() => { if (nearBottom.current) latest(); else if (messages?.length) setJump(true); }, [messages]);
  function changeDraft(next: Draft) { entries.set(draftKey, next); setDraft(next); }
  async function execute(created: NonNullable<typeof attempt>, retry = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await (retry ? store.retry(created.command.commandId) : store.send(created.command));
      if (result && store.getState().session === 'authenticated') { if (entries.get(draftKey) === created.draft) changeDraft(emptyDraft()); setAttempt(null); await Promise.all([store.loadMessages(conversation.id), store.loadBudget()]); }
      else if (store.getState().pending[created.command.commandId]?.error?.code === 'conflict') await store.loadConversations();
    } finally { inFlight.current = false; setBusy(false); }
  }
  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (disabled || inFlight.current) return;
    const created = { command: chatSend({ projectId, conversationId: conversation.id, conversationRevision: conversation.revision, text: draft.text, intent: draft.intent }), draft };
    setAttempt(created); void execute(created);
  }
  return <div className="project-chat flex h-full min-h-0 flex-col overflow-hidden">
    <ChatHeader onClose={onClose} />
    {showBudget && <BudgetLine store={store} />}
    {state.errors[`messages:${conversation.id}`] && <div className="p-4 pb-0"><ErrorNotice error={state.errors[`messages:${conversation.id}`]!} /></div>}
    <div ref={log} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" role="log" aria-live="polite" aria-label={t('chatUi.messages')} tabIndex={0} onScroll={() => { const node = log.current; if (!node) return; nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 64; if (nearBottom.current) setJump(false); }}>
      {!messages?.length && <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center"><MascotEmpty seat="Lead" size={64} fallback={<><MessageCircle aria-hidden="true" className="size-6 text-muted-foreground" /><p className="text-sm text-muted-foreground">{t('empty.messages')}</p></>}><p className="text-sm text-muted-foreground">{t('empty.messages')}</p><p className="text-sm text-muted-foreground">{t('chatUi.greeting')}</p></MascotEmpty></div>}
      {messages?.map(({ message }) => message.speaker === 'system' ? <p key={message.id} className="text-center text-xs text-muted-foreground">{message.text}</p> : <article key={message.id} className={`flex max-w-[90%] items-start gap-2 ${message.speaker === 'user' ? 'self-end flex-row-reverse' : 'self-start'}`}><Avatar size="sm" className={message.speaker === 'user' ? 'bg-primary' : 'bg-secondary'}><AvatarFallback className={message.speaker === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'}>{message.speaker === 'user' ? 'You' : 'L'}</AvatarFallback></Avatar><div className={message.speaker === 'user' ? 'space-y-1 text-right' : 'space-y-1'}><div className={`rounded-xl px-4 py-3 text-sm leading-6 ${message.speaker === 'user' ? 'bg-secondary' : 'bg-transparent'}`}><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</p></div><time dateTime={message.createdAt} className="text-[11px] text-muted-foreground">{date.format(new Date(message.createdAt))}</time></div></article>)}
      {proposed.length > 0 && <div className="space-y-3">{proposed.map(task => <ProposalCard key={task.id} store={store} projectId={projectId} task={task} />)}</div>}
    </div>
    {jump && <div className="px-4 pb-3"><Button variant="outline" size="sm" onClick={latest}>{t('chatUi.jump')}</Button></div>}
    {turn && turn.state !== 'done' && <p role="status" className="flex items-center gap-2 px-4 pb-3 text-sm text-muted-foreground"><Mascot seat="Lead" state={turn.state === 'queued' || turn.state === 'running' ? 'thinking' : 'attention'} size={32} fallback={<Spinner />} />{t(turn.state === 'queued' || turn.state === 'running' ? 'chatUi.working' : turn.state === 'budget-blocked' ? 'chatUi.blocked' : 'chatUi.resend')}</p>}
    <form className="shrink-0 space-y-3 border-t border-border p-4" onSubmit={submit}>
      <label htmlFor={`${id}-message`} className="sr-only">{t('chatUi.message')}</label><Textarea id={`${id}-message`} rows={3} maxLength={32_001} value={draft.text} aria-invalid={tooLong || undefined} aria-describedby={`${id}-help${draft.text.length ? ` ${id}-count` : ''}${tooLong ? ` ${id}-limit` : ''}`} placeholder={t('chatUi.message')} className="max-h-52 min-h-16 resize-none px-3 py-2 [field-sizing:content]" onChange={event => changeDraft({ ...draft, text: event.target.value })} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === 'Enter' && event.ctrlKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) { event.preventDefault(); submit(); } }} />
      <div className="flex flex-wrap items-center gap-3"><ToggleGroup type="single" value={draft.intent} disabled={busy} onValueChange={value => { if (value === 'discuss' || value === 'delegate') changeDraft({ ...draft, intent: value }); }} aria-label={t('chatUi.intent')} spacing={0} className="rounded-md border border-border"><ToggleGroupItem value="discuss" className="h-8 rounded-md border-0 px-3 text-xs font-normal data-[state=on]:bg-secondary">{t('chatUi.discuss')}</ToggleGroupItem><ToggleGroupItem value="delegate" className="h-8 rounded-md border-0 px-3 text-xs font-normal data-[state=on]:bg-secondary">{t('chatUi.delegate')}</ToggleGroupItem></ToggleGroup><span id={`${id}-shortcut`} className="ml-auto text-xs text-muted-foreground"><KbdGroup><Kbd>Ctrl</Kbd><Kbd>Enter</Kbd></KbdGroup></span><Button type="submit" size="icon" className="h-9 w-9 border-0" disabled={disabled} aria-label={t('chatUi.send')}><ArrowUp className="size-4" /></Button></div>
      <p id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">{t(draft.intent === 'discuss' ? 'chatUi.discussHelp' : 'chatUi.delegateHelp')}</p><div className="flex justify-end gap-3 text-xs">{(draft.text.length > 0) && <span id={`${id}-count`} className={`whitespace-nowrap ${tooLong ? 'text-destructive' : 'text-muted-foreground'}`}>{number.format(draft.text.length)} / {number.format(32_000)}</span>}</div>
      {tooLong && <p id={`${id}-limit`} role="alert" className="text-sm text-destructive">{t('chatUi.tooLong')}</p>}{pending?.error && <ErrorNotice error={pending.error} />}<div className="flex justify-end">{pending?.status === 'failed' && attempt && <Button type="button" variant="outline" disabled={busy || state.session !== 'authenticated'} onClick={() => { void execute(attempt, true); }}>{t('errors.retry')}</Button>}</div>
    </form>
  </div>;
}

