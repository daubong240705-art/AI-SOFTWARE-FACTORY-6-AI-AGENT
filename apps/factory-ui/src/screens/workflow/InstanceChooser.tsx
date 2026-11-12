import { Select } from '@/components/Select';
import type { WorkflowInstance } from '@/api/m5Models';
import { useT } from '@/i18n';

export function InstanceChooser({ instances, selected, onSelect }: { instances: WorkflowInstance[]; selected: string; onSelect: (id: string) => void }) {
  const t = useT();
  const current = instances.find(item => item.id === selected);
  if (instances.length <= 1) return <span className="truncate text-sm font-medium">{current?.title}</span>;
  return <div className="w-56 min-w-0"><Select aria-label={t('workflowUi.list')} value={selected} onValueChange={onSelect} options={instances.map(item => ({ value: item.id, label: item.title }))} /></div>;
}
