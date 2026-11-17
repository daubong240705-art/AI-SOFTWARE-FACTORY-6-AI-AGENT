import { i18n, plural } from '@/i18n';

export function inboxCount(t: (key: string) => string, count: number) { return `${new Intl.NumberFormat(i18n.locale).format(count)} ${plural(t, i18n.locale, count, 'inboxUi.count')}`; }
export function relativeTime(value: string, now = Date.now()): string {
  const seconds = (Date.parse(value) - now) / 1000;
  const [size, unit] = Math.abs(seconds) >= 86400 ? [86400, 'day'] as const : Math.abs(seconds) >= 3600 ? [3600, 'hour'] as const : Math.abs(seconds) >= 60 ? [60, 'minute'] as const : [1, 'second'] as const;
  return new Intl.RelativeTimeFormat(i18n.locale, { numeric: 'always', style: 'short' }).format(Math.round(seconds / size), unit);
}
export type InboxSelection = { kind: 'approval' | 'task' | 'request'; id: string };
