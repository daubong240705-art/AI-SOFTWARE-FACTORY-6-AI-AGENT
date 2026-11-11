import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { DecisionPanel } from './DecisionDialog';
import { RequestPanel } from './Requests';
import { attentionItems, type AttentionItem } from './shell/attention';
import { relativeTime } from './Inbox';
import { ProjectTile } from './shell/ProjectTile';
import { GatePanel, PatchPanel, ReadOnlyPanel } from './attention/Details';

export function attentionHash(key?: string): string { return key ? `#/attention/${encodeURIComponent(key)}` : '#/attention'; }
function hashKey(): string | undefined {
  const match = /^#\/attention\/([^/]+)$/.exec(location.hash);
  try { return match?.[1] ? decodeURIComponent(match[1]) : undefined; } catch { return undefined; }
}
export function Attention({ store }: { store: Store }) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  const rows = useMemo(() => attentionItems(state.globalInbox), [state.globalInbox]);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(() => hashKey());
  const [readyProject, setReadyProject] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const list = useRef<HTMLUListElement>(null); const pane = useRef<HTMLElement>(null);
  const previous = useRef<AttentionItem[]>(rows); const restoreFocus = useRef(false);
  const selected = rows.find(row => row.key === selectedKey) ?? rows[0];
  useEffect(() => { void store.loadGlobalInbox(); }, [store]);
  useEffect(() => {
    const sync = () => setSelectedKey(hashKey());
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  useEffect(() => {
    if (state.loading.globalInbox) return;
    if (!rows.length) { previous.current = []; return; }
    if (!rows.some(row => row.key === selectedKey)) {
      const index = previous.current.findIndex(row => row.key === selectedKey);
      const next = rows[Math.max(0, Math.min(index, rows.length - 1))];
      if (next) { restoreFocus.current = index >= 0; setSelectedKey(next.key); }
    }
    previous.current = rows;
  }, [rows, selectedKey, state.loading.globalInbox]);
  useEffect(() => {
    if (selected && location.hash !== attentionHash(selected.key)) history.replaceState(null, '', attentionHash(selected.key));
    if (!selected && !state.loading.globalInbox) history.replaceState(null, '', attentionHash());
    if (restoreFocus.current) {
      const button = list.current?.querySelector<HTMLButtonElement>('[aria-current="true"]');
      if (button) { button.focus(); restoreFocus.current = false; }
    }
  }, [selected?.key, selectedKey, state.loading.globalInbox]);
  useEffect(() => {
    let active = true; setReadyProject(null);
    if (!selected) return;
    const id = selected.projectId;
    void (async () => {
      if (store.getState().selectedProjectId !== id) await store.selectProject(id);
      if (active && store.getState().selectedProjectId === id && store.getState().session === 'authenticated') setReadyProject(id);
    })();
    return () => { active = false; };
  }, [store, selected?.projectId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || event.isComposing || document.querySelector('[role="dialog"], dialog[open]')) return;
      if (target instanceof HTMLElement && (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
      const inList = target instanceof Node && !!list.current?.contains(target);
      const key = event.key.toLowerCase();
      const direction = key === 'j' || (inList && key === 'arrowdown') ? 1 : key === 'k' || (inList && key === 'arrowup') ? -1 : 0;
      if (direction && rows.length) {
        event.preventDefault(); const index = rows.findIndex(row => row.key === selected?.key);
        const row = rows[Math.max(0, Math.min(index + direction, rows.length - 1))]; if (row) select(row, true);
      } else if (selected?.actionable && (key === 'a' || key === 'r')) {
        const action = pane.current?.querySelector<HTMLButtonElement>(`[data-attention-${key === 'a' ? 'primary' : 'changes'}]`);
        if (action && !action.disabled) { event.preventDefault(); action.click(); }
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  function select(row: AttentionItem, focus = false) {
    restoreFocus.current = focus; setSelectedKey(row.key);
    if (location.hash !== attentionHash(row.key)) location.hash = attentionHash(row.key);
  }
  function decided() {
    setCompleted(true); restoreFocus.current = true;
    const remaining = attentionItems(store.getState().globalInbox);
    const oldIndex = rows.findIndex(row => row.key === selected?.key);
    const next = rows.slice(oldIndex + 1).find(row => remaining.some(item => item.key === row.key)) ?? remaining.find(row => row.key !== selected?.key);
    if (next) select(next, true); else if (!remaining.length) { setSelectedKey(undefined); pane.current?.focus(); }
  }
  const name = (row: AttentionItem) => row.projectName ?? state.projects.find(project => project.id === row.projectId)?.name ?? t('overview.project');
  if (state.session !== 'authenticated') return null;
  return <div className="attention-screen">
    <section className="attention-list" aria-labelledby="attention-list-title"><h1 id="attention-list-title">{t('nav.attention')}</h1>
      {state.loading.globalInbox && <p role="status">{t('viewStates.loading')}</p>}
      {state.errors.globalInbox && <><ErrorNotice error={state.errors.globalInbox} /><Button onClick={() => { void store.loadGlobalInbox(); }}>{t('errors.retry')}</Button></>}
      {!rows.length && !state.loading.globalInbox && !state.errors.globalInbox && <p className="attention-empty">{t('attention.empty')} <a href="#/overview">{t('nav.overview')}</a></p>}
      <ul ref={list} aria-label={t('attention.list')}>{rows.map(row => {
        const code = row.code ?? state.tasks.find(task => task.projectId === row.projectId && task.id === state.globalInbox.approvals.find(approval => `approval:${approval.id}` === row.key)?.taskId)?.code;
        return <li key={row.key}><button type="button" aria-current={selected?.key === row.key ? 'true' : undefined} className="attention-item" onClick={() => select(row)}>
          <strong>{t(`attention.kinds.${row.kind}`)}: {row.title}</strong><span className="attention-project"><ProjectTile id={row.projectId} name={name(row)} /><span>{name(row)}</span>{code && <span>{code}</span>}{!row.since.startsWith('9999') && <time dateTime={row.since}>{relativeTime(row.since)}</time>}</span>
        </button></li>;
      })}</ul>
    </section>
    <section ref={pane} tabIndex={-1} className="attention-detail" aria-label={t('attention.detail')}>
      {selected && (readyProject === selected.projectId && state.selectedProjectId === selected.projectId
        ? <AttentionDetail key={selected.key} store={store} row={selected} onSuccess={decided} /> : <p role="status">{t('viewStates.loading')}</p>)}
    </section>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-attention-announcement>{completed ? `${t('inboxUi.decided')} ` : ''}{selected ? `${t('attention.selected')}: ${selected.title}` : t('attention.empty')}</p>
  </div>;
}
function AttentionDetail({ store, row, onSuccess }: { store: Store; row: AttentionItem; onSuccess: () => void }) {
  if ((row.kind === 'review' || row.kind === 'question') && row.selection) return <DecisionPanel store={store} approvalId={row.selection.id} onClose={() => {}} inline onSuccess={onSuccess} />;
  if (row.kind === 'request' && row.selection) return <RequestPanel store={store} taskId={row.selection.id} onClose={() => {}} inline onSuccess={onSuccess} />;
  if (row.kind === 'start-gate' && row.selection) return <GatePanel store={store} row={row} taskId={row.selection.id} onSuccess={onSuccess} />;
  if (row.kind === 'plan-patch') return <PatchPanel store={store} row={row} onSuccess={onSuccess} />;
  return <ReadOnlyPanel store={store} row={row} />;
}
