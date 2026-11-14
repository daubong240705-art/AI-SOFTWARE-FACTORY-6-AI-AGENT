import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, BookOpen, FileText, HelpCircle, Mail, UserRound } from 'lucide-react';
import { meaningfulOfficeItems, type Interaction, type InteractionKind, type OfficeSeat, type Party } from '@/api/officeModels';
import { AgentCard, AgentOverview, mascotFor, type OfficeNeed, type OpenOfficeTask } from './AgentCard';
import { OfficePulse, OfficeRoomTrim, CoffeeCorner } from './OfficePulse';
import { GamePipeline, orderGameSeats } from './GamePipeline';
import { FeedMessage } from './FeedMessage';
import { TaskDetail } from '../TaskDetail';
import { DecisionDialog } from '../DecisionDialog';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Page } from '@/components/Page';
import { Mascot } from '@/components/mascot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { Store } from '@/state/store';
import { activityTime } from '../teams/activity/presentation';
import { StatusPill } from '../teams/activity/StatusPill';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type NodeKey = string;
type Flight = { id: string; kind: InteractionKind; x0: number; y0: number; x1: number; y1: number; delay: number };

const RECENT_MS = 20_000;
const BUBBLE_MS = 120_000;
const nodeKey = (party: Party): NodeKey => party.kind === 'seat' ? `seat:${party.seatId}` : party.kind;
const kindTone: Record<InteractionKind, string> = {
  assign: 'bg-run/10 text-run', request: 'bg-run/10 text-run', handoff: 'bg-run/10 text-run',
  question: 'bg-need/10 text-need', review: 'bg-need/10 text-need', 'start-gate': 'bg-need/10 text-need', rework: 'bg-need/10 text-need',
  answer: 'bg-ok/10 text-ok', finished: 'bg-ok/10 text-ok', failed: 'bg-info/10 text-info',
  output: 'bg-secondary text-foreground', progress: 'bg-secondary text-muted-foreground', message: 'bg-secondary text-muted-foreground',
  unknown: 'bg-secondary text-muted-foreground',
};
function FlightIcon({ kind }: { kind: InteractionKind }) {
  if (kind === 'output') return <FileText className="size-4" />;
  if (kind === 'question' || kind === 'review' || kind === 'start-gate') return <HelpCircle className="size-4" />;
  return <Mail className="size-4" />;
}

/** Event-driven refresh while the tab is open, plus a short poll for progress lines, paused while the page is hidden. */
function useOffice(store: Store, projectId: string) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let poll: ReturnType<typeof setInterval> | undefined;
    let unwatch: (() => void) | undefined;
    const stop = () => { clearInterval(poll); unwatch?.(); unwatch = undefined; };
    const sync = () => {
      stop();
      if (document.hidden) return;
      unwatch = store.watchM3('office', store.loadOffice);
      poll = setInterval(() => { void store.loadOffice(); setNow(Date.now()); }, 5000);
    };
    sync(); document.addEventListener('visibilitychange', sync);
    return () => { stop(); document.removeEventListener('visibilitychange', sync); };
  }, [store, projectId]);
  return now;
}

