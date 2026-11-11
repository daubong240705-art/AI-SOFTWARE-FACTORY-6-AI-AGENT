import type { AttemptEvent } from '../api/client';
import { i18n, useT } from '../i18n';
import { summariseEvent } from '../state/attemptView';
import { Progress } from '@/components/ui/progress';
import { readableText } from './attention/presentation';

export function ProgressTimeline({ events }: { events: AttemptEvent[] }) {
  const t = useT();
  if (!events.length) return <p className="text-sm text-muted-foreground">{t('workUi.noEvents')}</p>;
  return <ol className="m-0 ml-1 list-none border-l border-border p-0">{events.map(event => {
    const summary = summariseEvent(event);
    return <li key={event.seq} className="relative pb-6 pl-5 last:pb-0"><span aria-hidden="true" className="absolute top-1.5 -left-1 size-2 rounded-full bg-muted-foreground ring-4 ring-background" /><time className="text-xs text-muted-foreground" dateTime={event.at}>{new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(event.at))}</time>
      <strong className="ml-2 text-xs font-medium text-muted-foreground">{t(`workUi.kinds.${summary.kind}`)}</strong><p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap break-words">{readableText(summary.text)}</p>
      {summary.percent !== undefined && <div className="mt-3 flex items-center gap-3"><Progress className="max-w-64" aria-label={t('workUi.progress')} value={summary.percent} /><span className="text-xs text-muted-foreground">{new Intl.NumberFormat(i18n.locale, { style: 'percent' }).format(summary.percent / 100)}</span></div>}
    </li>;
  })}</ol>;
}
