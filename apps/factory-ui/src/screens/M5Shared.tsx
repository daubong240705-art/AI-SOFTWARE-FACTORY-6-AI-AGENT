import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { StatusDot, ViewState, useAreaState } from '@/components/app';
import { toneOf, toneDot, type StatusKind } from '@/lib/status';
import { useT } from '../i18n';
import type { Store } from '../state/store';
export { TechDetails as TechnicalDetails } from '@/components/app';

const states = ['draft', 'proposed', 'active', 'awaiting-approval', 'paused', 'suspended', 'resuming', 'completed', 'failed', 'cancelled', 'superseded', 'stalled', 'unknown', 'pending', 'ready', 'done', 'blocked', 'skipped', 'enabled', 'quarantined', 'ok', 'tripped', 'open', 'half-open'] as const;
function statusKind(value: string): StatusKind {
  return ['enabled', 'quarantined', 'ok', 'tripped', 'open', 'half-open'].includes(value) ? 'automation'
    : ['pending', 'ready', 'done', 'blocked', 'skipped'].includes(value) ? 'stage' : 'workflow';
}
export function m5Dot(value: string) {
  return toneDot[toneOf(statusKind(value), value)];
}
export function M5Status({ value }: { value: string }) {
  const t = useT(); const known = states.find(state => state === value) ?? 'unknown';
  return <Badge variant="outline" className="gap-1.5 border-border font-normal"><StatusDot tone={toneOf(statusKind(value), value)} label={t(['proposed', 'suspended'].includes(known) ? `workflowGraph.states.${known}` : `m5Ui.states.${known}`)} /></Badge>;
}
export function M5ReadState({ store, area, retry, empty = false, emptyKey, emptyAction }: { store: Store; area: string; retry: () => Promise<void>; empty?: boolean; emptyKey?: string; emptyAction?: ReactNode }) {
  const t = useT(); const state = useAreaState(store, area);
  const definitions = area === 'workflow-definitions'; const workflow = area === 'workflows';
  const seat = workflow || definitions ? 'BA' : area === 'monitors' ? 'Test' : 'DevOps';
  return <ViewState {...state} onRetry={() => void retry()} empty={empty && !!emptyKey} {...(emptyKey === undefined ? {} : { emptyText: t(emptyKey) })} emptyAction={emptyAction} seat={seat} mascotState={workflow ? 'thinking' : definitions ? 'offline' : 'idle'} compact={!workflow} />;
}