export function ProjectOffice({ store, projectId, onOpenTab }: { store: Store; projectId: string; onOpenTab: (tab: 'knowledge' | 'workflow') => void }) {
  const t = useT(); const id = useId();
  const now = useOffice(store, projectId);
  const { office, error } = store.useStoreSelector(state => ({ office: state.office, error: state.errors.office }));
  const { m5, teams, tasks } = store.useStoreSelector(state => ({ m5: state.m5, teams: state.m3.teams, tasks: state.tasks }));
  useEffect(() => store.watchM5('workflows', store.loadWorkflows), [store, projectId]);
  const workflow = m5.workflows.filter(item => item.key === 'game-build').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const detail = workflow ? m5.workflowDetails[workflow.id] : undefined;
  useEffect(() => {
    if (workflow) return store.watchM3('teams', store.loadTeams);
  }, [store, projectId, workflow?.id]);
  const seats = useMemo(() => orderGameSeats(office?.seats ?? [], detail, teams, tasks), [office?.seats, detail, teams, tasks]);
  const [hideProgress, setHideProgress] = useState(false);
  const [lively, setLively] = useState(true);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskTab, setSelectedTaskTab] = useState<'request' | 'progress' | 'actions'>('progress');
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null);
  const selectedSeat = office?.seats.find(seat => seat.id === selectedSeatId) ?? null;
  const party = (value: Party) => value.kind === 'seat' ? value.name : t(value.kind === 'operator' ? 'officeUi.you' : 'officeUi.knowledge');
  const items = useMemo(() => meaningfulOfficeItems(office?.items ?? []), [office?.items]);
  const openTask: OpenOfficeTask = (taskId, tab = 'progress') => {
    setSelectedTaskId(taskId); setSelectedTaskTab(tab); setSelectedSeatId(null);
  };
  const review = (need: OfficeNeed) => {
    setSelectedSeatId(null);
    if (need.kind === 'start-gate') openTask(need.taskId, 'actions');
    else setSelectedApprovalId(need.approvalId);
  };
  const closeDecision = () => { setSelectedApprovalId(null); void store.loadOffice(); };

  return <Page className={cn("flex min-h-full min-w-0 flex-col gap-5", !lively && "office-quiet")}>
    <header className="space-y-1"><h2 className="font-display text-2xl font-semibold">{t('officeUi.title')}</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">{t('officeUi.description')}</p></header>
    {workflow && <GamePipeline detail={detail} onOpenWorkflow={() => onOpenTab('workflow')} />}
    {error && <div className="space-y-3"><ErrorNotice error={error} /><Button variant="outline" size="sm" onClick={() => { void store.loadOffice(); }}>{t('errors.retry')}</Button></div>}
    {!office && !error && <div role="status" aria-label={t('viewStates.loading')} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
      <Skeleton className="h-96 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>}
    {office && <OfficePulse store={store} office={office} now={now} lively={lively} onLivelyChange={setLively} />}
    {office && <div className="grid min-w-0 flex-1 items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
      <OfficeFloor store={store} lively={lively} seats={seats} items={items} now={now} party={party} onSelectSeat={seat => setSelectedSeatId(seat.id)} onOpenTask={openTask} onReview={review} onOpenKnowledge={() => onOpenTab('knowledge')} />
      <section aria-labelledby={`${id}-feed`} className="min-w-0 rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 id={`${id}-feed`} className="font-display text-base font-semibold">{t('officeUi.feed')}</h3>
          <div className="flex items-center gap-2"><Checkbox id={`${id}-progress`} checked={hideProgress} onCheckedChange={value => setHideProgress(value === true)} />
            <Label htmlFor={`${id}-progress`} className="text-xs text-muted-foreground">{t('officeUi.hideProgress')}</Label></div>
        </div>
        <Feed items={items.filter(item => !hideProgress || item.kind !== 'progress')} now={now} party={party} onOpenTask={taskId => { setSelectedTaskId(taskId); setSelectedTaskTab('progress'); }} />
      </section>
    </div>}
    <Sheet open={!!selectedSeat} onOpenChange={open => { if (!open) setSelectedSeatId(null); }}>
      <SheetContent side="right" className="w-full min-w-0 overflow-y-auto sm:max-w-lg">
        {selectedSeat && <>
          <SheetHeader className="border-b border-border px-5 py-5 pr-12 text-left">
            <div className="flex flex-wrap items-center gap-3"><Mascot seat={selectedSeat.isLead ? 'Lead' : selectedSeat.name} state={mascotFor[selectedSeat.status]} size={48} /><div className="min-w-0"><SheetTitle className="truncate">{selectedSeat.name}</SheetTitle><SheetDescription className="truncate">{selectedSeat.role}</SheetDescription></div><StatusPill status={selectedSeat.status} /></div>
          </SheetHeader>
          <div className="space-y-5 p-5">
            <AgentOverview store={store} seat={selectedSeat} now={now} onOpenTask={openTask} onReview={review} />
            <section className="min-w-0 overflow-hidden rounded-xl border border-border"><h3 className="border-b border-border p-4 text-sm font-semibold">{t('officeUi.feed')}</h3>
              <Feed items={items.filter(item => (item.from.kind === 'seat' && item.from.seatId === selectedSeat.id) || (item.to?.kind === 'seat' && item.to.seatId === selectedSeat.id))} now={now} party={party} onOpenTask={taskId => { setSelectedSeatId(null); setSelectedTaskId(taskId); setSelectedTaskTab('progress'); }} />
            </section>
          </div>
        </>}
      </SheetContent>
    </Sheet>
    {selectedApprovalId && <DecisionDialog store={store} approvalId={selectedApprovalId} onClose={closeDecision} />}
    {selectedTaskId && <TaskDetail key={selectedTaskId} store={store} taskId={selectedTaskId} initialTab={selectedTaskTab} onClose={() => setSelectedTaskId(null)} />}
    </Page>;
}

