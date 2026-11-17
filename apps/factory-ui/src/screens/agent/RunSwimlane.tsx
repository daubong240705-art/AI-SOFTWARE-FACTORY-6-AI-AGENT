import { useId, useLayoutEffect, useRef, useState } from 'react';
import { isLiveAttempt, type Task } from '@factory/contracts';
import type { OfficeSeat } from '@/api/officeModels';
import { Mascot } from '@/components/mascot';
import { StatusDot, ViewState } from '@/components/app';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { i18n, useT } from '@/i18n';
import { toneOf, type StatusTone } from '@/lib/status';
import { durationSince, newestFirst, tokensFor, mascotFor, type ProjectAttempt } from './presentation';

const ranges = [3600_000, 6 * 3600_000, 24 * 3600_000, 7 * 24 * 3600_000] as const;
const laneHeight = 44;
const colours: Record<StatusTone, string> = { run: 'bg-run', ok: 'bg-ok', need: 'bg-need', error: 'bg-need', idle: 'bg-muted-foreground/40' };
type Lane = Pick<OfficeSeat, 'id' | 'name' | 'isLead' | 'status'>;
type Bar = { attempt: ProjectAttempt; lane: number; left: number; width: number; after: string[] };
type Props = {
  attempts: ProjectAttempt[]; seats: OfficeSeat[]; tasks: Task[]; now: number; range: number;
  onRangeChange: (range: number) => void; loading: boolean; onOpenTask: (id: string) => void;
};

