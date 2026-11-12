import { Select } from '@/components/Select';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { M5ReadState } from '../M5Shared';
import { FormField } from './FormFields';

type ActionSummary = { definitionKey: string; packKey?: string | null | undefined };
export const workflowValue = (action?: ActionSummary) => action ? JSON.stringify([action.definitionKey, action.packKey ?? '']) : '';
export function workflowAction(value: string) {
  const [definitionKey, packKey] = JSON.parse(value) as [string, string];
  return { definitionKey, ...(packKey ? { packKey } : {}) };
}
export function WorkflowField({ value, onChange, store, original, editing = false }: {
  value: string; onChange: (value: string) => void; store: Store; original?: ActionSummary | undefined;
  editing?: boolean;
}) {
  const t = useT();
  const definitions = store.useStoreSelector(s => s.m5.workflowDefinitions);
  const options = definitions.map(item => ({ value: workflowValue({ definitionKey: item.key, packKey: item.packKey }), label: `${item.title || item.key} · ${item.packKey}` }));
  if (original && !options.some(option => option.value === workflowValue(original))) options.unshift({ value: workflowValue(original), label: original.definitionKey });
  return <div className="space-y-2"><FormField label={t('automationWrite.workflow')} help={t(editing && !original ? 'automationWrite.actionUnavailable' : original ? 'automationWrite.actionPreserved' : 'automationWrite.workflowHelp')}>
    {id => <Select id={id} value={value} onValueChange={onChange} options={options} disabled={editing && !original} placeholder={t('automationWrite.workflow')} />}
  </FormField><M5ReadState store={store} area="workflow-definitions" retry={store.loadWorkflowDefinitions} empty={!definitions.length && !original} emptyKey="automationWrite.noWorkflows" /></div>;
}
