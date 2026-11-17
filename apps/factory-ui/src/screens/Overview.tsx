import { PortalCard } from './PortalCard';
import { PageHeader, Panel, Section } from '@/components/app';
import { LoadingState } from '@/components/LoadingState';
import { MascotEmpty } from '@/components/mascot';
import { Stagger, StaggerItem } from '@/components/motion/Stagger';
import { useId, useRef, useState } from 'react';
import type { Command } from '@factory/contracts';
import { useEffect } from 'react';
import { chatSend, conversationsCreate } from '../api/commands';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChevronRight } from 'lucide-react';
import { ErrorNotice } from '../components/ErrorNotice';
import { useT } from '../i18n';
import { ProjectGrid } from './overview/ProjectGrid';
import type { Store } from '../state/store';
import { attentionItems, type AttentionItem } from './shell/attention';
import { ProjectTile } from './shell/ProjectTile';
import { Select } from '../components/Select';
import { ActivityFeed } from './overview/ActivityFeed';
import { Page } from '../components/Page';

type Intent = 'discuss' | 'delegate';
// Keep command identities across retries, including unknown transport outcomes.
 type Attempt = { projectId: string; text: string; intent: Intent; create?: Command; send?: Command };
export function Overview({ store, onProject, onOpenProject, onAttention, onCreate, onPortal, operatorName, focusComposer, onTask }: {
  onPortal: () => void; store: Store; onProject: (id: string) => void; onOpenProject: (id: string) => void; onAttention: (item?: AttentionItem) => void; onCreate: (kind: 'task' | 'game' | 'project') => void; operatorName?: string; focusComposer?: number; onTask?: (projectId: string, taskId: string) => void;
}) {
  const t = useT(); const id = useId(); const state = store.useStoreSelector(value => value);
  const [text, setText] = useState(''); const [chosen, setChosen] = useState(''); const [intent, setIntent] = useState<Intent>('delegate');
  const [busy, setBusy] = useState(false); const [problem, setProblem] = useState('');
  const attempt = useRef<Attempt | null>(null); const sending = useRef(false); const composing = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focusComposer) return;
    const frame = requestAnimationFrame(() => composer.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusComposer]);
  const projectId = state.projects.some(project => project.id === chosen) ? chosen : state.projects[0]?.id ?? '';
  const pending = attempt.current?.send ?? attempt.current?.create;
  const error = pending ? state.pending[pending.commandId]?.error : undefined;
  const tooLong = text.length > 32_000;
  const disabled = !text.trim() || !projectId || tooLong || busy || state.session !== 'authenticated';
  const selecting = useRef<Promise<void> | undefined>(undefined);
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
      // The landing preselection may still be loading the team and conversations: finish it first,
      // or the composer would report a missing Lead or create a second Lead conversation.
      await selecting.current;
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
    if (state.projects.length && state.selectedProjectId === null) selecting.current = store.selectProject(state.projects[0]!.id);
  }, [store, state.projects, state.selectedProjectId]);
  return <Page className="overview min-w-0"><div className="mx-auto max-w-5xl space-y-6">
    <PageHeader title={<>{t('overview.greetingStart')} <span className="text-project-1">{t(`overview.${dayPart}`)}</span>{operatorName && <>, {operatorName}</>}</>} />
      {state.projects.length ? <Panel><form aria-label={t('overview.composer')} onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label className="sr-only" htmlFor={`${id}-text`}>{t('overview.message')}</label>
        <Textarea ref={composer} id={`${id}-text`} placeholder={t('overview.placeholder')} value={text} disabled={busy} aria-invalid={tooLong || undefined} aria-describedby={tooLong ? `${id}-limit` : `${id}-shortcut`} className="min-h-[120px] resize-y rounded-lg border border-border bg-background px-3 py-3 text-base shadow-none"
          onChange={event => { setText(event.target.value); attempt.current = null; }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={event => { if (event.ctrlKey && event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) { event.preventDefault(); void submit(); } }} />
        {tooLong && <p id={`${id}-limit`} className="mt-2 text-sm text-destructive" role="alert">{t('chatUi.tooLong')}</p>}
        <Separator className="my-4" />
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3"><label htmlFor={`${id}-project`} className="text-sm whitespace-nowrap text-muted-foreground">{t('overview.project')}</label><Select id={`${id}-project`} value={projectId} disabled={busy} onValueChange={next => { setChosen(next); attempt.current = null; }} options={state.projects.map(project => ({ value: project.id, label: project.name }))} className="w-48" /></div>
          <ToggleGroup type="single" value={intent} disabled={busy} onValueChange={value => { if (value === 'discuss' || value === 'delegate') { setIntent(value); attempt.current = null; } }} aria-label={t('chatUi.intent')} spacing={0} className="rounded-md border border-border">
            <ToggleGroupItem value="discuss" className="h-8 min-h-8 rounded-md border-0 px-3 text-sm font-normal data-[state=on]:bg-secondary">{t('overview.ask')}</ToggleGroupItem>
            <ToggleGroupItem value="delegate" className="h-8 min-h-8 rounded-md border-0 px-3 text-sm font-normal data-[state=on]:bg-secondary">{t('overview.delegate')}</ToggleGroupItem>
          </ToggleGroup>
          <div className="ml-auto flex items-center gap-3"><span className="whitespace-nowrap text-xs text-muted-foreground" id={`${id}-shortcut`}><Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> {t('overview.toSend')}</span>
          <Button type="submit" variant="default" className="h-9 border-0 px-4" disabled={disabled}>{t('chatUi.send')}</Button></div>
        </div>
        {error && <ErrorNotice error={error} />}{problem && <p role="alert">{t(problem)}</p>}
        {(error || problem) && <Button type="button" variant="outline" disabled={busy} onClick={() => { void submit(true); }}>{t('errors.retry')}</Button>}
      </form></Panel> : <Panel aria-label={t('overview.composer')}><MascotEmpty seat="Lead"><p className="m-0 text-sm text-muted-foreground">{t('projects.empty')}</p><div className="mt-4 flex flex-wrap justify-center gap-2"><Button onClick={() => onCreate('game')}>{t('shellUi.newGame')}</Button><Button variant="outline" onClick={() => onCreate('project')}>{t('shellUi.newProject')}</Button></div></MascotEmpty></Panel>}
      {state.loading.globalInbox ? <LoadingState inline /> : state.errors.globalInbox ? <div><ErrorNotice error={state.errors.globalInbox} /><Button onClick={() => { void store.loadGlobalInbox(); }}>{t('errors.retry')}</Button></div> : items.length ? <Section title={t('overview.needsYou')}>
        <Stagger className="m-0 list-none p-0">{items.map((item, index) => {
          const name = item.projectName ?? state.projects.find(project => project.id === item.projectId)?.name ?? t('overview.project');
          return <StaggerItem key={item.key} index={index}><div className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1"><p className="text-sm font-medium [overflow-wrap:anywhere]">{item.title}</p><span className="flex items-center gap-2 text-xs text-muted-foreground"><ProjectTile id={item.projectId} name={name} className="size-5 rounded-md" />{name}</span></div>
            <Button type="button" variant="outline" size="sm" onClick={() => onAttention(item)}>{t('gameSummary.action')}</Button>
          </div></StaggerItem>;
        })}</Stagger>
        <Button type="button" variant="link" className="h-auto px-0" onClick={() => onAttention()}>{t('overview.viewAll')}<ChevronRight className="size-4" /></Button>
      </Section> : <p className="text-sm text-muted-foreground">{t('overview.caughtUp')}</p>}
      <ProjectGrid store={store} onProject={onOpenProject}><PortalCard store={store} onChat={onOpenProject} onGames={onPortal} /></ProjectGrid>
      <ActivityFeed store={store} onTask={(projectId, taskId) => { if (onTask) onTask(projectId, taskId); else onProject(projectId); }} />
    </div>
  </Page>;
}
