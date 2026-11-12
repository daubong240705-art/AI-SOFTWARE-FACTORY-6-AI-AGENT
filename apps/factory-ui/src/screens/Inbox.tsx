import { MascotEmpty } from '@/components/mascot';
import { RequestPanel } from './Requests';
import { useEffect, useId, useState } from 'react';
import type { Inbox as InboxModel } from '../api/client';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { i18n, plural, useT } from '../i18n';
import type { Store } from '../state/store';
import { DecisionDialog } from './DecisionDialog';
import { TaskDetail } from './TaskDetail';

export function inboxCount(t: (key: string) => string, count: number) { return `${new Intl.NumberFormat(i18n.locale).format(count)} ${plural(t, i18n.locale, count, 'inboxUi.count')}`; }
export function relativeTime(value: string, now = Date.now()): string {
  const seconds = (Date.parse(value) - now) / 1000;
  const [size, unit] = Math.abs(seconds) >= 86400 ? [86400, 'day'] as const : Math.abs(seconds) >= 3600 ? [3600, 'hour'] as const : Math.abs(seconds) >= 60 ? [60, 'minute'] as const : [1, 'second'] as const;
  return new Intl.RelativeTimeFormat(i18n.locale, { numeric: 'always', style: 'short' }).format(Math.round(seconds / size), unit);
}
export type InboxSelection = { kind: 'approval' | 'task' | 'request'; id: string };
type Selection = InboxSelection;
export function Inbox({ store, global = false, onClose, initialSelection }: { store: Store; global?: boolean; onClose?: () => void; initialSelection?: (InboxSelection & { projectId: string }) | undefined }) {
  const t = useT(); const id = useId();
  const state = store.useStoreSelector(value => value);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void (global ? store.loadGlobalInbox() : store.loadInbox()); }, [store, global]);
  useEffect(() => {
    if (!initialSelection) return;
    let active = true;
    void (async () => {
      if (store.getState().selectedProjectId !== initialSelection.projectId) await store.selectProject(initialSelection.projectId);
      if (active && store.getState().session === 'authenticated' && store.getState().selectedProjectId === initialSelection.projectId) setSelection(initialSelection);
    })();
    return () => { active = false; };
  }, [store, initialSelection?.projectId, initialSelection?.id, initialSelection?.kind]);
  const inbox = global ? state.globalInbox : state.inbox;
  async function open(projectId: string, selected: Selection) {
    if (busy) return; setBusy(true);
    try { if (projectId !== store.getState().selectedProjectId) await store.selectProject(projectId); if (store.getState().session === 'authenticated' && store.getState().selectedProjectId === projectId) setSelection(selected); }
    finally { setBusy(false); }
  }
  if (state.session !== 'authenticated') return null;
  if (selection?.kind === 'approval') return <DecisionDialog store={store} approvalId={selection.id} onClose={() => setSelection(null)} />;
  if (selection?.kind === 'request') return <RequestPanel store={store} taskId={selection.id} onClose={() => setSelection(null)} />;
  if (selection?.kind === 'task') return <TaskDetail store={store} taskId={selection.id} onClose={() => setSelection(null)} />;
  const content = <>
    {onClose && <Button onClick={onClose}>{t('inboxUi.close')}</Button>}
    <h2 id={id}>{t('inboxUi.title')} {inbox.counts.total > 0 && <Badge>{inboxCount(t, inbox.counts.total)}</Badge>}</h2>
    {state.loading[global ? 'globalInbox' : 'inbox'] && <MascotEmpty seat="Lead" state="thinking" compact><p role="status">{t('viewStates.loading')}</p></MascotEmpty>}
    {state.errors[global ? 'globalInbox' : 'inbox'] && <><ErrorNotice error={state.errors[global ? 'globalInbox' : 'inbox']!} /><Button onClick={() => { void (global ? store.loadGlobalInbox() : store.loadInbox()); }}>{t('errors.retry')}</Button></>}
    <InboxItems inbox={inbox} store={store} global={global} busy={busy} onOpen={(projectId, item) => { void open(projectId, item); }} />
  </>;
  return onClose ? <Dialog labelledBy={id} onClose={onClose}>{content}</Dialog> : <section className="stack inbox">{content}</section>;
}
function InboxItems({ inbox, store, global, busy, onOpen }: { inbox: InboxModel; store: Store; global: boolean; busy: boolean; onOpen: (projectId: string, selection: Selection) => void }) {
  const t = useT(); const tasks = store.useStoreSelector(state => state.tasks);
  if (!inbox.approvals.length && !inbox.startGates.length && !inbox.requests?.length) return <MascotEmpty seat="Lead" state="success"><p>{t('inboxUi.empty')}</p></MascotEmpty>;
  return <ul className="task-list stack inbox-list">
    {!!inbox.requests?.length && <li className="stack"><h3>{t('m3.awaitingTriage')}</h3><ul>{inbox.requests.map(item => <li key={item.taskId} className="card stack"><h4>{item.code} {item.subject}</h4>{global && <p>{item.projectName}</p>}<Button disabled={busy} onClick={() => onOpen(item.projectId ?? store.getState().selectedProjectId!, { kind: 'request', id: item.taskId })}>{t('m3.openRequest')}</Button></li>)}</ul></li>}
    {[...inbox.approvals].sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt)).map(item => <li key={item.id} className="card stack">
      <Badge>{t(`inboxUi.kinds.${item.kind}`)}</Badge>{global && <p>{item.projectName}</p>}
      <h3>{tasks.find(task => task.id === item.taskId && task.projectId === item.projectId)?.code} {item.subject}</h3>
      <p>{t('inboxUi.requested')} {relativeTime(item.requestedAt)}</p><p>{t('inboxUi.expires')} {relativeTime(item.expiresAt)}</p>
      <Button variant="primary" disabled={busy} onClick={() => onOpen(item.projectId, { kind: item.kind === 'start-gate' ? 'task' : 'approval', id: item.kind === 'start-gate' ? item.taskId! : item.id })}>{t(`inboxUi.open.${item.kind}`)}</Button>
    </li>)}
    {inbox.startGates.map(item => <li key={`gate:${item.taskId}`} className="card stack"><Badge>{t('inboxUi.kinds.start-gate')}</Badge>{global && <p>{item.projectName}</p>}<h3>{item.code} {item.title}</h3><Button variant="primary" disabled={busy} onClick={() => onOpen(item.projectId, { kind: 'task', id: item.taskId })}>{t('inboxUi.open.start-gate')}</Button></li>)}
  </ul>;
}
