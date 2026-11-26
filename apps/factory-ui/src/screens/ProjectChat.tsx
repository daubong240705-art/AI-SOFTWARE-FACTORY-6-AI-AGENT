import { Mascot, MascotEmpty } from '@/components/mascot';
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { Command, Conversation, Task, TaskState } from '@factory/contracts';
import { ArrowUp, Check, ChevronDown, MessageCircle, X } from 'lucide-react';
import { chatSend, conversationsCreate, tasksTransition } from '../api/commands';
import { i18n, plural, useT } from '../i18n';
import type { Store } from '../state/store';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusDot, TechDetails } from '@/components/app';
import { toneOf } from '@/lib/status';
import { shallowSelectionEqual } from '@/state/storeSelector';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MarkdownContent } from '@/components/MarkdownContent';
import { ErrorNotice } from '../components/ErrorNotice';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { readableText } from './attention/presentation';
import { LeadChatCard, useLeadRunUpdates } from './LeadChatCard';
import { resolveLeadId } from './projectChatLead';

type Draft = { text: string; intent: 'discuss' | 'delegate' };
const drafts = new WeakMap<Store, Map<string, Draft>>();
function conversationDrafts(store: Store) { let entries = drafts.get(store); if (!entries) { entries = new Map(); drafts.set(store, entries); } return entries; }
const emptyDraft = (): Draft => ({ text: '', intent: 'discuss' });

function LeadAvatar() {
  return <Avatar className="size-7 overflow-visible bg-secondary"><Mascot seat="Lead" size={28} fallback={<AvatarFallback className="bg-secondary text-foreground">L</AvatarFallback>} /></Avatar>;
}

function ChatHeader({ onClose }: { onClose?: (() => void) | undefined }) {
  const t = useT();
  return <header className="flex shrink-0 items-center gap-3 border-b border-border p-4"><LeadAvatar /><div className="min-w-0"><h2 className="font-display text-base font-semibold">Lead</h2><p className="text-xs text-muted-foreground">{t('chatUi.speakers.agent')}</p></div><span className="ml-auto"><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={t('projectUi.closeChat')} onClick={onClose}><X /></Button></TooltipTrigger><TooltipContent>{t('projectUi.closeChat')} <Kbd>Esc</Kbd></TooltipContent></Tooltip></span></header>;
}

export function ProjectChat({ store, projectId, onClose, onOpenTask }: { store: Store; projectId: string; onClose?: (() => void) | undefined; onOpenTask?: ((id: string) => void) | undefined }) {
  const t = useT();
  const [command, setCommand] = useState<Command | null>(null);
  const state = store.useStoreSelector(value => ({ team: value.team, conversations: value.conversations, session: value.session, pending: command ? value.pending[command.commandId] : undefined, conversationError: value.errors.conversations }), shallowSelectionEqual);
  const lead = state.team?.seats.find(seat => seat.isLead);
  const conversation = state.conversations.find(item => item.agentId === lead?.id && item.workItemId === null) ?? state.conversations[0];
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<'noLead' | 'startFailed' | null>(null);
  const inFlight = useRef(false);
  const pending = state.pending;
  async function start() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setStartError(null);
    try {
      let created = command;
      if (!created) {
        const leadId = await resolveLeadId(store, projectId, lead?.id);
        if (!leadId) { setStartError('noLead'); return; }
        created = conversationsCreate({ projectId, seatId: leadId, title: 'Lead' });
      }
      const current = store.getState();
      if (created.projectId !== projectId || current.selectedProjectId !== projectId || current.session !== 'authenticated' || current.conversations.length) return;
      if (!command) setCommand(created);
      const result = await store.send(created);
      if (result || store.getState().pending[created.commandId]?.error?.code === 'conflict') await store.loadConversations();
      if (!store.getState().conversations.length) setStartError('startFailed');
    } catch {
      setStartError('startFailed');
    } finally { inFlight.current = false; setBusy(false); }
  }
  if (conversation) return <ConversationChat key={`${projectId}:${conversation.id}`} store={store} projectId={projectId} conversation={conversation} onClose={onClose} onOpenTask={onOpenTask} />;
  return <div className="flex h-full min-h-0 flex-col"><ChatHeader onClose={onClose} /><div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center"><MascotEmpty seat="Lead" size={64} fallback={<><MessageCircle className="size-6 text-muted-foreground" aria-hidden="true" /><p className="text-sm text-muted-foreground">{t('empty.conversations')}</p></>}><p className="text-sm text-muted-foreground">{t('empty.conversations')}</p><p className="text-sm text-muted-foreground">{t('chatUi.greeting')}</p></MascotEmpty>{state.conversationError && <ErrorNotice error={state.conversationError} />}{startError && <p role="alert" className="text-sm text-need">{t(`chatUi.${startError}`)}</p>}{pending?.error && <ErrorNotice error={pending.error} />}<Button variant={startError ? 'outline' : 'default'} disabled={busy || state.session !== 'authenticated'} onClick={() => { void start(); }}>{t(startError ? 'errors.retry' : 'chatUi.start')}</Button></div></div>;
}

