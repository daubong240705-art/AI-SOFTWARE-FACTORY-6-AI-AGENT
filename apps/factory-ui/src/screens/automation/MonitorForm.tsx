import { useState } from 'react';
import { artifactKindSchema, monitorCreateSchema, monitorPatchSchema } from '@factory/contracts';
import type { Monitor } from '@/api/client';
import { monitorsCreate, monitorsUpdate } from '@/api/commands';
import { Select } from '@/components/Select';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { EnabledField, FormField, TextField } from './FormFields';
import { FormFrame } from './FormFrame';
import { changed, type FormProps } from './types';

export function MonitorForm({ store, projectId, item, onClose }: FormProps<Monitor>) {
  const t = useT();
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState(item?.kind ?? 'workflow-stalled');
  const [threshold, setThreshold] = useState(item?.threshold === undefined ? item ? '' : '0' : String(item.threshold));
  const [comparator, setComparator] = useState(item?.comparator ?? (kind === 'disk-free' ? 'lt' : 'gt'));
  const [enabled, setEnabled] = useState(item ? item.state === 'active' : true);
  const [replace, setReplace] = useState(!item || item.params !== undefined);
  const [age, setAge] = useState(item?.params && 'days' in item.params ? String(item.params.days) : item?.params && 'hours' in item.params ? String(item.params.hours) : '');
  const [artifact, setArtifact] = useState(item?.params && 'kind' in item.params ? item.params.kind : 'other');
  const filtered = kind === 'artifact-age' || kind === 'approval-overdue';
  function submit() {
    if (item && item.revision === undefined) return 'automationWrite.revisionMissing';
    const params = kind === 'artifact-age' ? { kind: artifact, days: Number(age) } : kind === 'approval-overdue' ? { hours: Number(age) } : kind === 'disk-free' ? { path: 'state' as const } : {};
    if (!item) {
      const parsed = monitorCreateSchema.safeParse({ name, kind, params, threshold: Number(threshold), comparator, enabled });
      return parsed.success && threshold !== '' ? monitorsCreate({ projectId, ...parsed.data }) : 'automationWrite.invalid';
    }
    const patch = changed({ name: item.name, enabled: item.state === 'active', comparator: item.comparator ?? (kind === 'disk-free' ? 'lt' : 'gt') },
      { name: name.trim(), enabled, comparator });
    if (threshold !== (item.threshold === undefined ? '' : String(item.threshold))) Object.assign(patch, { threshold: threshold === '' ? NaN : Number(threshold) });
    if (filtered && replace && JSON.stringify(params) !== JSON.stringify(item.params)) {
      if (!monitorCreateSchema.safeParse({ name, kind, params, threshold: 0 }).success) return 'automationWrite.invalid';
      Object.assign(patch, { params });
    }
    const parsed = monitorPatchSchema.safeParse(patch);
    if (!parsed.success) return 'automationWrite.invalid';
    if (!Object.keys(parsed.data).length) return 'automationWrite.noChanges';
    return monitorsUpdate({ projectId, monitorId: item.id, expectedRevision: item.revision!, patch: parsed.data });
  }
  return <FormFrame area="monitors" itemId={item?.id} store={store} onClose={onClose} onSubmit={submit}>
    <TextField label={t('automationWrite.name')} help={t('automationWrite.nameHelp')} value={name} onChange={event => setName(event.target.value)} required maxLength={160} autoFocus />
    <FormField label={t('automationWrite.monitorKind')} help={t(item ? 'automationWrite.immutable' : 'automationWrite.monitorHelp')}>{id => <Select id={id} value={kind} onValueChange={value => { setKind(value as typeof kind); setComparator(value === 'disk-free' ? 'lt' : 'gt'); }} disabled={Boolean(item)} options={monitorCreateSchema.shape.kind.options.map(value => ({ value, label: t(`automationWrite.monitorKinds.${value}`) }))} />}</FormField>
    {filtered && item && !replace && <div className="space-y-2 text-sm"><p className="text-muted-foreground">{t('automationWrite.paramsHidden')}</p><Button type="button" size="sm" variant="outline" onClick={() => setReplace(true)}>{t('automationWrite.replaceParams')}</Button></div>}
    {filtered && replace && <>
      {kind === 'artifact-age' && <FormField label={t('automationWrite.artifactKind')} help={t('automationWrite.artifactHelp')}>{id => <Select id={id} value={artifact} onValueChange={value => setArtifact(value as typeof artifact)} options={artifactKindSchema.options.map(value => ({ value, label: t(`knowledgeUi.kinds.${value}`) }))} />}</FormField>}
      <TextField label={t(kind === 'artifact-age' ? 'automationWrite.days' : 'automationWrite.hours')} help={t(kind === 'artifact-age' ? 'automationWrite.daysHelp' : 'automationWrite.hoursHelp')} type="number" min={1} max={kind === 'artifact-age' ? 3650 : 8760} step={1} value={age} onChange={event => setAge(event.target.value)} required />
      {item && !item.params && <Button type="button" size="sm" variant="ghost" onClick={() => setReplace(false)}>{t('automationWrite.keepParams')}</Button>}
    </>}
    <TextField label={t('automationWrite.threshold')} help={t(kind === 'disk-free' ? 'automationWrite.diskThresholdHelp' : 'automationWrite.thresholdHelp')} type="number" min={0} step="any" value={threshold} onChange={event => setThreshold(event.target.value)} required={!item || item.threshold !== undefined} />
    <FormField label={t('automationWrite.comparator')} help={t(kind === 'disk-free' ? 'automationWrite.diskThresholdHelp' : 'automationWrite.thresholdHelp')}>{id => <Select id={id} value={comparator} onValueChange={value => setComparator(value as typeof comparator)} options={(['gt', 'lt'] as const).map(value => ({ value, label: t(`automationWrite.comparators.${value}`) }))} />}</FormField>
    <EnabledField value={enabled} onChange={setEnabled} />
  </FormFrame>;
}
