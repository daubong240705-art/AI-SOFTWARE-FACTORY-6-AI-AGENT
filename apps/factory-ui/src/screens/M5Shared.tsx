import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { StatusDot, ViewState, useAreaState } from '@/components/app';
import { toneOf } from '@/lib/status';
import { useT } from '../i18n';
import type { Store } from '../state/store';
export { TechDetails as TechnicalDetails } from '@/components/app';

const states = ['draft', 'proposed', 'active', 'awaiting-approval', 'paused', 'suspended', 'resuming', 'completed', 'failed', 'cancelled', 'superseded', 'stalled', 'unknown', 'pending', 'ready', 'done', 'blocked', 'skipped', 'enabled', 'quarantined', 'ok', 'tripped', 'open', 'half-open'] as const;
export function M5Status({ value }: { value: string }) {
  const t = useT(); const known = states.find(state => state === value) ?? 'unknown';
  return <Badge variant="outline" className="gap-1.5 border-border font-normal"><StatusDot tone={toneOf('automation', value)} label={t(`m5Ui.states.${known}`)} /></Badge>;
}
export function M5ReadState({ store, area, retry, empty = false, emptyKey, emptyAction }: { store: Store; area: string; retry: () => Promise<void>; empty?: boolean; emptyKey?: string; emptyAction?: ReactNode }) {
  const t = useT(); const state = useAreaState(store, area);
  const seat = area === 'monitors' ? 'Test' : 'DevOps';
  return <ViewState {...state} onRetry={() => void retry()} empty={empty && !!emptyKey} {...(emptyKey === undefined ? {} : { emptyText: t(emptyKey) })} emptyAction={emptyAction} seat={seat} compact />;
}