/** One decision for the whole plan: accept (or decline) every proposed task in code order. */
function PlanActions({ store, projectId, tasks }: { store: Store; projectId: string; tasks: Task[] }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Command | null>(null);
  const failed = store.useStoreSelector(value => error ? value.pending[error.commandId]?.error : undefined);
  async function decide(to: 'accepted' | 'declined') {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      for (const { id } of [...tasks].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))) {
        const current = store.getState().tasks.find(task => task.id === id);
        if (current?.state !== 'proposed') continue;
        const command = tasksTransition({ projectId, taskId: id, expectedRevision: current.revision, to });
        if (!await store.send(command)) { setError(command); break; }
        await store.loadTasks();
      }
    } finally { setBusy(false); }
  }
  return <div className="space-y-2" title={t('chatUi.planNote')}>
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy} onClick={() => { void decide('accepted'); }}><Check />{t('chatUi.acceptPlan')}</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { void decide('declined'); }}><X />{t('chatUi.declinePlan')}</Button></div>
    {failed && <ErrorNotice error={failed} />}
  </div>;
}

function ProposalCard({ store, projectId, task, detailsOpen }: { store: Store; projectId: string; task: Task; detailsOpen: boolean }) {
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
  const owner = task.ownerSeatId ? state.team?.seats.find(seat => seat.id === task.ownerSeatId) : undefined;
  const hasDetails = task.acceptance.length > 0 || task.requiredCapabilities.length > 0 || task.dependsOn.length > 0;
  return <div className="space-y-3 rounded-lg border border-border p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{task.code}</p><h3 className="font-medium [overflow-wrap:anywhere]">{task.title}</h3></div><StatusDot tone={toneOf('task', task.state)} label={t('taskUi.lifecycle.proposed')} /></div>
    <div className="space-y-1 text-sm"><h4 className="font-medium">{t('chatUi.proposalGoal')}</h4><p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{readableText(task.goal)}</p></div>
    {owner && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{t('chatUi.proposalOwner')}: {readableText(owner.name)}</p>}
    {hasDetails && <Collapsible defaultOpen={detailsOpen} className="space-y-2">
      <CollapsibleTrigger asChild><Button type="button" variant="ghost" size="sm" className="group"><ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />{t('chatUi.proposalDetails')}</Button></CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 text-sm">
        {task.acceptance.length > 0 && <div className="space-y-1"><h4 className="font-medium">{t('chatUi.proposalAcceptance')}</h4><ul className="list-disc space-y-1 pl-5 text-muted-foreground">{task.acceptance.map((criterion, index) => <li key={index} className="whitespace-pre-wrap [overflow-wrap:anywhere]">{readableText(criterion)}</li>)}</ul></div>}
        {task.requiredCapabilities.length > 0 && <div className="space-y-1"><h4 className="font-medium">{t('chatUi.proposalCapabilities')}</h4><div className="flex flex-wrap gap-1.5">{task.requiredCapabilities.map((capability, index) => <Badge key={index} variant="secondary" className="max-w-full whitespace-normal [overflow-wrap:anywhere]">{readableText(capability)}</Badge>)}</div></div>}
        {task.dependsOn.length > 0 && <div className="space-y-1"><h4 className="font-medium">{t('chatUi.proposalDependencies')}</h4><ul className="list-disc space-y-1 pl-5 font-mono text-xs text-muted-foreground">{task.dependsOn.map(dependency => <li key={dependency} className="[overflow-wrap:anywhere]">{state.tasks.find(item => item.id === dependency)?.code ?? <TechDetails identifier={readableText(dependency)} />}</li>)}</ul></div>}
      </CollapsibleContent>
    </Collapsible>}
    <div className="flex flex-wrap gap-2">{actions.map(({ to, label, icon: Icon }) => <Button key={to} type="button" variant={to === 'accepted' ? 'default' : 'outline'} size="sm" disabled={busy} onClick={() => { void transition(to); }}><Icon className="size-3.5" />{label}</Button>)}</div>{error && <><ErrorNotice error={error} /><Button variant="outline" size="sm" disabled={busy} onClick={() => { void transition('accepted'); }}>{t('errors.retry')}</Button></>}
  </div>;
}

