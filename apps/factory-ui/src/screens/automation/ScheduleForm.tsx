import { useState } from 'react';
import { scheduleInputSchema, schedulePatchSchema } from '@factory/contracts';
import type { Schedule } from '@/api/client';
import { schedulesCreate, schedulesUpdate } from '@/api/commands';
import { Select } from '@/components/Select';
import { useT } from '@/i18n';
import { EnabledField, FormField, TextField } from './FormFields';
import { FormFrame } from './FormFrame';
import { WorkflowField, workflowAction, workflowValue } from './WorkflowField';
import { changed, type FormProps } from './types';

function localDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19) : '';
}
export function ScheduleForm({ store, projectId, item, onClose }: FormProps<Schedule>) {
  const t = useT();
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState<Schedule['kind']>(item?.kind ?? 'interval');
  const originalExpr = item?.kind === 'once' ? localDate(item.expr) : item?.expr ?? '300';
  const [expr, setExpr] = useState(originalExpr);
  const [workflow, setWorkflow] = useState(workflowValue(item?.action));
  const [enabled, setEnabled] = useState(item ? item.state === 'active' : true);
  function submit() {
    if (item && item.revision === undefined) return 'automationWrite.revisionMissing';
    const expression = kind !== 'once' ? expr : item && expr === originalExpr ? item.expr : new Date(expr).toISOString();
    if (kind === 'once' && (!item || expr !== originalExpr) && Date.parse(expression) <= Date.now()) return 'automationWrite.future';
    const action = workflow ? { ...workflowAction(workflow), autoStart: item?.action?.autoStart ?? true } : { definitionKey: 'saved-workflow', autoStart: true };
    const parsed = scheduleInputSchema.safeParse({ name, kind, expr: expression, action, enabled });
    if (!parsed.success || (!item && !workflow)) return 'automationWrite.invalid';
    if (!item) return schedulesCreate({ projectId, ...parsed.data });
    const patch = changed({ name: item.name, expr: item.expr, enabled: item.state === 'active' },
      { name: parsed.data.name, expr: expression, enabled });
    if (workflow !== workflowValue(item.action)) Object.assign(patch, { action });
    if (!Object.keys(patch).length) return 'automationWrite.noChanges';
    return schedulesUpdate({ projectId, scheduleId: item.id, expectedRevision: item.revision!, patch: schedulePatchSchema.parse(patch) });
  }
  return <FormFrame area="schedules" itemId={item?.id} store={store} onClose={onClose} onSubmit={submit}>
    <TextField label={t('automationWrite.name')} help={t('automationWrite.nameHelp')} value={name} onChange={event => setName(event.target.value)} required maxLength={160} autoFocus />
    <FormField label={t('automationWrite.kind')} help={t(item ? 'automationWrite.immutable' : 'automationWrite.formHelp')}>{id => <Select id={id} value={kind} onValueChange={value => { setKind(value as Schedule['kind']); setExpr(value === 'interval' ? '300' : ''); }} disabled={Boolean(item)} options={(['interval', 'once', 'cron'] as const).map(value => ({ value, label: t(`automationWrite.scheduleKinds.${value}`) }))} />}</FormField>
    <TextField label={t(`automationWrite.${kind === 'interval' ? 'seconds' : kind === 'once' ? 'at' : 'cron'}`)} help={t(`automationWrite.${kind === 'interval' ? 'intervalHelp' : kind === 'once' ? 'onceHelp' : 'cronHelp'}`)}
      type={kind === 'once' ? 'datetime-local' : kind === 'interval' ? 'number' : 'text'} value={expr} onChange={event => setExpr(event.target.value)} required maxLength={200}
      {...(kind === 'interval' ? { min: 60, max: 2592000, step: 1 } : kind === 'once' ? { step: 1 } : {})} />
    <WorkflowField value={workflow} onChange={setWorkflow} store={store} original={item?.action} editing={Boolean(item)} />
    <EnabledField value={enabled} onChange={setEnabled} />
  </FormFrame>;
}
