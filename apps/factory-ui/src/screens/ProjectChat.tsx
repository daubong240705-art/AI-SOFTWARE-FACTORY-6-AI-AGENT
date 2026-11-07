import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { Command, Conversation } from '@factory/contracts';
import { chatSend, conversationsCreate } from '../api/commands';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorNotice } from '../components/ErrorNotice';

type Draft = { text: string; intent: 'discuss' | 'delegate' };
// Drafts are memory-only and scoped to a store/session's conversation, never browser storage.
const drafts = new WeakMap<Store, Map<string, Draft>>();
function conversationDrafts(store: Store) {
  let entries = drafts.get(store);
  if (!entries) { entries = new Map(); drafts.set(store, entries); }
  return entries;
}
const emptyDraft = (): Draft => ({ text: '', intent: 'discuss' });

export function ProjectChat({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT();
  const state = store.useStoreSelector((value) => value);
  const conversation = state.conversations[0];
  const [command, setCommand] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const lead = state.team?.seats.find((seat) => seat.isLead);
  const pending = command ? state.pending[command.commandId] : undefined;
  async function execute(created: Command, retry = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await (retry ? store.retry(created.commandId) : store.send(created));
      if (result && store.getState().session === 'authenticated') {
        await store.loadConversations(); setCommand(null);
      } else if (store.getState().pending[created.commandId]?.error?.code === 'conflict') await store.loadConversations();
    } finally { inFlight.current = false; setBusy(false); }
  }
  if (conversation) return <ConversationChat key={`${projectId}:${conversation.id}`} store={store} projectId={projectId} conversation={conversation} />;
  return <Card>
    <h2>{t('tabs.chat')}</h2><p>{t('empty.conversations')}</p>
    {state.errors.conversations && <ErrorNotice error={state.errors.conversations} />}
    {state.errors.team && <ErrorNotice error={state.errors.team} />}
    {state.team && !lead && <p role="alert" className="error-notice">{t('chatUi.noLead')}</p>}
    {pending?.error && <ErrorNotice error={pending.error} />}
    {pending?.status === 'failed' && command ? <Button disabled={busy || state.session !== 'authenticated'} onClick={() => { void execute(command, true); }}>{t('errors.retry')}</Button>
      : <Button variant="accent" disabled={!state.team || !lead || busy || state.session !== 'authenticated'} onClick={() => {
        if (!lead || inFlight.current) return;
        const created = conversationsCreate({ projectId, seatId: lead.id, title: 'Lead' });
        setCommand(created); void execute(created);
      }}>{t('chatUi.start')}</Button>}
  </Card>;
}

