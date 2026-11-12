import { useState } from 'react';
import { STANDING_ACTION_KINDS } from '@factory/contracts';
import { standingApprovalsCreate, standingApprovalsRevoke } from '@/api/commands';
import { CommandFormFrame } from '@/components/CommandFormFrame';
import { Select } from '@/components/Select';
import { useT } from '@/i18n';
import type { StandingApproval } from '@/api/settingsModels';
import type { Store } from '@/state/store';
import { standingPendingKey } from '@/state/settingsCommands';
import { FormField, TextField } from '../automation/FormFields';

const days = [1, 3, 7, 14, 30] as const;
export function StandingApprovalDialog({ store, projectId, teamOptions, onClose }: {
  store: Store; projectId: string; teamOptions: { id: string; name: string }[]; onClose: () => void;
}) {
  const t = useT();
  const [action, setAction] = useState<typeof STANDING_ACTION_KINDS[number]>('notify.send-internal');
  const [scope, setScope] = useState('project'); const [limit, setLimit] = useState('5');
  const [tokens, setTokens] = useState(''); const [expiry, setExpiry] = useState('7');
  function submit() {
    if (!days.some(value => String(value) === expiry) || (scope !== 'project' && !teamOptions.some(team => team.id === scope))) return 'settingsWrite.invalid';
    const tokenValue = tokens.trim() ? Number(tokens) : undefined;
    const limitValue = Number(limit);
    if (!Number.isSafeInteger(limitValue) || limitValue < 1 || limitValue > 50 || (tokenValue !== undefined && (!Number.isSafeInteger(tokenValue) || tokenValue <= 0))) return 'settingsWrite.invalid';
    return standingApprovalsCreate({ projectId, actionKind: action,
      scope: scope === 'project' ? { kind: 'project', ref: projectId } : { kind: 'team', ref: scope },
      limitPerDay: limitValue, ...(tokenValue === undefined ? {} : { maxTokensPerUse: tokenValue }),
      expiresAt: new Date(Date.now() + Number(expiry) * 86_400_000).toISOString() });
  }
  const options = [{ value: 'project', label: t('settingsUi.project') }, ...teamOptions.map(team => ({ value: team.id, label: team.name }))];
  return <CommandFormFrame pendingKey={standingPendingKey()} store={store} send={store.sendSettings} onClose={onClose} onSubmit={submit}
    title={t('settingsWrite.addApproval')} description={t('settingsWrite.formHelp')} submitLabel={t('automationWrite.create')} invalidKey="settingsWrite.invalid">
    <FormField label={t('settingsWrite.actionKind')} help={t(`settingsWrite.actionHelpLines.${action}`)}>{id => <Select id={id} value={action} onValueChange={value => setAction(value as typeof action)} options={STANDING_ACTION_KINDS.map(value => ({ value, label: t(`settingsUi.actions.${value}`) }))} />}</FormField>
    <FormField label={t('settingsWrite.scope')} help={t('settingsWrite.scopeHelp')}>{id => <Select id={id} value={scope} onValueChange={setScope} options={options} />}</FormField>
    <TextField label={t('settingsWrite.dailyLimit')} help={t('settingsWrite.dailyLimitHelp')} type="number" min={1} max={50} step={1} required value={limit} onChange={event => setLimit(event.target.value)} />
    <TextField label={t('settingsWrite.maxTokens')} help={t('settingsWrite.maxTokensHelp')} type="number" min={1} step={1} value={tokens} onChange={event => setTokens(event.target.value)} />
    <FormField label={t('settingsWrite.expiry')} help={t('settingsWrite.expiryHelp')}>{id => <Select id={id} value={expiry} onValueChange={setExpiry} options={days.map(value => ({ value: String(value), label: t(value === 1 ? 'settingsWrite.expiryDay' : 'settingsWrite.expiryDays').replace('{days}', String(value)) }))} />}</FormField>
    <p className="text-xs leading-relaxed text-muted-foreground">{t('settingsWrite.forbidden')}</p>
  </CommandFormFrame>;
}
export function ApprovalRevokeDialog({ item, store, projectId, onClose }: {
  item: StandingApproval; store: Store; projectId: string; onClose: () => void;
}) {
  const t = useT();
  function submit() {
    // Never manufacture a revision for older Host read responses.
    if (item.revision === null) return 'settingsWrite.revisionMissing';
    return standingApprovalsRevoke({ projectId, standingId: item.id, expectedRevision: item.revision });
  }
  return <CommandFormFrame pendingKey={standingPendingKey(item.id)} store={store} send={store.sendSettings} onClose={onClose} onSubmit={submit}
    title={t('settingsWrite.revokeTitle')} description={t('settingsWrite.revokeHelp')} submitLabel={t('settingsWrite.revoke')} invalidKey="settingsWrite.invalid">
    <p className="text-sm text-muted-foreground">{t(`settingsUi.actions.${item.actionKind}`)}</p>
  </CommandFormFrame>;
}
