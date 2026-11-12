import { Crossfade } from '@/components/motion/Crossfade';
import { AnimatePresence } from 'motion/react';
import { Stagger, StaggerItem } from '@/components/motion/Stagger';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck } from 'lucide-react';
import { Mascot, MascotEmpty } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ErrorNotice } from '../components/ErrorNotice';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { DecisionPanel } from './DecisionDialog';
import { RequestPanel } from './Requests';
import { attentionItems, type AttentionItem } from './shell/attention';
import { relativeTime } from './Inbox';
import { ProjectTile } from './shell/ProjectTile';
import { GatePanel, PatchPanel, ReadOnlyPanel, IntegrationConflictPanel } from './attention/Details';
import { attentionTitle } from './attention/presentation';

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
    // Focus the selected row by its key: a row that was just decided may still be leaving with aria-current.
    if (restoreFocus.current && selected) {
      const button = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-row-key]') ?? [])].find(node => node.dataset.rowKey === selected.key);
      if (button) { button.focus(); restoreFocus.current = false; }
    }
  }, [selected?.key, selectedKey, state.loading.globalInbox, rows]);
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
  return <div className="grid h-full min-h-0 grid-cols-1 overflow-auto bg-background text-foreground md:grid-cols-[340px_minmax(0,1fr)] md:overflow-hidden">
    <section className="min-h-0 overflow-auto border-b border-border md:border-r md:border-b-0" aria-labelledby="attention-list-title">
      <header className="flex items-center gap-3 p-6"><h1 id="attention-list-title" className="font-display text-xl font-semibold tracking-tight">{t('nav.attention')}</h1><Badge variant="secondary" className="tabular-nums">{rows.length}</Badge></header>
      {state.loading.globalInbox && <div role="status" className="space-y-3 px-6 pb-4"><span className="sr-only">{t('viewStates.loading')}</span><Skeleton className="h-5 w-4/5" /><Skeleton className="h-4 w-3/5" /></div>}
      {state.errors.globalInbox && <><ErrorNotice error={state.errors.globalInbox} /><Button onClick={() => { void store.loadGlobalInbox(); }}>{t('errors.retry')}</Button></>}
      {!rows.length && !state.loading.globalInbox && !state.errors.globalInbox && <Empty className="p-6"><MascotEmpty seat="Lead" state="success" fallback={<EmptyHeader><EmptyMedia variant="icon"><CheckCheck /></EmptyMedia><EmptyDescription>{t('attention.empty')}</EmptyDescription></EmptyHeader>}><EmptyDescription>{t('attention.empty')}</EmptyDescription></MascotEmpty><Button asChild variant="outline"><a href="#/overview">{t('nav.overview')}</a></Button></Empty>}
      <Stagger ref={list} aria-label={t('attention.list')} className="m-0 list-none p-0"><AnimatePresence initial={false}>{rows.map((row, index) => {
        const code = row.code ?? state.tasks.find(task => task.projectId === row.projectId && task.id === state.globalInbox.approvals.find(approval => `approval:${approval.id}` === row.key)?.taskId)?.code;
        return <StaggerItem key={row.key} index={index} collapse><Button type="button" variant="ghost" data-row-key={row.key} aria-current={selected?.key === row.key ? 'true' : undefined} aria-selected={selected?.key === row.key} className={cn('h-auto w-full flex-col items-stretch gap-2 rounded-none border-t border-l-2 border-t-border border-l-transparent px-6 py-3 text-left whitespace-normal hover:bg-card', selected?.key === row.key && 'border-l-need bg-secondary hover:bg-secondary')} onClick={() => select(row)}>
          <span className="flex items-start gap-3"><Mascot seat={state.activity?.teams.flatMap(team => team.seats).find(seat => seat.needsYou.some(need => `approval:${need.approvalId}` === row.key))?.name ?? 'Lead'} size={32} state="attention" /><strong className="min-w-0 flex-1 text-sm leading-relaxed font-semibold break-words">{attentionTitle(row.title)}</strong>{row.actionable && <span aria-label={t('inboxUi.needsDecision')} className="mt-2 size-1.5 shrink-0 rounded-full bg-need" />}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal text-muted-foreground"><ProjectTile id={row.projectId} name={name(row)} className="h-5 w-6" /><span>{name(row)}</span>{code && <span className="font-mono">{code}</span>}{!row.since.startsWith('9999') && <time dateTime={row.since} className="ml-auto">{relativeTime(row.since)}</time>}</span>
        </Button></StaggerItem>;
      })}</AnimatePresence></Stagger>
    </section>
    <section ref={pane} tabIndex={-1} className="flex min-h-0 min-w-0 flex-col overflow-auto outline-none" aria-label={t('attention.detail')}>
      {selected && (readyProject === selected.projectId && state.selectedProjectId === selected.projectId
        ? <Crossfade contentKey={selected.key}><AttentionDetail store={store} row={selected} onSuccess={decided} /></Crossfade> : <MascotEmpty seat="Lead" state="thinking" compact><p role="status">{t('viewStates.loading')}</p></MascotEmpty>)}
    </section>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-attention-announcement>{completed ? `${t('inboxUi.decided')} ` : ''}{selected ? `${t('attention.selected')}: ${selected.title}` : t('attention.empty')}</p>
  </div>;
}
function AttentionDetail({ store, row, onSuccess }: { store: Store; row: AttentionItem; onSuccess: () => void }) {
  if (row.kind === 'integration-conflict') return <IntegrationConflictPanel store={store} row={row} onSuccess={onSuccess} />;
  if ((row.kind === 'review' || row.kind === 'question') && row.selection) return <DecisionPanel store={store} approvalId={row.selection.id} onClose={() => {}} inline onSuccess={onSuccess} />;
  if (row.kind === 'request' && row.selection) return <RequestPanel store={store} taskId={row.selection.id} onClose={() => {}} inline onSuccess={onSuccess} />;
  if (row.kind === 'start-gate' && row.selection) return <GatePanel store={store} row={row} taskId={row.selection.id} onSuccess={onSuccess} />;
  if (row.kind === 'plan-patch') return <PatchPanel store={store} row={row} onSuccess={onSuccess} />;
  return <ReadOnlyPanel store={store} row={row} />;
}