function ConversationChat({ store, projectId, conversation }: { store: Store; projectId: string; conversation: Conversation }) {
  const t = useT();
  const state = store.useStoreSelector((value) => value);
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
  const lastUser = messages?.findLast((item) => item.message.speaker === 'user');
  // Host turn IDs identify the originating user message. Never use an older turn's status.
  const turn = lastUser && state.turns[conversation.id]?.find((item) => item.id === lastUser.message.id);
  const pending = attempt ? state.pending[attempt.command.commandId] : undefined;
  const day = state.budget?.day;
  const number = new Intl.NumberFormat(i18n.locale);
  const date = new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' });
  const tooLong = draft.text.length > 32_000;
  const disabled = !draft.text.trim() || tooLong || busy || state.session !== 'authenticated';

  useEffect(() => { void store.loadMessages(conversation.id); }, [store, conversation.id]);
  function latest() {
    const node = log.current;
    if (node) node.scrollTop = node.scrollHeight;
    nearBottom.current = true; setJump(false);
  }
  useLayoutEffect(() => {
    if (nearBottom.current) latest();
    else if (messages?.length) setJump(true);
  }, [messages]);
  function changeDraft(next: Draft) { entries.set(draftKey, next); setDraft(next); }
  async function execute(created: NonNullable<typeof attempt>, retry = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await (retry ? store.retry(created.command.commandId) : store.send(created.command));
      if (result && store.getState().session === 'authenticated') {
        // Preserve any newer edits made while a send/retry was in flight.
        if (entries.get(draftKey) === created.draft) changeDraft(emptyDraft());
        setAttempt(null);
        await Promise.all([store.loadMessages(conversation.id), store.loadBudget()]);
      } else if (store.getState().pending[created.command.commandId]?.error?.code === 'conflict') await store.loadConversations();
    } finally { inFlight.current = false; setBusy(false); }
  }
  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (disabled || inFlight.current) return;
    const created = { command: chatSend({ projectId, conversationId: conversation.id, conversationRevision: conversation.revision, text: draft.text, intent: draft.intent }), draft };
    setAttempt(created); void execute(created);
  }
  return <Card className="project-chat">
    <header className="chat-heading"><h2>{conversation.title}</h2>
      {day ? <div className={`budget budget-${day.verdict}`}>
        <span>{t('chatUi.budget')}</span>
        <meter aria-label={t('chatUi.budget')} min={0} max={day.limit} value={Math.min(day.used, day.limit)} aria-valuemin={0} aria-valuemax={day.limit} aria-valuenow={Math.min(day.used, day.limit)} aria-valuetext={`${number.format(day.used)} / ${number.format(day.limit)} ${t('chatUi.tokens')}`} />
        <span>{number.format(day.used)} / {number.format(day.limit)} {t('chatUi.tokens')}</span><strong>{t(`chatUi.verdict.${day.verdict}`)}</strong>
      </div> : <p className="muted">{t('chatUi.budgetLoading')}</p>}
    </header>
    {state.errors.budget && <ErrorNotice error={state.errors.budget} />}
    {state.errors[`messages:${conversation.id}`] && <ErrorNotice error={state.errors[`messages:${conversation.id}`]!} />}
    <div ref={log} className="chat-log stack" role="log" aria-live="polite" aria-label={t('chatUi.messages')} tabIndex={0} onScroll={() => {
      const node = log.current;
      if (!node) return;
      nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 64;
      if (nearBottom.current) setJump(false);
    }}>
      {!messages?.length && <p className="muted">{t('empty.messages')}</p>}
      {messages?.map(({ message }) => <article key={message.id} className={`chat-bubble speaker-${message.speaker}`}>
        <div className="message-meta"><strong>{t(`chatUi.speakers.${message.speaker}`)}</strong><time dateTime={message.createdAt}>{date.format(new Date(message.createdAt))}</time></div>
        <p className="plain-text">{message.text}</p>
      </article>)}
    </div>
    {jump && <Button onClick={latest}>{t('chatUi.jump')}</Button>}
    {turn && turn.state !== 'done' && <p role="status">{t(turn.state === 'queued' || turn.state === 'running' ? 'chatUi.working' : turn.state === 'budget-blocked' ? 'chatUi.blocked' : 'chatUi.resend')}</p>}
    <form className="composer stack" onSubmit={submit}>
      <div className="field"><label htmlFor={`${id}-message`}>{t('chatUi.message')}</label>
        <textarea id={`${id}-message`} rows={3} value={draft.text} aria-invalid={tooLong || undefined} aria-describedby={`${id}-count${tooLong ? ` ${id}-limit` : ''}`} onChange={(event) => changeDraft({ ...draft, text: event.target.value })}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) { event.preventDefault(); submit(); } }} />
        <span id={`${id}-count`} className={tooLong ? 'field-error' : 'muted'}>{number.format(draft.text.length)} / {number.format(32_000)} {t('chatUi.characters')}</span>
        {tooLong && <p id={`${id}-limit`} className="field-error">{t('chatUi.tooLong')}</p>}
      </div>
      <fieldset className="intent-control"><legend>{t('chatUi.intent')}</legend>
        <label htmlFor={`${id}-discuss`}><input id={`${id}-discuss`} type="radio" name={`${id}-intent`} checked={draft.intent === 'discuss'} onChange={() => changeDraft({ ...draft, intent: 'discuss' })} />{t('chatUi.discuss')}</label>
        <label htmlFor={`${id}-delegate`}><input id={`${id}-delegate`} type="radio" name={`${id}-intent`} checked={draft.intent === 'delegate'} aria-describedby={`${id}-explanation`} onChange={() => changeDraft({ ...draft, intent: 'delegate' })} />{t('chatUi.delegate')}</label>
        <p id={`${id}-explanation`} className="muted">{t('chatUi.intentHelp')}</p>
      </fieldset>
      {pending?.error && <ErrorNotice error={pending.error} />}
      <div className="composer-actions">
        {pending?.status === 'failed' && attempt && <Button disabled={busy || state.session !== 'authenticated'} onClick={() => { void execute(attempt, true); }}>{t('errors.retry')}</Button>}
        <Button variant="accent" type="submit" disabled={disabled}>{t('chatUi.send')}</Button>
      </div>
    </form>
  </Card>;
}
