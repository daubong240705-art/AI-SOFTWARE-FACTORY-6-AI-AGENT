import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useT } from '../i18n';
import type { Store } from '../state/store';

const states = ['draft', 'active', 'awaiting-approval', 'paused', 'resuming', 'completed', 'failed', 'cancelled', 'superseded', 'stalled', 'unknown', 'pending', 'ready', 'done', 'blocked', 'skipped', 'enabled', 'quarantined', 'ok', 'tripped', 'open', 'half-open'] as const;
export function m5Dot(value: string) {
  return value === 'awaiting-approval' ? 'bg-need' : ['active', 'resuming'].includes(value) ? 'bg-run' : ['completed', 'done', 'ok', 'enabled'].includes(value) ? 'bg-ok' : ['quarantined', 'tripped', 'open', 'half-open', 'stalled', 'failed', 'blocked'].includes(value) ? 'bg-info' : 'bg-muted-foreground';
}
export function M5Status({ value }: { value: string }) {
  const t = useT(); const known = states.find(state => state === value) ?? 'unknown';
  return <Badge variant="outline" className={cn('gap-1.5 border-border font-normal text-muted-foreground', ['quarantined', 'tripped', 'open', 'half-open', 'stalled', 'failed', 'blocked'].includes(known) && 'text-info')}><span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', m5Dot(known))} />{t(`m5Ui.states.${known}`)}</Badge>;
}
export function TechnicalDetails({ identifier, children }: { identifier?: string; children?: ReactNode }) {
  const t = useT();
  return <Collapsible className="text-xs text-muted-foreground"><CollapsibleTrigger asChild><Button type="button" variant="ghost" size="sm" className="-ml-2 h-7 gap-1 px-2 text-xs text-muted-foreground">{t('m5Ui.technicalDetails')}<ChevronDown className="size-3" /></Button></CollapsibleTrigger><CollapsibleContent className="space-y-2 pt-2 break-words">{identifier && <dl className="grid gap-1"><dt>{t('m5Ui.identifier')}</dt><dd className="font-mono">{identifier}</dd></dl>}{children}</CollapsibleContent></Collapsible>;
}
export function M5ReadState({ store, area, retry, empty = false, emptyKey }: { store: Store; area: string; retry: () => Promise<void>; empty?: boolean; emptyKey?: string }) {
  const t = useT(); const { loading, errors } = store.useStoreSelector(s => s); const error = errors[area];
  return <>{loading[area] && <div role="status" aria-label={t('viewStates.loading')} className="space-y-3 p-4"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-4/5" /></div>}{error && <Alert className="border-info/30"><AlertTitle>{t('errors.title')}</AlertTitle><AlertDescription><p>{t(`safeErrors.${error.code}`)}</p>{error.correlationId && <p className="font-mono text-xs">{t('errors.correlationId')}: {error.correlationId}</p>}<Button type="button" variant="outline" size="sm" disabled={loading[area]} onClick={() => void retry()}>{t('errors.retry')}</Button></AlertDescription></Alert>}{empty && emptyKey && !loading[area] && !error && <Empty className="p-6 md:p-8"><EmptyDescription>{t(emptyKey)}</EmptyDescription></Empty>}</>;
}
