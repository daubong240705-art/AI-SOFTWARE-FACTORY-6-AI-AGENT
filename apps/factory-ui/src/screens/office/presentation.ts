import { i18n } from '@/i18n';
export function activityTime(value: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  if (seconds < 5) return i18n.t('activityUi.justNow');
  if (seconds < 60) return i18n.t('activityUi.secondsAgo').replace('{count}', String(seconds));
  if (seconds < 3600) return i18n.t('activityUi.minutesAgo').replace('{count}', String(Math.floor(seconds / 60)));
  const hours = seconds / 3600;
  return new Intl.RelativeTimeFormat(i18n.locale, { numeric: 'always' }).format(-Math.floor(hours >= 24 ? hours / 24 : hours), hours >= 24 ? 'day' : 'hour');
}
