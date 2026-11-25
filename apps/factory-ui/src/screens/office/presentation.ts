import { toneOf, toneDot, toneText } from '@/lib/status';
import { i18n } from '@/i18n';
import type { ActivityRun, ActivityStatus } from '@/api/activityModels';

const statuses = ['waiting', 'problem', 'working', 'queued', 'done', 'idle'] as const;
export const dotClass = Object.fromEntries(statuses.map(status => {
  const tone = toneOf('activity', status);
  return [status, `${toneDot[tone]}${tone === 'run' ? ' motion-safe:animate-pulse' : ''}`];
})) as Record<ActivityStatus, string>;
export const pillClass = Object.fromEntries(statuses.map(status => {
  const tone = toneOf('activity', status);
  return [status, `${tone === 'need' || tone === 'error' ? 'bg-need/10' : tone === 'run' ? 'bg-run/10' : tone === 'ok' ? 'bg-ok/10' : 'bg-secondary'} ${toneText[tone]}`];
})) as Record<ActivityStatus, string>;
export function activityAttemptLabel(state: ActivityRun['attemptState']) {
  return i18n.t(['lease-expired', 'unknown', 'reconciling', 'failed'].includes(state) ? `activityUi.attempt.${state}` : `workUi.states.${state}`);
}
export function activityTime(value: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  if (seconds < 5) return i18n.t('activityUi.justNow');
  if (seconds < 60) return i18n.t('activityUi.secondsAgo').replace('{count}', String(seconds));
  if (seconds < 3600) return i18n.t('activityUi.minutesAgo').replace('{count}', String(Math.floor(seconds / 60)));
  const hours = seconds / 3600;
  return new Intl.RelativeTimeFormat(i18n.locale, { numeric: 'always' }).format(-Math.floor(hours >= 24 ? hours / 24 : hours), hours >= 24 ? 'day' : 'hour');
}
