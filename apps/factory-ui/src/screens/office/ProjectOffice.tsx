import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, BookOpen, FileText, HelpCircle, Mail, UserRound } from 'lucide-react';
import { meaningfulOfficeItems, type Interaction, type InteractionKind, type OfficeSeat, type Party } from '@/api/officeModels';
import { MarkdownContent } from '@/components/MarkdownContent';
import { TaskDetail } from '../TaskDetail';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Page } from '@/components/Page';
import { Mascot, type MascotState } from '@/components/mascot';
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
const mascotFor: Record<OfficeSeat['status'], MascotState> = {
  working: 'working', waiting: 'attention', problem: 'error', done: 'success', queued: 'thinking', idle: 'idle',
};
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

export function ProjectOffice({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT(); const id = useId();
  const now = useOffice(store, projectId);
  const { office, error } = store.useStoreSelector(state => ({ office: state.office, error: state.errors.office }));
  const [hideProgress, setHideProgress] = useState(false);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedSeat = office?.seats.find(seat => seat.id === selectedSeatId) ?? null;
  const party = (value: Party) => value.kind === 'seat' ? value.name : t(value.kind === 'operator' ? 'officeUi.you' : 'officeUi.knowledge');
  const items = useMemo(() => meaningfulOfficeItems(office?.items ?? []), [office?.items]);
  return <Page className="min-w-0 space-y-5">
    <header className="space-y-1"><h2 className="font-display text-2xl font-semibold">{t('officeUi.title')}</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">{t('officeUi.description')}</p></header>
    {error && <div className="space-y-3"><ErrorNotice error={error} /><Button variant="outline" size="sm" onClick={() => { void store.loadOffice(); }}>{t('errors.retry')}</Button></div>}
    {!office && !error && <div role="status" aria-label={t('viewStates.loading')} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
      <Skeleton className="h-96 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>}
    {office && <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
      <OfficeFloor seats={office.seats} items={items} now={now} party={party} onSelectSeat={seat => setSelectedSeatId(seat.id)} />
      <section aria-labelledby={`${id}-feed`} className="min-w-0 rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 id={`${id}-feed`} className="font-display text-base font-semibold">{t('officeUi.feed')}</h3>
          <div className="flex items-center gap-2"><Checkbox id={`${id}-progress`} checked={hideProgress} onCheckedChange={value => setHideProgress(value === true)} />
            <Label htmlFor={`${id}-progress`} className="text-xs text-muted-foreground">{t('officeUi.hideProgress')}</Label></div>
        </div>
        <Feed items={items.filter(item => !hideProgress || item.kind !== 'progress')} now={now} party={party} onOpenTask={setSelectedTaskId} />
      </section>
    </div>}
    <Sheet open={!!selectedSeat} onOpenChange={open => { if (!open) setSelectedSeatId(null); }}>
      <SheetContent side="right" className="w-full min-w-0 overflow-y-auto sm:max-w-lg">
        {selectedSeat && <>
          <SheetHeader className="border-b border-border px-5 py-5 pr-12 text-left">
            <div className="flex flex-wrap items-center gap-3"><Mascot seat={selectedSeat.isLead ? 'Lead' : selectedSeat.name} state={mascotFor[selectedSeat.status]} size={48} /><div className="min-w-0"><SheetTitle className="truncate">{selectedSeat.name}</SheetTitle><SheetDescription className="truncate">{selectedSeat.role}</SheetDescription></div><StatusPill status={selectedSeat.status} /></div>
          </SheetHeader>
          <div className="space-y-5 p-5">
            {selectedSeat.runs.length ? selectedSeat.runs.map(run => <section key={run.attemptId} className="space-y-3 rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-semibold">{t('officeUi.currentWork')}</h3>
              <p className="[overflow-wrap:anywhere] text-sm"><span className="mr-2 font-mono text-xs text-muted-foreground">{run.code}</span>{run.title}</p>
              {run.progress && <div className="space-y-2"><MarkdownContent content={run.progress.message} />
                {run.progress.percent !== null && <div role="progressbar" aria-label={run.code} aria-valuenow={run.progress.percent} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-run" style={{ width: `${run.progress.percent}%` }} /></div>}
                <p className="text-xs text-muted-foreground">{activityTime(run.progress.at, now)}</p>
              </div>}
              <Button type="button" variant="outline" size="sm" onClick={() => { setSelectedSeatId(null); setSelectedTaskId(run.taskId); }}>{t('officeUi.openTask').replace('{code}', run.code)}</Button>
            </section>) : <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">{selectedSeat.chat ? t('officeUi.replying') : selectedSeat.needsYou.length ? t('officeUi.waitingYou') : selectedSeat.queued ? t('officeUi.queued').replace('{count}', String(selectedSeat.queued)) : t('officeUi.noWork')}</p>}
            {selectedSeat.needsYou.length > 0 && <section className="space-y-2"><h3 className="text-sm font-semibold">{t('officeUi.waitingYou')}</h3><ul className="space-y-2 text-sm">{selectedSeat.needsYou.map(need => <li key={need.approvalId}><Button variant="outline" onClick={() => { setSelectedSeatId(null); setSelectedTaskId(need.taskId); }}>{t('officeUi.openTask').replace('{code}', need.code)}</Button></li>)}</ul></section>}
            <section className="min-w-0 overflow-hidden rounded-xl border border-border"><h3 className="border-b border-border p-4 text-sm font-semibold">{t('officeUi.feed')}</h3>
              <Feed items={items.filter(item => (item.from.kind === 'seat' && item.from.seatId === selectedSeat.id) || (item.to?.kind === 'seat' && item.to.seatId === selectedSeat.id))} now={now} party={party} onOpenTask={taskId => { setSelectedSeatId(null); setSelectedTaskId(taskId); }} />
            </section>
          </div>
        </>}
      </SheetContent>
    </Sheet>
    {selectedTaskId && <TaskDetail key={selectedTaskId} store={store} taskId={selectedTaskId} initialTab="progress" onClose={() => setSelectedTaskId(null)} />}
    </Page>;
}

function OfficeFloor({ seats, items, now, party, onSelectSeat }: {
  seats: OfficeSeat[]; items: Interaction[]; now: number; party: (value: Party) => string;
  onSelectSeat: (seat: OfficeSeat) => void;
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
    if (reduced || !box) return;
    const center = (key: NodeKey) => {
      const rect = nodes.current.get(key)?.getBoundingClientRect();
      return rect ? { x: rect.left - box.left + rect.width / 2 - 14, y: rect.top - box.top + rect.height / 2 - 14 } : null;
    };
    const next = fresh.filter(item => item.to).slice(0, 6).reverse().flatMap((item, index): Flight[] => {
      const a = center(nodeKey(item.from)); const b = center(nodeKey(item.to!));
      return a && b ? [{ id: item.id, kind: item.kind, x0: a.x, y0: a.y, x1: b.x, y1: b.y, delay: index * 0.4 }] : [];
    });
    if (next.length) setFlights(previous => [...previous, ...next].slice(-12));
  }, [items, reduced]);

  const bubble = (key: NodeKey) => {
    const item = bubbles.get(key);
    return item ? <div className="pointer-events-none mt-2 max-w-full rounded-xl rounded-tl-sm border border-border bg-background px-2.5 py-1.5 text-xs text-foreground shadow-xs">
      <p className="line-clamp-2 [overflow-wrap:anywhere]"><span className="font-medium">{t(`officeUi.kinds.${item.kind}`)}</span>{item.code && <span className="font-mono text-muted-foreground"> {item.code}</span>}: {item.text}</p>
    </div> : null;
  };
  const glow = (key: NodeKey) => active.has(key) && 'ring-2 ring-run/40 motion-safe:transition-shadow';

  return <section aria-label={t('officeUi.floor')} className="min-w-0">
    <div ref={floor} className="office-floor relative overflow-hidden rounded-2xl border border-border bg-muted/30 p-4 sm:p-6">
      {!seats.length ? <p className="py-16 text-center text-sm text-muted-foreground">{t('officeUi.noSeats')}</p> : <>
        <div className="office-lead-row grid items-start gap-3">
          <div ref={register('operator')} className={cn('justify-self-start rounded-2xl border border-border bg-card p-3 text-center', glow('operator'))}>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-secondary"><UserRound className="size-6" aria-hidden="true" /></span>
            <p className="mt-2 text-sm font-semibold">{t('officeUi.you')}</p>
          </div>
          {lead ? <SeatCard seat={lead} featured innerRef={register(`seat:${lead.id}`)} className={cn('office-lead-card w-full max-w-80', glow(`seat:${lead.id}`))} bubble={bubble(`seat:${lead.id}`)} now={now} onSelectSeat={onSelectSeat} /> : <span />}
          <div ref={register('knowledge')} className={cn('justify-self-end rounded-2xl border border-border bg-card p-3 text-center', glow('knowledge'))}>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-secondary"><BookOpen className="size-6" aria-hidden="true" /></span>
            <p className="mt-2 text-sm font-semibold">{t('officeUi.knowledge')}</p>
          </div>
        </div>
        <ul className="office-seat-grid m-0 mt-6 grid list-none items-stretch gap-4 p-0">
          {others.map(seat => <li key={seat.id} className="min-w-0"><SeatCard seat={seat} innerRef={register(`seat:${seat.id}`)} className={cn(glow(`seat:${seat.id}`))} bubble={bubble(`seat:${seat.id}`)} now={now} onSelectSeat={onSelectSeat} /></li>)}
        </ul>
      </>}
      {flights.map(flight => <motion.span key={flight.id} aria-hidden="true"
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

function SeatCard({ seat, featured = false, innerRef, className, bubble, now, onSelectSeat }: {
  seat: OfficeSeat; featured?: boolean; innerRef: (element: HTMLElement | null) => void; className?: string | undefined;
  bubble: React.ReactNode; now: number; onSelectSeat: (seat: OfficeSeat) => void;
}) {
  const t = useT(); const run = seat.runs[0];
  return <article ref={innerRef} aria-label={seat.name} tabIndex={0} role="button" onClick={() => onSelectSeat(seat)} onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectSeat(seat); } }} className={cn('flex h-full min-h-52 min-w-0 flex-col cursor-pointer [overflow-wrap:anywhere] rounded-2xl border border-border bg-card p-3 transition-colors hover:border-info/50 focus-visible:outline-2 focus-visible:outline-ring', featured && 'justify-self-center', className)}>
    <div className="flex min-w-0 items-start gap-3">
      <Mascot seat={seat.isLead ? 'Lead' : seat.name} state={mascotFor[seat.status]} size={featured ? 56 : 48} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold">{seat.name}</h4><StatusPill status={seat.status} /></div>
        <p className="truncate text-xs text-muted-foreground">{seat.role}</p>
      </div>
    </div>
    {run ? <div className="mt-3 block w-full min-w-0 overflow-hidden rounded-lg bg-secondary/60 px-2.5 py-2 text-left hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring">
      <p className="break-words text-xs"><span className="font-mono text-muted-foreground">{run.code}</span> {run.title}</p>
      {run.progress && <><div className="mt-2"><div className="line-clamp-3"><MarkdownContent content={run.progress.message} className="space-y-1 text-xs leading-5 text-muted-foreground" /></div><p className="mt-1 text-[11px] text-muted-foreground">{activityTime(run.progress.at, now)}</p></div>
        {run.progress.percent !== null && <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-run" style={{ width: `${run.progress.percent}%` }} /></span>}</>}
    </div>
      : seat.chat ? <p className="mt-3 text-xs text-run">{t('officeUi.replying')} · {activityTime(seat.chat.since, now)}</p>
      : <p className="mt-3 text-xs text-muted-foreground">{seat.needsYou.length ? t('officeUi.waitingYou') : seat.queued ? t('officeUi.queued').replace('{count}', String(seat.queued)) : t('officeUi.noWork')}</p>}
    {!run && bubble}
    <span className="mt-auto flex items-center justify-between gap-2 pt-4 text-xs text-info">{t('officeUi.viewAgent')}<ArrowRight className="size-3.5 shrink-0" aria-hidden="true" /></span>
  </article>;
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
      <MarkdownContent content={item.text} className="space-y-2 leading-6" />
      <p className="text-[11px] text-muted-foreground"><time dateTime={item.at}>{activityTime(item.at, now)}</time></p>
    </li>)}
  </ol>;
}
