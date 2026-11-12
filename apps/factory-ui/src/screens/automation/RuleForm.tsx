import { useState } from 'react';
import { ruleEventTypeSchema, ruleInputSchema, rulePatchSchema } from '@factory/contracts';
import type { AutomationRule } from '@/api/client';
import { rulesCreate, rulesUpdate } from '@/api/commands';
import { Select } from '@/components/Select';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/i18n';
import { EnabledField, FormField, TextField } from './FormFields';
import { FormFrame } from './FormFrame';
import { WorkflowField, workflowAction, workflowValue } from './WorkflowField';
import { changed, type FormProps } from './types';

const triggerKeys = ['task', 'artifact', 'workflow', 'monitor'];
export function RuleForm({ store, projectId, item, onClose }: FormProps<AutomationRule>) {
  const t = useT();
  const simple = item?.condition && 'field' in item.condition && item.condition.field === 'to' && item.condition.op === 'eq' ? item.condition.value as string : undefined;
  const [name, setName] = useState(item?.name ?? '');
  const [eventType, setEventType] = useState(item?.eventType ?? 'task.status-changed');
  const [status, setStatus] = useState(simple ?? '');
  const [replace, setReplace] = useState(!item || simple !== undefined);
  const [workflow, setWorkflow] = useState(workflowValue(item?.action));
  const [enabled, setEnabled] = useState(item ? item.state === 'active' : true);
  function submit() {
    if (item && item.revision === undefined) return 'automationWrite.revisionMissing';
    const condition = replace ? { field: 'to' as const, op: 'eq' as const, value: status.trim() } : item?.condition;
    const action = { kind: 'start-workflow' as const, ...(workflow ? workflowAction(workflow) : { definitionKey: 'saved-workflow' }) };
    if (!item) {
      const parsed = ruleInputSchema.safeParse({ name, eventType, condition, action, enabled });
      return parsed.success && workflow ? rulesCreate({ projectId, ...parsed.data }) : 'automationWrite.invalid';
    }
    const patch = changed({ name: item.name, enabled: item.state === 'active' }, { name: name.trim(), enabled });
    if (replace && JSON.stringify(condition) !== JSON.stringify(item.condition)) Object.assign(patch, { condition });
    if (workflow !== workflowValue(item.action)) Object.assign(patch, { action });
    const parsed = rulePatchSchema.safeParse(patch);
    if (!parsed.success) return 'automationWrite.invalid';
    if (!Object.keys(parsed.data).length) return 'automationWrite.noChanges';
    return rulesUpdate({ projectId, ruleId: item.id, expectedRevision: item.revision!, patch: parsed.data });
  }
  return <FormFrame area="rules" itemId={item?.id} store={store} onClose={onClose} onSubmit={submit}>
    <TextField label={t('automationWrite.name')} help={t('automationWrite.nameHelp')} value={name} onChange={event => setName(event.target.value)} required maxLength={160} autoFocus />
    <FormField label={t('automationWrite.eventType')} help={t(item ? 'automationWrite.immutable' : 'automationWrite.formHelp')}>{id => <Select id={id} value={eventType} onValueChange={setEventType} disabled={Boolean(item)} options={ruleEventTypeSchema.options.map((value, index) => ({ value, label: t(`automationUi.triggers.${triggerKeys[index]}`) }))} />}</FormField>
    {replace ? <FormField label={t('automationWrite.condition')} help={t('automationWrite.conditionHelp')}>{(id, helpId) => <Textarea id={id} aria-describedby={helpId} rows={2} value={status} onChange={event => setStatus(event.target.value)} required maxLength={160} />}</FormField>
      : <div className="space-y-2 text-sm"><p className="text-muted-foreground">{t('automationWrite.conditionAdvancedHelp')}</p><Button type="button" size="sm" variant="outline" onClick={() => setReplace(true)}>{t('automationWrite.replaceCondition')}</Button></div>}
    {item && simple === undefined && replace && <Button type="button" size="sm" variant="ghost" onClick={() => setReplace(false)}>{t('automationWrite.keepCondition')}</Button>}
    <WorkflowField value={workflow} onChange={setWorkflow} store={store} original={item?.action} editing={Boolean(item)} />
    <EnabledField value={enabled} onChange={setEnabled} />
  </FormFrame>;
}