function ConversationChat({ store, projectId, conversation, onClose, onOpenTask }: { store: Store; projectId: string; conversation: Conversation; onClose?: (() => void) | undefined; onOpenTask?: ((id: string) => void) | undefined }) {
  const t = useT();
  const id = useId();
  const draftKey = `${projectId}:${conversation.id}`;
  const entries = conversationDrafts(store);
  const [draft, setDraft] = useState<Draft>(() => entries.get(draftKey) ?? emptyDraft());
  const [attempt, setAttempt] = useState<{ command: ReturnType<typeof chatSend>; draft: Draft } | null>(null);
  const state = store.useStoreSelector(value => ({ messages: value.messages[conversation.id], turns: value.turns[conversation.id], messageError: value.errors[`messages:${conversation.id}`], pending: attempt ? value.pending[attempt.command.commandId] : undefined, tasks: value.tasks, session: value.session }), shallowSelectionEqual);
  const classic = store.useStoreSelector(value => value.projects.find(project => project.id === projectId)?.leadChatMode === 'classic');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const composing = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [jump, setJump] = useState(false);
  const messages = state.messages;
  const runIds = messages?.flatMap(({ message }) => message.leadCards?.flatMap(card => card.kind === 'run' ? [card.runId] : []) ?? []).join(',') ?? '';
  const runUpdates = useLeadRunUpdates(projectId, runIds);
  const lastUser = messages?.findLast(item => item.message.speaker === 'user');
  const turn = lastUser && state.turns?.find(item => item.id === lastUser.message.id);
  const pending = state.pending;
  const number = new Intl.NumberFormat(i18n.locale);
  const date = new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' });
  const tooLong = draft.text.length > 32_000;
  const disabled = !draft.text.trim() || tooLong || busy || state.session !== 'authenticated';
  const allProposed = state.tasks.filter(task => task.state === 'proposed');
  const [showAllProposed, setShowAllProposed] = useState(false);
  const proposed = allProposed.slice(0, 5);
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
    const created = { command: chatSend({ projectId, conversationId: conversation.id, conversationRevision: conversation.revision,
      text: draft.text, ...(classic ? { intent: draft.intent } : {}) }), draft };
    setAttempt(created); void execute(created);
  }
  return <div className="project-chat flex h-full min-h-0 flex-col overflow-hidden">
    <ChatHeader onClose={onClose} />
    {state.messageError && <div className="p-4 pb-0"><ErrorNotice error={state.messageError} /></div>}
    <div ref={log} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable]" role="log" aria-live="polite" aria-label={t('chatUi.messages')} tabIndex={0} onScroll={() => { const node = log.current; if (!node) return; nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 64; if (nearBottom.current) setJump(false); }}>
      {!messages?.length && <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center"><MascotEmpty seat="Lead" size={64} fallback={<><MessageCircle aria-hidden="true" className="size-6 text-muted-foreground" /><p className="text-sm text-muted-foreground">{t('empty.messages')}</p></>}><p className="text-sm text-muted-foreground">{t('empty.messages')}</p><p className="text-sm text-muted-foreground">{t('chatUi.greeting')}</p></MascotEmpty></div>}
      {messages?.map(({ message }) => {
        const user = message.speaker === 'user';
        if (message.speaker === 'system') return <p key={message.id} className="shrink-0 text-center text-xs text-muted-foreground">{message.text}</p>;
        return <article key={message.id} className={`flex min-w-0 shrink-0 items-start gap-2 ${user ? 'max-w-[92%] self-end flex-row-reverse' : 'w-full self-start'}`}>
          {user ? <Avatar size="sm" className="shrink-0 bg-primary"><AvatarFallback className="bg-primary text-primary-foreground">You</AvatarFallback></Avatar> : <LeadAvatar />}
          <div className="min-w-0 flex-1 space-y-1 text-left">
            <div className={`min-w-0 rounded-xl px-4 py-3 text-sm leading-6 ${user ? 'bg-secondary' : 'bg-transparent'}`}>
              {user ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</p> : <MarkdownContent content={message.text} className="space-y-3 leading-6 [&_pre]:max-w-full [&_pre]:p-3" />}
            </div>
            {message.leadCards?.map(card => <LeadChatCard key={card.kind} projectId={projectId} card={card} onOpenTask={onOpenTask}
              refreshKey={card.kind === 'run' ? runUpdates.epoch + (runUpdates.revisions[card.runId] ?? 0) : 0} />)}
            <time dateTime={message.createdAt} className={`block text-xs text-muted-foreground ${user ? 'text-right' : ''}`}>{date.format(new Date(message.createdAt))}</time>
          </div>
        </article>;
      })}
      {proposed.length > 0 && <Collapsible defaultOpen={allProposed.length <= 3} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="group h-auto min-w-0 whitespace-normal px-0 text-left"><ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />{plural(t, i18n.locale, allProposed.length, 'chatUi.proposes').replace('{count}', number.format(allProposed.length))}</Button></CollapsibleTrigger>
          {allProposed.length > 1 && <PlanActions store={store} projectId={projectId} tasks={allProposed} />}
        </div>
        <CollapsibleContent className="space-y-3">
        {proposed.map(task => <ProposalCard key={task.id} store={store} projectId={projectId} task={task} detailsOpen={allProposed.length <= 3} />)}
        {allProposed.length > 5 && <Collapsible open={showAllProposed} onOpenChange={setShowAllProposed} className="space-y-3">
          <CollapsibleContent className="space-y-3">{allProposed.slice(5).map(task => <ProposalCard key={task.id} store={store} projectId={projectId} task={task} detailsOpen={false} />)}</CollapsibleContent>
          <CollapsibleTrigger asChild><Button type="button" variant="outline" size="sm">{showAllProposed ? t('chatUi.hideProposals') : t('chatUi.showAllProposals').replace('{count}', String(allProposed.length))}</Button></CollapsibleTrigger>
        </Collapsible>}
        </CollapsibleContent>
      </Collapsible>}
    </div>
    {jump && <div className="px-4 pb-3"><Button variant="outline" size="sm" onClick={latest}>{t('chatUi.jump')}</Button></div>}
    {turn && turn.state !== 'done' && <p role="status" className="flex items-center gap-2 px-4 pb-3 text-sm text-muted-foreground"><Mascot seat="Lead" state={turn.state === 'queued' || turn.state === 'running' ? 'thinking' : 'attention'} size={32} fallback={<Spinner />} />{t(turn.state === 'queued' || turn.state === 'running' ? 'chatUi.working' : turn.state === 'budget-blocked' ? 'chatUi.blocked' : 'chatUi.resend')}</p>}
    <form className="shrink-0 space-y-3 border-t border-border p-4" onSubmit={submit}>
      <label htmlFor={`${id}-message`} className="sr-only">{t('chatUi.message')}</label><Textarea id={`${id}-message`} rows={3} maxLength={32_001} value={draft.text} aria-invalid={tooLong || undefined} aria-describedby={`${id}-help${draft.text.length ? ` ${id}-count` : ''}${tooLong ? ` ${id}-limit` : ''}`} placeholder={t('chatUi.message')} className="max-h-52 min-h-16 resize-none px-3 py-2 [field-sizing:content]" onChange={event => changeDraft({ ...draft, text: event.target.value })} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === 'Enter' && event.ctrlKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) { event.preventDefault(); submit(); } }} />
      <div className="flex flex-wrap items-center gap-3">{classic && <ToggleGroup type="single" value={draft.intent} disabled={busy} onValueChange={value => { if (value === 'discuss' || value === 'delegate') changeDraft({ ...draft, intent: value }); }} aria-label={t('chatUi.intent')} spacing={0} className="rounded-md border border-border"><ToggleGroupItem value="discuss" title={t('chatUi.discussHelp')} aria-describedby={`${id}-discuss-help`} className="h-8 rounded-md border-0 px-3 text-xs font-normal data-[state=on]:bg-secondary">{t('chatUi.discuss')}</ToggleGroupItem><ToggleGroupItem value="delegate" title={t('chatUi.delegateHelp')} aria-describedby={`${id}-delegate-help`} className="h-8 rounded-md border-0 px-3 text-xs font-normal data-[state=on]:bg-secondary">{t('chatUi.delegate')}</ToggleGroupItem></ToggleGroup>}<span id={`${id}-shortcut`} className="ml-auto text-xs text-muted-foreground"><KbdGroup><Kbd>Ctrl</Kbd><Kbd>Enter</Kbd></KbdGroup></span><Button type="submit" size="icon" className="h-9 w-9 border-0" disabled={disabled} aria-label={t('chatUi.send')}><ArrowUp className="size-4" /></Button></div>
      <span id={`${id}-discuss-help`} className="sr-only">{t('chatUi.discussHelp')}</span><span id={`${id}-delegate-help`} className="sr-only">{t('chatUi.delegateHelp')}</span>
      <p id={`${id}-help`} className="sr-only">{t(classic ? draft.intent === 'discuss' ? 'chatUi.discussHelp' : 'chatUi.delegateHelp' : 'leadChatUi.help')}</p><div className="flex justify-end gap-3 text-xs">{(draft.text.length > 0) && <span id={`${id}-count`} className={`whitespace-nowrap ${tooLong ? 'text-destructive' : 'text-muted-foreground'}`}>{number.format(draft.text.length)} / {number.format(32_000)}</span>}</div>
      {tooLong && <p id={`${id}-limit`} role="alert" className="text-sm text-destructive">{t('chatUi.tooLong')}</p>}{pending?.error && <ErrorNotice error={pending.error} />}<div className="flex justify-end">{pending?.status === 'failed' && attempt && <Button type="button" variant="outline" disabled={busy || state.session !== 'authenticated'} onClick={() => { void execute(attempt, true); }}>{t('errors.retry')}</Button>}</div>
    </form>
  </div>;
}

