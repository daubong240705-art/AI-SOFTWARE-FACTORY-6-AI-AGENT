import { useId, type ReactNode } from 'react';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import type { StoreError } from '@/state/store';

export function CodeCard({ title, icon, meta, loading, error, onRetry, empty, children }: {
  title: string; icon: ReactNode; meta?: ReactNode; loading: boolean;
  error: StoreError | undefined; onRetry: () => void; empty: string | false; children: ReactNode;
}) {
  const t = useT(); const id = useId();
  return <Card role="region" aria-labelledby={id} aria-busy={loading} className="gap-0 overflow-hidden rounded-xl border-border bg-card py-0 shadow-none">
    <CardHeader className="gap-3 border-b border-border px-5 py-4">
      <CardTitle id={id} className="flex items-center gap-2 font-display text-lg font-semibold">{icon}{title}</CardTitle>
      {meta}
    </CardHeader>
    <CardContent className="p-0">
      {error && <div className="space-y-3 p-5"><ErrorNotice error={error} /><Button variant="outline" size="sm" onClick={onRetry} disabled={loading}>{t('errors.retry')}</Button></div>}
      {loading ? <div role="status" aria-label={t('codeUi.loading')} className="space-y-4 p-5">
        <Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" />
      </div> : empty && !error ? <Empty className="py-10"><EmptyHeader><EmptyDescription>{empty}</EmptyDescription></EmptyHeader></Empty> : children}
    </CardContent>
  </Card>;
}

export function CodeStatus({ value, label }: { value: string; label: string }) {
  const dot = value === 'merged' || value === 'done' ? 'bg-ok' : value === 'pending' ? 'bg-run'
    : value === 'conflict' ? 'bg-need' : value === 'unknown' || value === 'unrecognized' ? 'bg-info' : 'bg-muted-foreground';
  const tone = value === 'conflict' ? 'text-need' : value === 'unknown' || value === 'unrecognized' ? 'text-info' : 'text-muted-foreground';
  return <span className={`inline-flex items-center gap-1.5 text-xs ${tone}`}><span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${dot}`} />{label}</span>;
}
