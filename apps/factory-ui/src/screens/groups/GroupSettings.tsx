import { useState } from 'react';
import { agentAdapterSchema, agentEffortSchema, groupSettingsSchema, type GroupDetail, type GroupSettings as Settings } from '@factory/contracts';
import { groupsSetSettings } from '@/api/commands';
import { ApiClientError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { i18n, useT } from '@/i18n';
import { Choice, Field, useWriteFeedback } from '../agents/shared';
import { useGroupLabels, useGroups } from './GroupsContext';
import { WriteIssue } from './GroupDialogs';

const keys = ['defaultModel', 'defaultAdapter', 'defaultEffort', 'budgetTokens30d'] as const;
type Key = typeof keys[number];

export function GroupSettings({ detail, blocked }: { detail: GroupDetail; blocked: boolean }) {
  const t = useGroupLabels();
  const global = useT();
  const { submit } = useGroups();
  const writer = useWriteFeedback(submit);
  const [draft, setDraft] = useState<{ overrides: Partial<Record<Key, string>>; revision: number }>();
  const [tried, setTried] = useState(false);
  const saved = Object.fromEntries(keys.map(key => [key, String(detail.settings[key] ?? '')])) as Record<Key, string>;
  const values = { ...saved, ...draft?.overrides };
  const valid = groupSettingsSchema.safeParse({
    defaultModel: values.defaultModel.trim() || null,
    defaultAdapter: values.defaultAdapter || null,
    defaultEffort: values.defaultEffort || null,
    budgetTokens30d: values.budgetTokens30d ? Number(values.budgetTokens30d) : null,
  });
  const stale = !!draft && draft.revision !== detail.settingsRevision;
  const dirty = keys.some(key => values[key] !== saved[key]);
  const disabled = !dirty || blocked || stale || writer.error instanceof ApiClientError && writer.error.code === 'conflict';
  function change(key: Key, value: string) {
    setDraft({ overrides: { ...draft?.overrides, [key]: value }, revision: draft?.revision ?? detail.settingsRevision });
  }
  function display(key: Key, value: Settings[Key]) {
    if (value === null) return t('noValue');
    if (key === 'defaultAdapter') return global(`agentsAdmin.adapters.${value}`);
    if (key === 'defaultEffort') return global(`agentsAdmin.effort.${value}`);
    return typeof value === 'number' ? new Intl.NumberFormat(i18n.locale).format(value) : value;
  }
  return <form className="max-w-3xl space-y-5 rounded-xl border border-border bg-card/60 p-4 sm:p-6" noValidate aria-busy={writer.busy}
    onSubmit={event => {
      event.preventDefault(); setTried(true);
      if (disabled || !valid.success) return;
      void writer.run(() => groupsSetSettings({ groupId: detail.group.id, expectedRevision: draft?.revision ?? detail.settingsRevision, settings: valid.data }),
        () => { setDraft(undefined); setTried(false); });
    }}>
    <p className="text-sm text-muted-foreground">{t('settingsHelp')}</p>
    {keys.map(key => {
      const effective = detail.effective[key];
      const sourceId = effective.source === 'default' ? null : effective.source.groupId;
      const sourceName = detail.ancestors.find(group => group.id === sourceId)?.name;
      const source = sourceId === detail.group.id ? t('override') : sourceName ? t('inherited', { name: sourceName }) : t('hostDefault');
      const invalid = !valid.success && valid.error.issues.some(issue => issue.path[0] === key);
      return <section key={key} className="space-y-2 border-b border-border pb-4">
        <div className="flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1">
          <Field label={t(key)} hint={key === 'defaultModel' ? t('modelHint') : key === 'budgetTokens30d' ? t('budgetHint') : undefined}
            invalid={tried && invalid ? t(`invalid.${key}`) : undefined}>
            {props => key === 'defaultAdapter' || key === 'defaultEffort' ? <Choice data-testid={`group-setting-${key}`} {...props} disabled={writer.busy} value={values[key]} onChange={event => change(key, event.target.value)}>
              <option value="">{t('inherit')}</option>
              {(key === 'defaultAdapter' ? agentAdapterSchema.options : agentEffortSchema.options).map(value => <option key={value} value={value}>{display(key, value)}</option>)}
            </Choice> : <Input data-testid={`group-setting-${key}`} {...props} disabled={writer.busy} value={values[key]} placeholder={t('inherit')}
              {...(key === 'defaultModel' ? { maxLength: 256 } : { type: 'number', min: 1, max: Number.MAX_SAFE_INTEGER, step: 1 })} onChange={event => change(key, event.target.value)} />}
          </Field></div>
          <Button type="button" variant="outline" disabled={writer.busy || !values[key]} aria-label={`${t('clearOverride')}: ${t(key)}`} onClick={() => change(key, '')}>{t('clearOverride')}</Button>
        </div>
        <p className="break-words text-sm text-muted-foreground">{t('effective')}: <strong>{display(key, effective.value)}</strong> <span>({source})</span></p>
      </section>;
    })}
    <WriteIssue error={writer.error} stale={stale} loading={blocked} onReload={() => {
      if (draft) setDraft({ ...draft, revision: detail.settingsRevision });
      writer.setError(null);
    }} />
    <Button data-testid="group-settings-save" type="submit" disabled={disabled || writer.busy}>{writer.busy ? global('viewStates.loading') : t('save')}</Button>
  </form>;
}
