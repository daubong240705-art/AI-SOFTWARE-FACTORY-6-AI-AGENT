import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/Select';
import { workflowsAssignStage } from '@/api/commands';
import type { WorkflowDetail, WorkflowStage } from '@/api/m5Models';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { useM3Command } from '../M3Shared';
import { M5ReadState } from '../M5Shared';

export function StageAssignment({ store, projectId, detail, stage }: { store: Store; projectId: string; detail: WorkflowDetail; stage: WorkflowStage }) {
  const t = useT(); const id = useId(); const state = store.useStoreSelector(value => value);
  const [engagement, setEngagement] = useState(stage.engagementId ?? '');
  const command = useM3Command(store, store.loadWorkflows);
  useEffect(() => { void store.loadTeams(); }, [store, projectId]);
  const choices = state.m3.teams.flatMap(team => team.engagements.filter(item => item.projectId === projectId && item.state === 'active').map(item => ({ value: item.engagementId, label: team.name })));
  if (state.team?.engagement.state === 'active' && state.team.engagement.projectId === projectId && !choices.some(item => item.value === state.team?.engagement.id)) choices.push({ value: state.team.engagement.id, label: state.team.team.name });
  const allowed = ['pending', 'blocked'].includes(stage.state) && !['completed', 'failed', 'cancelled', 'superseded', 'unknown'].includes(detail.state);
  const disabled = command.busy || state.session !== 'authenticated' || !allowed || detail.revision === undefined;
  return <div className="space-y-3"><Label htmlFor={id}>{t('workflowGraph.assign')}</Label><Select id={id} value={engagement} onValueChange={setEngagement} disabled={disabled} options={[{ value: '', label: t('workflowGraph.autoAssign') }, ...choices, ...(engagement && !choices.some(choice => choice.value === engagement) ? [{ value: engagement, label: t('settingsUi.unknownTeam'), disabled: true }] : [])]} /><Button type="button" size="sm" variant="outline" disabled={disabled || engagement === (stage.engagementId ?? '')} onClick={() => { if (!disabled && detail.revision !== undefined) void command.run(workflowsAssignStage({ projectId, instanceId: detail.id, expectedRevision: detail.revision, stageKey: stage.key, engagementId: engagement || null })); }}>{t('workflowGraph.save')}</Button><M5ReadState store={store} area="teams" retry={store.loadTeams} />{command.notice}</div>;
}