export function RunSwimlane({ attempts, seats, tasks, now, range, onRangeChange, loading, onOpenTask }: Props) {
  const t = useT(); const marker = useId(); const from = now - range;
  const chart = useRef<HTMLDivElement>(null); const [chartWidth, setChartWidth] = useState(0);
  const visible = attempts.filter(item => item.startedAt && Date.parse(item.startedAt) <= now
    && (!item.endedAt || Date.parse(item.endedAt) >= from));
  const hasRuns = visible.length > 0;
  useLayoutEffect(() => {
    const element = chart.current; if (!element) return;
    const measure = () => setChartWidth(element.getBoundingClientRect().width);
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [hasRuns]);
  const queued = attempts.filter(item => !item.startedAt).length;
  // Preserve Now's order; historical or unassigned seats still get a lane.
  const lanes: Lane[] = seats.filter(seat => visible.some(item => item.seatId === seat.id));
  for (const attempt of visible) {
    const id = attempt.seatId ?? 'unassigned';
    if (!lanes.some(seat => seat.id === id)) lanes.push({ id, name: attempt.seatName ?? t('agentUi.unassigned'), isLead: false, status: 'idle' });
  }
  const taskMap = new Map(tasks.map(task => [task.id, task]));
  const bars: Bar[] = visible.map(attempt => {
    const start = Math.max(from, Date.parse(attempt.startedAt!));
    const end = Math.min(now, attempt.endedAt ? Date.parse(attempt.endedAt) : now);
    const left = Math.max(0, Math.min(1, (start - from) / range));
    // A short run occupies at least 1/120 of the range, clipped at the right edge.
    const width = Math.min(1 - left, Math.max(end - start, range / 120) / range);
    return { attempt, lane: lanes.findIndex(seat => seat.id === (attempt.seatId ?? 'unassigned')), left, width,
      after: taskMap.get(attempt.taskId)?.dependsOn.flatMap(id => {
        const code = taskMap.get(id)?.code ?? attempts.find(item => item.taskId === id)?.taskCode;
        return code ? [code] : [];
      }) ?? [] };
  });
  const latest = new Map<string, Bar>(); const earliest = new Map<string, Bar>();
  for (const bar of bars) {
    const previous = latest.get(bar.attempt.taskId); const first = earliest.get(bar.attempt.taskId);
    if (!previous || newestFirst(bar.attempt, previous.attempt) < 0) latest.set(bar.attempt.taskId, bar);
    if (!first || newestFirst(bar.attempt, first.attempt) > 0) earliest.set(bar.attempt.taskId, bar);
  }
  const arrows = [...earliest.values()].flatMap(target => (taskMap.get(target.attempt.taskId)?.dependsOn ?? []).flatMap(id => {
    const source = latest.get(id); return source ? [{ source, target }] : [];
  }));
  const ticks = Array.from({ length: 5 }, (_, i) => from + (range * i) / 4);
  const formatTick = (value: number) => new Intl.DateTimeFormat(i18n.locale, range === ranges[3]
    ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
  return <div className="space-y-4">
    <ToggleGroup type="single" value={String(range)} onValueChange={value => {
      const next = ranges.find(item => String(item) === value); if (next) onRangeChange(next);
    }} aria-label={t('agentUi.range')}>
      {ranges.map(value => <ToggleGroupItem key={value} value={String(value)} type="button">{t(`agentUi.ranges.${value}`)}</ToggleGroupItem>)}
    </ToggleGroup>
    {!hasRuns ? <ViewState empty={!loading} emptyText={t('agentUi.emptyRange')} /> : <div className="min-w-0 overflow-x-auto">
      <div className="min-w-[44rem] pr-2">
        <div className="grid grid-cols-[12rem_minmax(0,1fr)]"><span />
          <div className="relative h-12 border-b border-border">{ticks.map((tick, i) => <span key={i}
            className={`absolute bottom-2 text-xs text-muted-foreground ${i === 0 ? '' : i === 4 ? '-translate-x-full' : '-translate-x-1/2'}`}
            style={{ left: `${i * 25}%` }}>{formatTick(tick)}</span>)}
            <span className="absolute top-0 right-0 text-xs text-run">{t('agentUi.nowLine')}</span>
          </div>
        </div>
        <div className="grid grid-cols-[12rem_minmax(0,1fr)]">
          <div>{lanes.map(seat => <div key={seat.id} style={{ height: laneHeight }} className="flex min-w-0 items-center gap-2 border-b border-border/60 pr-3">
            <Mascot seat={seat.isLead ? 'Lead' : seat.name} state={mascotFor[seat.status]} size={24} animated={false}
              fallback={<span className="inline-flex size-6 shrink-0 items-center justify-center text-xs">{seat.name.slice(0, 2)}</span>} />
            <span className="truncate text-sm" title={seat.name}>{seat.name}</span>
          </div>)}</div>
          <div ref={chart} className="relative min-w-0">
            {lanes.map((seat, lane) => <div key={seat.id} style={{ height: laneHeight }} className="relative border-b border-border/60">
              {bars.filter(bar => bar.lane === lane).map(bar => {
                const attempt = bar.attempt; const live = !attempt.endedAt && isLiveAttempt(attempt.state);
                const tone = live ? 'run' : toneOf('attempt', attempt.state);
                const tokens = tokensFor(attempt);
                const title = [attempt.taskTitle, t(`workUi.states.${attempt.state}`), durationSince(attempt.startedAt, attempt.endedAt, now), tokens,
                  ...bar.after.map(code => t('agentUi.after').replace('{code}', code))].filter(Boolean).join(' · ');
                return <button key={attempt.id} type="button" title={title} aria-label={`${attempt.taskCode} · ${title}`}
                  onClick={() => onOpenTask(attempt.taskId)} style={{ left: `${bar.left * 100}%`, width: `${bar.width * 100}%` }}
                  className={`absolute top-2 h-7 overflow-hidden rounded text-left text-xs text-background focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-ring ${colours[tone]} ${live ? 'motion-safe:animate-pulse' : ''}`}>
                  {bar.width * chartWidth >= 56 && <span className="block truncate px-1">{attempt.taskCode}</span>}
                </button>;
              })}
            </div>)}
            <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full text-muted-foreground/60" preserveAspectRatio="none"
              viewBox={`0 0 ${Math.max(1, chartWidth)} ${lanes.length * laneHeight}`} aria-hidden="true">
              <defs><marker id={marker} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0,0 L6,3 L0,6" fill="none" stroke="currentColor" />
              </marker></defs>
              {arrows.map(({ source, target }) => {
                const x0 = (source.left + source.width) * chartWidth; const x1 = target.left * chartWidth;
                const y0 = source.lane * laneHeight + laneHeight / 2; const y1 = target.lane * laneHeight + laneHeight / 2;
                const bend = Math.max(12, Math.abs(x1 - x0) / 2);
                return <path key={`${source.attempt.id}:${target.attempt.id}`} d={`M${x0},${y0} C${x0 + bend},${y0} ${x1 - bend},${y1} ${x1},${y1}`}
                  fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" markerEnd={`url(#${marker})`} />;
              })}
            </svg>
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 border-r border-dashed border-run" />
          </div>
        </div>
      </div>
    </div>}
    {queued > 0 && <p className="text-sm text-muted-foreground">{t('agentUi.queuedRuns').replace('{count}', String(queued))}</p>}
    <div className="flex flex-wrap gap-4">{(['running', 'done', 'failed', 'other'] as const).map((key, i) =>
      <StatusDot key={key} tone={(['run', 'ok', 'error', 'idle'] as const)[i]!} label={t(`agentUi.legend.${key}`)} />)}</div>
  </div>;
}
