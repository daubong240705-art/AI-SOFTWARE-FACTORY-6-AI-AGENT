import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isLiveAttempt } from '@factory/contracts';
import { Activity, Check, ChevronDown, Circle, FileDiff, HelpCircle, MessageSquare, Terminal, X, Zap } from 'lucide-react';
import type { Attempt, AttemptEvent } from '@/api/client';
import { KeyValueList } from '@/components/app/KeyValueList';
import { Section } from '@/components/app/Section';
import { TechDetails } from '@/components/app/TechDetails';
import { ViewState } from '@/components/app/ViewState';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { i18n, useT } from '@/i18n';
import { cleanText, describeEvent, type EventDescription } from '@/state/attemptView';
import { RunHeader } from './RunHeader';
export { RunHeader } from './RunHeader';

type Props = { attempts: Attempt[]; events: Record<string, AttemptEvent[] | undefined>; onLoadAttempt?: (attemptId: string) => void };
const knownStates = new Set(['runtime-configured', 'workspace-ready', 'evidence-failed', 'queued', 'leased', 'preparing', 'running', 'waiting-input', 'parked', 'stopping', 'stopped', 'submitting', 'succeeded', 'failed', 'lease-expired', 'unknown', 'reconciling', 'requeued']);

function AgentMessage({ text }: { text: string }) {
  const t = useT(); const [expanded, setExpanded] = useState(false); const [long, setLong] = useState(false);
  const content = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => setLong(element.scrollHeight > Number.parseFloat(getComputedStyle(element).lineHeight) * 8 + 1);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [text]);
  return <div className="rounded-lg bg-secondary/40 p-3 whitespace-pre-wrap break-words">
    <p ref={content} className={`text-sm leading-6 ${expanded ? '' : 'line-clamp-8'}`}>{text}</p>
    {long && <Button type="button" variant="ghost" size="sm" aria-expanded={expanded} className="mt-2" onClick={() => setExpanded(!expanded)}>{t(expanded ? 'agentUi.showLess' : 'agentUi.showMore')}</Button>}
  </div>;
}

function EventRow({ event }: { event: AttemptEvent }) {
  const t = useT(); const view = describeEvent(event);
  let icon = <Circle />; let content: ReactNode;
  const number = (value: number | null) => value === null ? t('agentUi.unknown') : new Intl.NumberFormat(i18n.locale).format(value);
  switch (view.kind) {
    case 'milestone': {
      const label = knownStates.has(view.state) ? t(`agentUi.milestones.${view.state}`) : view.state;
      const agent = view.agent ? [view.agent.cli, view.agent.model, view.agent.effort].filter(Boolean).join(' · ') : '';
      content = <div className="text-xs whitespace-pre-wrap text-muted-foreground"><p>{label}{agent && `: ${agent}`}{view.branch && ` ${view.branch}`}{view.agent?.permission && ` · ${t('agentUi.permission')}: ${view.agent.permission}`}</p>
        {view.summary && <p className="mt-1">{view.summary}</p>}{view.failureKind && <p>{view.failureKind}</p>}{view.message && <p>{view.message}</p>}{view.reason && <p>{view.reason}</p>}
      </div>; break;
    }
    case 'progress': icon = <Activity />; content = <div className="space-y-2"><p className="whitespace-pre-wrap">{view.text}</p>{view.percent !== undefined && <Progress value={view.percent} className="h-1" aria-label={t('agentUi.progress')} />}</div>; break;
    case 'message': icon = <MessageSquare />; content = <AgentMessage text={view.text} />; break;
    case 'criterion': icon = view.passed ? <Check className="text-ok" /> : <X className="text-need" />; content = <div className="whitespace-pre-wrap"><p>{view.criterion}</p><p className="mt-1 text-muted-foreground">{view.evidence}</p></div>; break;
    case 'tool': icon = <Terminal />; content = <p className="font-mono whitespace-pre-wrap">{view.detail}</p>; break;
    case 'diff': icon = <FileDiff />; content = <p>{t('agentUi.diff').replace('{n}', number(view.totals.files)).replace('{a}', number(view.totals.additions)).replace('{d}', number(view.totals.deletions))}</p>; break;
    case 'question': icon = <HelpCircle />; content = <p className="whitespace-pre-wrap text-need">{view.text}</p>; break;
    case 'usage': icon = <Zap />; content = <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{(['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens'] as const).map(key => <span key={key}>{t(`agentUi.${key}`)}: {number(view[key])}</span>)}</div>; break;
    case 'other': content = <p className="whitespace-pre-wrap text-muted-foreground">{view.text}</p>;
  }
  return <li className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-x-3 gap-y-1 py-3 sm:grid-cols-[1rem_minmax(0,1fr)_auto]">
    <span aria-hidden="true" className="mt-0.5 text-muted-foreground [&>svg]:size-4">{icon}</span>
    <div className="min-w-0 text-sm break-words [overflow-wrap:anywhere]">{content}</div>
    <time dateTime={event.at} title={event.at} className="col-start-2 text-xs tabular-nums text-muted-foreground sm:col-start-auto">{new Intl.DateTimeFormat(i18n.locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(event.at))}</time>
  </li>;
}

