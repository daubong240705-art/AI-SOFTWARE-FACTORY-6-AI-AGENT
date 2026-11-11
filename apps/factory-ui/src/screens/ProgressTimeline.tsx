import type { AttemptEvent } from '../api/client';
import { i18n, useT } from '../i18n';
import { summariseEvent } from '../state/attemptView';

export function ProgressTimeline({ events }: { events: AttemptEvent[] }) {
  const t = useT();
  if (!events.length) return <p>{t('workUi.noEvents')}</p>;
  return <ol className="progress-timeline stack">{events.map(event => {
    const summary = summariseEvent(event);
    return <li key={event.seq}><time dateTime={event.at}>{new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(event.at))}</time>
      <strong> {t(`workUi.kinds.${summary.kind}`)}</strong><p className="plain-text">{summary.text}</p>
      {summary.percent !== undefined && <><progress aria-label={t('workUi.progress')} max={100} value={summary.percent} /><span>{new Intl.NumberFormat(i18n.locale, { style: 'percent' }).format(summary.percent / 100)}</span></>}
    </li>;
  })}</ol>;
}
