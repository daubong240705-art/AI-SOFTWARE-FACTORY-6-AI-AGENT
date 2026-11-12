import { useEffect, useState } from 'react';
import { seatsSetRuntime } from '@/api/commands';
import { seatRuntimePendingKey } from '@/api/agentRuntime';
import type { OrgTeam } from '@/api/m3Models';
import { CommandFormFrame } from '@/components/CommandFormFrame';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Mascot } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { cliBlockReason, RuntimeCards, type RuntimeChoice } from './RuntimeCards';
import { RuntimeFields, type RuntimeDraft } from './RuntimeFields';

export function SeatRuntimeDialog({ store, seat, onClose }: { store: Store; seat: OrgTeam['seats'][number]; onClose: () => void }) {
  const t = useT(); const [config] = useState(seat.runtimeConfig);
  const [draft, setDraft] = useState<RuntimeDraft>({ choice: config?.runtime === 'acp' ? config.cli ?? 'codex' : config?.runtime ?? 'inherit', model: config?.model ?? '', effort: config?.effort ?? null, permission: config?.permission ?? 'autonomous' });
  const { projectId, data, models, errors, readOnly, loading } = store.useStoreSelector(state => ({
    projectId: state.selectedProjectId ?? state.projects[0]?.id, data: state.system.agentClis, models: state.system.models,
    errors: state.errors, readOnly: state.m3.disabled, loading: state.loading,
  }));
  useEffect(() => { void store.loadAgentClis(); void store.loadModelSettings(); }, [store]);
  const isCli = draft.choice === 'codex' || draft.choice === 'claude';
  const blocked = isCli ? cliBlockReason(data, draft.choice as 'codex' | 'claude') : null;
  const disabled = !projectId || readOnly;
  const changeRuntime = (choice: RuntimeChoice) => setDraft(previous => ({ ...previous, choice, model: '', effort: null, permission: 'autonomous' }));
  const runtimeName = draft.choice === 'inherit' ? t('agentConfig.inheritSummary').replace('{runtime}', seat.runtime ?? t('agentClis.unknown')) : draft.choice === 'native-opencode' ? 'OpenCode' : draft.choice === 'codex' ? 'Codex CLI' : 'Claude Code CLI';
  const details = draft.choice === 'inherit' ? '' : `, ${t('agentConfig.modelSummary').replace('{model}', draft.model.trim() || t('agentConfig.default'))}${draft.choice === 'claude' ? '' : `, ${t('agentConfig.effortSummary').replace('{effort}', draft.effort ? t(`modelsUi.efforts.${draft.effort}`) : t('agentConfig.default'))}`}${isCli ? `, ${t(`agentConfig.permissionSummary.${draft.permission}`)}` : ''}`;
  return <CommandFormFrame store={store} pendingKey={seatRuntimePendingKey(seat.id)} onClose={onClose} send={store.sendSeatRuntime}
    title={<span className="flex items-center gap-3"><Mascot seat={seat.isLead ? 'Lead' : seat.name} size={40} /><span>{seat.name}</span></span>}
    description={t('agentConfig.description')} submitLabel={t('agentConfig.save')} invalidKey="agentConfig.invalid" submitDisabled={disabled || Boolean(blocked)}
    onSubmit={() => {
      if (!projectId) return 'agentConfig.noProject';
      return seatsSetRuntime({ projectId, seatId: seat.id, expectedRevision: config?.revision ?? null,
        runtime: draft.choice === 'inherit' ? 'inherit' : isCli ? 'acp' : 'native-opencode',
        ...(draft.choice === 'inherit' ? {} : { ...(isCli ? { cli: draft.choice as 'codex' | 'claude' } : {}), model: draft.model.trim() || null, effort: draft.choice === 'claude' ? null : draft.effort, permission: draft.permission }),
      });
    }}>
    {!projectId && <p role="status" className="text-sm text-muted-foreground">{t('agentConfig.noProject')}</p>}
    {readOnly && <p className="text-sm text-muted-foreground">{t('m3.disabled')}</p>}
    <RuntimeCards value={draft.choice} onChange={changeRuntime} packRuntime={seat.runtime} data={data} disabled={disabled} />
    {errors['system:agentClis'] && <div className="space-y-2"><ErrorNotice error={errors['system:agentClis']} /><Button type="button" variant="ghost" size="sm" disabled={loading['system:agentClis']} onClick={() => void store.loadAgentClis(true)}>{t('agentClis.refresh')}</Button></div>}
    {errors['system:models'] && <div className="space-y-2"><ErrorNotice error={errors['system:models']} /><Button type="button" variant="ghost" size="sm" disabled={loading['system:models']} onClick={() => void store.loadModelSettings()}>{t('errors.retry')}</Button></div>}
    <RuntimeFields draft={draft} onChange={setDraft} models={models} disabled={disabled} />
    <p role="status" className="border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">{t('agentConfig.summary').replace('{name}', seat.name).replace('{runtime}', runtimeName)}{details}</p>
  </CommandFormFrame>;
}
