import { useEffect, useState } from 'react';
import { isLiveAttempt } from '@factory/contracts';
import type { Attempt, AttemptEvent } from '@/api/client';
import { StatusDot } from '@/components/app/StatusDot';
import { i18n, useT } from '@/i18n';
import { toneOf } from '@/lib/status';
import { cleanText, describeEvent } from '@/state/attemptView';

export function RunHeader({ attempt, events }: { attempt: Attempt; events: AttemptEvent[] | undefined }) {
  const t = useT();
  const [now, setNow] = useState(Date.now);
  const live = isLiveAttempt(attempt.state);
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  const configured = events?.map(describeEvent).find(event => event.kind === 'milestone' && event.state === 'runtime-configured');
  const agent = configured?.kind === 'milestone' ? configured.agent : undefined;
  const identity = [agent?.cli, agent?.model ?? attempt.model, agent?.effort ?? attempt.effort].filter(Boolean).map(cleanText).join(' · ');
  const seconds = attempt.startedAt && (live || attempt.endedAt)
    ? Math.max(0, Math.floor(((live ? now : Date.parse(attempt.endedAt!)) - Date.parse(attempt.startedAt)) / 1000)) : null;
  const duration = seconds === null ? null : [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
  const usage = attempt.usage;
  const total = usage && usage.inputTokens !== null && usage.outputTokens !== null ? usage.inputTokens + usage.outputTokens : null;
  const tokens = total === null ? null : new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: total >= 1000 ? 1 : 0 }).format(total >= 1000 ? total / 1000 : total) + (total >= 1000 ? 'k' : '');
  return <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
    <span className="font-medium">{t('agentUi.run').replace('{n}', String(attempt.epoch))}</span>
    {attempt.seatName && <span>{cleanText(attempt.seatName)}</span>}
    {identity && <span className="min-w-0 break-words text-muted-foreground">{identity}</span>}
    {duration && <span className="text-muted-foreground" title={t('agentUi.duration')}>{duration}</span>}
    {usage && <span className="text-muted-foreground">{tokens === null ? t('agentUi.tokensUnknown') : t('agentUi.tokens').replace('{n}', tokens)}</span>}
    <StatusDot tone={toneOf('attempt', attempt.state)} label={t(`workUi.states.${attempt.state}`)} pulse={live} />
  </span>;
}
