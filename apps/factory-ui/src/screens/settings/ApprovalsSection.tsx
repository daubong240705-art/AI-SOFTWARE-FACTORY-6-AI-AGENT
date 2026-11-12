import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { StandingApproval } from '@/api/settingsModels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { standingPendingKey } from '@/state/settingsCommands';
import { relativeTime } from '../Inbox';
import { M5ReadState, TechnicalDetails } from '../M5Shared';
import { ApprovalRevokeDialog, StandingApprovalDialog } from './StandingApprovalDialog';

function ApprovalRow({ item, scope, store, onRevoke }: {
  item: StandingApproval; scope: string; store: Store; onRevoke: (item: StandingApproval) => void;
}) {
  const t = useT(); const max = Math.max(1, item.limitPerDay);
  const busy = store.useStoreSelector(state => state.loading[standingPendingKey(item.id)]);
  const status = item.state === 'active' && Date.parse(item.expiresAt) <= Date.now() ? 'expired' : item.state;
  return <li className="grid gap-3 border-t border-border py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
    <div className="space-y-1"><p className="font-medium">{t(`settingsUi.actions.${item.actionKind}`)}</p><p className="text-sm text-muted-foreground">{scope}</p>
      <Progress value={Math.min(100, item.usedToday / max * 100)} className="mt-2 h-1.5 bg-muted [&_[data-slot=progress-indicator]]:bg-info" />
      <p className="text-xs text-muted-foreground">{t('settingsUi.uses').replace('{used}', String(item.usedToday)).replace('{limit}', String(item.limitPerDay))}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:justify-end">
      <Badge variant="outline" className="gap-1.5 font-normal"><span aria-hidden className={status === 'active' ? 'size-1.5 rounded-full bg-ok' : 'size-1.5 rounded-full bg-muted-foreground'} />{t(`settingsUi.states.${status}`)}</Badge>
      <time dateTime={item.expiresAt}>{t('settingsUi.expires')} {relativeTime(item.expiresAt)}</time>
      {status === 'active' && <Button type="button" size="sm" variant="ghost" disabled={Boolean(busy)}
        aria-label={`${t('settingsWrite.revoke')}: ${t(`settingsUi.actions.${item.actionKind}`)} · ${scope}`} onClick={() => onRevoke(item)}>{t('settingsWrite.revoke')}</Button>}
      <TechnicalDetails identifier={item.id} />
    </div>
  </li>;
}
export function ApprovalsSection({ state, store, projectId, id }: {
  state: ReturnType<Store['getState']>; store: Store; projectId: string; id: string;
}) {
  const t = useT(); const [adding, setAdding] = useState(false); const [revoking, setRevoking] = useState<StandingApproval | null>(null);
  const approvals = state.settings.standingApprovals?.items ?? [];
  const isInactive = (item: StandingApproval) => item.state === 'revoked' || item.state === 'expired' || Date.parse(item.expiresAt) <= Date.now();
  const active = approvals.filter(item => !isInactive(item)), inactive = approvals.filter(isInactive);
  const teamName = (teamId: string) => state.m3.teams.find(team => team.id === teamId)?.name ?? (state.team?.team.id === teamId ? state.team.team.name : t('settingsUi.unknownTeam'));
  const teamIds = new Set(state.settings.autonomy?.teams.map(team => team.teamId) ?? []);
  if (state.team) teamIds.add(state.team.team.id);
  const teamOptions = [...teamIds].map(teamId => ({ id: teamId, name: teamName(teamId) }));
  const scope = (item: StandingApproval) => item.scope.kind === 'team' ? teamName(item.scope.ref) : t(`settingsUi.scope.${item.scope.kind}`);
  const rows = (items: StandingApproval[]) => <ul>{items.map(item => <ApprovalRow key={item.id} item={item} scope={scope(item)} store={store} onRevoke={setRevoking} />)}</ul>;
  return <Card role="region" aria-labelledby={id} className="gap-0 border-border py-0 shadow-none">
    <CardHeader className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:flex-row">
      <h3 id={id} className="font-display text-lg font-semibold">{t('settingsUi.standingApprovals')}</h3>
      <Button type="button" size="sm" disabled={Boolean(state.loading[standingPendingKey()])} onClick={() => setAdding(true)}>{t('settingsWrite.addApproval')}</Button>
    </CardHeader>
    <CardContent className="p-5"><M5ReadState store={store} area="standingApprovals" retry={store.loadStandingApprovals} empty={!approvals.length} emptyKey="settingsUi.emptyApprovals" />
      {active.length > 0 && rows(active)}
      {inactive.length > 0 && <Collapsible className="mt-3 border-t border-border pt-3"><CollapsibleTrigger asChild><Button type="button" variant="ghost" className="h-auto gap-2 p-0 text-sm text-muted-foreground">{t('settingsUi.inactiveApprovals')}<ChevronDown className="size-4" /></Button></CollapsibleTrigger><CollapsibleContent>{rows(inactive)}</CollapsibleContent></Collapsible>}
    </CardContent>
    {adding && <StandingApprovalDialog store={store} projectId={projectId} teamOptions={teamOptions} onClose={() => setAdding(false)} />}
    {revoking && <ApprovalRevokeDialog item={revoking} store={store} projectId={projectId} onClose={() => setRevoking(null)} />}
  </Card>;
}
