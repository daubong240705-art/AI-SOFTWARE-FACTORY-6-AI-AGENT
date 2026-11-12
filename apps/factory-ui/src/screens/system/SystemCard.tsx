import { useId, type ReactNode } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorNotice } from '@/components/ErrorNotice';
import { cn } from '@/lib/utils';
import { i18n, useT } from '@/i18n';
import type { Store } from '@/state/store';
import type { SystemArea } from '@/state/system';
import { relativeTime } from '../Inbox';

export function SystemCard({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return <Card role="region" aria-labelledby={id} className="min-w-0 gap-0 rounded-xl border-border py-0 shadow-none">
    <CardHeader className="border-b border-border px-5 py-4"><h2 id={id} className="font-display text-lg font-semibold">{title}</h2></CardHeader>
    <CardContent className="min-w-0 space-y-4 px-5 py-4">{children}</CardContent>
  </Card>;
}

export function SystemRead({ store, area, children, showOnError = false }: {
  store: Store; area: SystemArea; children: ReactNode; showOnError?: boolean;
}) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  const error = state.errors[`system:${area}`]; const data = state.system[area];
  if (data === null && !error) return <div role="status" aria-label={t('viewStates.loading')} className="space-y-3">
    <Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-1/2" />
  </div>;
  return <>
    {error && <div className="space-y-3"><ErrorNotice error={error} />
      <Button type="button" variant="outline" size="sm" disabled={state.loading[`system:${area}`]} onClick={() => void store.loadSystem(area)}>{t('errors.retry')}</Button>
    </div>}
    {(data !== null || showOnError) && children}
  </>;
}

export function SystemStatus({ tone, label }: { tone: 'ok' | 'info' | 'run' | 'muted'; label: string }) {
  return <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
    <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', tone === 'ok' ? 'bg-ok' : tone === 'info' ? 'bg-info' : tone === 'run' ? 'bg-run' : 'bg-muted-foreground')} />{label}
  </span>;
}

export function SystemTime({ value, now }: { value: string | null | undefined; now: number }) {
  const t = useT();
  if (!value || !Number.isFinite(Date.parse(value))) return <span className="text-muted-foreground">{t('systemUi.unknown')}</span>;
  return <time dateTime={value} title={new Date(value).toLocaleString(i18n.locale)}>{relativeTime(value, now)}</time>;
}

export function Fact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
    <dt className="text-muted-foreground">{label}</dt><dd className={cn('min-w-0 break-words', mono && 'font-mono text-xs')}>{children}</dd>
  </div>;
}
