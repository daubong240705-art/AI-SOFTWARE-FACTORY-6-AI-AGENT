import { useId, useRef, useState } from 'react';
import type { Command } from '@factory/contracts';
import { chatSend, conversationsCreate } from '../api/commands';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';
import { relativeTime } from './Inbox';
import { attentionItems, type AttentionItem } from './shell/attention';
import { ProjectTile } from './shell/ProjectTile';

type Intent = 'discuss' | 'delegate';
// Keep command identities across retries, including unknown transport outcomes.
 type Attempt = { projectId: string; text: string; intent: Intent; create?: Command; send?: Command };
export function Overview({ store, onProject, onAttention, onCreate, operatorName }: {
  store: Store; onProject: (id: string) => void; onAttention: (item?: AttentionItem) => void; onCreate: () => void; operatorName?: string;
}) {
  const t = useT(); const id = useId(); const state = store.useStoreSelector(value => value);
  const [text, setText] = useState(''); const [chosen, setChosen] = useState(''); const [intent, setIntent] = useState<Intent>('delegate');
  const [busy, setBusy] = useState(false); const [problem, setProblem] = useState('');
  const attempt = useRef<Attempt | null>(null); const sending = useRef(false); const composing = useRef(false);
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
  return <div className="overview">
    <h1>{t('overview.greeting')}{operatorName && <>, <em>{operatorName}</em></>}</h1>
    {attentionItems(state.globalInbox).length > 0 && <p className="overview-sub">{t('overview.waiting').replace('{count}', new Intl.NumberFormat(i18n.locale).format(attentionItems(state.globalInbox).length))}</p>}
    <div className="overview-grid">
      {state.projects.length ? <form className="overview-composer" aria-label={t('overview.composer')} onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label className="sr-only" htmlFor={`${id}-text`}>{t('overview.message')}</label>
        <textarea id={`${id}-text`} placeholder={t('overview.placeholder')} value={text} disabled={busy} aria-invalid={tooLong || undefined} aria-describedby={tooLong ? `${id}-limit` : `${id}-shortcut`}
          onChange={event => { setText(event.target.value); attempt.current = null; }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={event => { if (event.ctrlKey && event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) { event.preventDefault(); void submit(); } }} />
        {tooLong && <p id={`${id}-limit`} className="field-error" role="alert">{t('chatUi.tooLong')}</p>}
        <div className="overview-composer-actions">
          <label htmlFor={`${id}-project`}>{t('overview.project')}</label><select id={`${id}-project`} value={projectId} disabled={busy} onChange={event => { setChosen(event.target.value); attempt.current = null; }}>
            {state.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <div role="group" aria-label={t('chatUi.intent')} className="intent-segment">
            <button type="button" aria-pressed={intent === 'discuss'} disabled={busy} onClick={() => { setIntent('discuss'); attempt.current = null; }}>{t('overview.ask')}</button>
            <button type="button" aria-pressed={intent === 'delegate'} disabled={busy} onClick={() => { setIntent('delegate'); attempt.current = null; }}>{t('overview.delegate')}</button>
          </div>
          <span className="composer-shortcut" id={`${id}-shortcut`}><kbd>Ctrl</kbd> <kbd>Enter</kbd> {t('overview.toSend')}</span>
          <Button variant="primary" type="submit" disabled={disabled}>{t('chatUi.send')}</Button>
        </div>
        {error && <ErrorNotice error={error} />}{problem && <p role="alert">{t(problem)}</p>}
        {(error || problem) && <Button disabled={busy} onClick={() => { void submit(true); }}>{t('errors.retry')}</Button>}
      </form> : <section className="overview-composer stack" aria-label={t('overview.composer')}><p>{t('projects.empty')}</p><Button variant="primary" onClick={onCreate}>{t('projects.create')}</Button></section>}
      <aside className="overview-needs" aria-labelledby={`${id}-needs`}>
        <h2 id={`${id}-needs`}>{t('nav.attention')}</h2>
        {state.loading.globalInbox && <p role="status">{t('viewStates.loading')}</p>}
        {state.errors.globalInbox && <><ErrorNotice error={state.errors.globalInbox} /><Button onClick={() => { void store.loadGlobalInbox(); }}>{t('errors.retry')}</Button></>}
        {!items.length && !state.loading.globalInbox && !state.errors.globalInbox && <p className="needs-empty">{t('overview.caughtUp')}</p>}
        {items.map(item => {
          const name = item.projectName ?? state.projects.find(project => project.id === item.projectId)?.name ?? t('overview.project');
          return <button type="button" className="attention-row" key={item.key} onClick={() => onAttention(item)}>
            <strong>{item.title}</strong>{!item.since.startsWith('9999') && <time dateTime={item.since}>{relativeTime(item.since)}</time>}
            <span className="attention-project"><ProjectTile id={item.projectId} name={name} /><span>{name}</span></span>
          </button>;
        })}
        <button type="button" className="view-all" onClick={() => onAttention()}>{t('overview.viewAll')}</button>
      </aside>
    </div>
  </div>;
}