function AttemptGroup({ attempt, events, newest, onLoadAttempt }: { attempt: Attempt; events: AttemptEvent[] | undefined; newest: boolean; onLoadAttempt: Props['onLoadAttempt'] }) {
  const t = useT(); const [expanded, setExpanded] = useState(newest);
  const scroll = useRef<HTMLDivElement>(null); const following = useRef(true);
  const loader = useRef(onLoadAttempt); loader.current = onLoadAttempt;
  useEffect(() => { if (expanded && events === undefined) loader.current?.(attempt.id); }, [expanded, events, attempt.id]);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (expanded && element && isLiveAttempt(attempt.state) && following.current) element.scrollTop = element.scrollHeight;
  }, [events, expanded, attempt.state]);
  const milestones = events?.map(describeEvent).filter((view): view is Extract<EventDescription, { kind: 'milestone' }> => view.kind === 'milestone');
  const workspace = milestones?.find(view => view.state === 'workspace-ready');
  const technical = [
    ['attemptId', attempt.id], ['branch', workspace?.branch], ['baseSha', workspace?.baseSha], ['node', attempt.nodeId], ['runtime', attempt.runtime], ['provider', attempt.provider],
  ];
  return <Collapsible open={expanded} onOpenChange={setExpanded} className="min-w-0 border-b border-border pb-4 last:border-0">
    <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="h-auto w-full justify-start gap-3 px-0 py-3 text-left whitespace-normal"><ChevronDown aria-hidden="true" className={`size-4 shrink-0 ${expanded ? '' : '-rotate-90'}`} /><RunHeader attempt={attempt} events={events} /></Button></CollapsibleTrigger>
    <CollapsibleContent className="space-y-3">
      <TechDetails><KeyValueList items={technical.map(([key, value]) => ({ label: t(`agentUi.${key}`), value: cleanText(value) || t('agentUi.unknown'), mono: true }))} /></TechDetails>
      {!events?.length ? <ViewState empty compact emptyText={t('agentUi.noEvents')} /> : <div ref={scroll} className="max-h-[36rem] overflow-y-auto pr-2" onScroll={event => { const element = event.currentTarget; following.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 80; }}>
        <ol className="divide-y divide-border/40">{events.map(event => <EventRow key={event.seq} event={event} />)}</ol>
      </div>}
    </CollapsibleContent>
  </Collapsible>;
}

export function AttemptTimeline({ attempts, events, onLoadAttempt }: Props) {
  const t = useT();
  return <Section>{attempts.length ? attempts.map((attempt, index) => <AttemptGroup key={attempt.id} attempt={attempt} events={events[attempt.id]} newest={index === 0} onLoadAttempt={onLoadAttempt} />) : <ViewState empty compact emptyText={t('agentUi.noRuns')} />}</Section>;
}