function OfficeFloor({ store, lively, seats, items, now, party, onSelectSeat, onOpenTask, onReview, onOpenKnowledge }: {
  store: Store; lively: boolean; seats: OfficeSeat[]; items: Interaction[]; now: number; party: (value: Party) => string;
  onSelectSeat: (seat: OfficeSeat) => void; onOpenTask: OpenOfficeTask; onReview: (need: OfficeNeed) => void;
  onOpenKnowledge: () => void;
}) {
  const t = useT(); const reduced = useReducedMotion();
  const floor = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<NodeKey, HTMLElement>());
  const seen = useRef<Set<string> | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const register = (key: NodeKey) => (element: HTMLElement | null) => { if (element) nodes.current.set(key, element); else nodes.current.delete(key); };
  const lead = seats.find(seat => seat.isLead) ?? null;
  const others = seats.filter(seat => seat !== lead);
  // The newest item a node sent recently becomes its speech bubble; nodes that just sent or received glow.
  const { bubbles, active } = useMemo(() => {
    const bubbles = new Map<NodeKey, Interaction>(); const active = new Set<NodeKey>();
    for (const item of items) {
      const age = now - Date.parse(item.at);
      const from = nodeKey(item.from);
      if (age <= BUBBLE_MS && !bubbles.has(from) && item.text) bubbles.set(from, item);
      if (age <= RECENT_MS) { active.add(from); if (item.to) active.add(nodeKey(item.to)); }
    }
    return { bubbles, active };
  }, [items, now]);

  // Exchanges that arrive while the tab is open fly from sender to receiver. The first load only sets the baseline.
  useLayoutEffect(() => {
    if (seen.current === null) { seen.current = new Set(items.map(item => item.id)); return; }
    const fresh = items.filter(item => !seen.current!.has(item.id));
    for (const item of fresh) seen.current.add(item.id);
    const box = floor.current?.getBoundingClientRect();
    if (reduced || !lively || !box) return;
    const center = (key: NodeKey) => {
      const rect = nodes.current.get(key)?.getBoundingClientRect();
      return rect ? { x: rect.left - box.left + rect.width / 2 - 14, y: rect.top - box.top + rect.height / 2 - 14 } : null;
    };
    const next = fresh.filter(item => item.to).slice(0, 6).reverse().flatMap((item, index): Flight[] => {
      const a = center(nodeKey(item.from)); const b = center(nodeKey(item.to!));
      return a && b ? [{ id: item.id, kind: item.kind, x0: a.x, y0: a.y, x1: b.x, y1: b.y, delay: index * 0.4 }] : [];
    });
    if (next.length) setFlights(previous => [...previous, ...next].slice(-12));
  }, [items, reduced, lively]);

  const bubble = (key: NodeKey) => {
    const item = bubbles.get(key);
    return item ? <div className="pointer-events-none mt-2 max-w-full rounded-xl rounded-tl-sm border border-border bg-background px-2.5 py-1.5 text-xs text-foreground shadow-xs">
      <p className="line-clamp-2 [overflow-wrap:anywhere]"><span className="font-medium">{t(`officeUi.kinds.${item.kind}`)}</span>{item.code && <span className="font-mono text-muted-foreground"> {item.code}</span>}: {item.text}</p>
    </div> : null;
  };
  const glow = (key: NodeKey) => active.has(key) && 'ring-2 ring-run/40 motion-safe:transition-shadow';

  return <section aria-label={t('officeUi.floor')} className="flex min-w-0 flex-col">
    <div ref={floor} className="office-floor relative flex min-h-[max(32rem,calc(100dvh-26rem))] flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-muted/30 p-4 sm:p-6">
      <OfficeRoomTrim now={now} />
      {!seats.length ? <p className="py-16 text-center text-sm text-muted-foreground">{t('officeUi.noSeats')}</p> : <>
        <div className="office-lead-row grid items-start gap-3">
          <div ref={register('operator')} className={cn('justify-self-start rounded-2xl border border-border bg-card p-3 text-center', glow('operator'))}>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-secondary"><UserRound className="size-6" aria-hidden="true" /></span>
            <p className="mt-2 text-sm font-semibold">{t('officeUi.you')}</p>
          </div>
          {lead ? <AgentCard store={store} seat={lead} featured innerRef={register(`seat:${lead.id}`)} className={cn('office-lead-card w-full max-w-80', glow(`seat:${lead.id}`))} bubble={bubble(`seat:${lead.id}`)} now={now} onSelectSeat={onSelectSeat} onOpenTask={onOpenTask} onReview={onReview} /> : <span />}
          <button type="button" ref={register('knowledge')} onClick={onOpenKnowledge} aria-label={t('officeUi.openKnowledge')} className={cn('justify-self-end rounded-2xl border border-border bg-card p-3 text-center hover:border-info/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', glow('knowledge'))}>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-secondary"><BookOpen className="size-6" aria-hidden="true" /></span>
            <span className="mt-2 block text-sm font-semibold">{t('officeUi.knowledge')}</span>
          </button>
        </div>
        <ul className="office-seat-grid m-0 mt-6 grid list-none items-stretch gap-4 p-0">
          {others.map(seat => <li key={seat.id} className="min-w-0"><AgentCard store={store} seat={seat} innerRef={register(`seat:${seat.id}`)} className={cn(glow(`seat:${seat.id}`))} bubble={bubble(`seat:${seat.id}`)} now={now} onSelectSeat={onSelectSeat} onOpenTask={onOpenTask} onReview={onReview} /></li>)}
        </ul>
      </>}
      <div className="mt-auto pt-5"><CoffeeCorner /></div>
      {lively && flights.map(flight => <motion.span key={flight.id} aria-hidden="true"
        className={cn('pointer-events-none absolute top-0 left-0 z-10 flex size-7 items-center justify-center rounded-full border border-border shadow-md', kindTone[flight.kind], 'bg-card')}
        initial={{ x: flight.x0, y: flight.y0, scale: 0.6, opacity: 0 }}
        animate={{ x: [flight.x0, (flight.x0 + flight.x1) / 2, flight.x1], y: [flight.y0, Math.min(flight.y0, flight.y1) - 40, flight.y1], scale: [0.6, 1.15, 0.8], opacity: [0, 1, 0] }}
        transition={{ duration: 1.6, delay: flight.delay, ease: 'easeInOut' }}
        onAnimationComplete={() => setFlights(previous => previous.filter(item => item.id !== flight.id))}>
        <FlightIcon kind={flight.kind} />
      </motion.span>)}
    </div>
    <p className="sr-only" aria-live="polite">{items[0] ? `${party(items[0].from)} ${t(`officeUi.kinds.${items[0].kind}`)} ${items[0].code ?? ''}` : ''}</p>
  </section>;
}

function Feed({ items, now, party, onOpenTask }: { items: Interaction[]; now: number; party: (value: Party) => string; onOpenTask: (taskId: string) => void }) {
  const t = useT();
  if (!items.length) return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('officeUi.empty')}</p>;
  const avatar = (value: Party) => value.kind === 'seat' ? <Mascot seat={value.name} size={22} animated={false} />
    : <span className="flex size-[22px] items-center justify-center rounded-full bg-secondary">{value.kind === 'operator' ? <UserRound className="size-3.5" aria-hidden="true" /> : <BookOpen className="size-3.5" aria-hidden="true" />}</span>;
  return <ol aria-label={t('officeUi.feed')} className="m-0 max-h-[70vh] list-none divide-y divide-border overflow-y-auto overscroll-contain p-0 [scrollbar-gutter:stable]">
    {items.map(item => <li key={item.id} className="min-w-0 space-y-2 px-4 py-4 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {avatar(item.from)}<span className="font-medium">{party(item.from)}</span>
        {item.to && <><ArrowRight className="size-3 text-muted-foreground" aria-label={t('officeUi.to')} />{avatar(item.to)}<span className="font-medium">{party(item.to)}</span></>}
        <Badge variant="secondary" className={cn('ml-auto border-0 font-normal', kindTone[item.kind])}>{t(`officeUi.kinds.${item.kind}`)}</Badge>
      </div>
      {item.code && (item.taskId
        ? <Button type="button" variant="outline" size="sm" className="h-auto max-w-full px-2 py-1 font-mono text-xs text-info" onClick={() => onOpenTask(item.taskId!)}>{item.code}</Button>
        : <span className="font-mono text-xs text-muted-foreground">{item.code}</span>)}
      <FeedMessage text={item.text} />
      <p className="text-[11px] text-muted-foreground"><time dateTime={item.at}>{activityTime(item.at, now)}</time></p>
    </li>)}
  </ol>;
}
