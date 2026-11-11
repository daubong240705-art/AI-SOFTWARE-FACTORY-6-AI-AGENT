import { Button } from '@/components/ui/button';
import { Select } from '@/components/Select';
import type { WorkflowInstance } from '@/api/m5Models';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { M5Status } from '../M5Shared';

export function InstanceChooser({ instances, selected, onSelect }: { instances: WorkflowInstance[]; selected: string; onSelect: (id: string) => void }) {
  const t = useT();
  if (instances.length > 3) return <div className="flex max-w-lg items-center gap-3"><Select aria-label={t('workflowUi.list')} value={selected} onValueChange={onSelect} options={instances.map(item => ({ value: item.id, label: `${item.title} · ${t(`m5Ui.states.${item.state}`)}` }))} /><M5Status value={instances.find(item => item.id === selected)?.state ?? 'unknown'} /></div>;
  return <div role="group" aria-label={t('workflowUi.list')} className="flex flex-wrap gap-2">{instances.map(item => <Button key={item.id} type="button" variant="outline" aria-pressed={selected === item.id} className={cn('h-auto max-w-full gap-3 rounded-full px-4 py-2', selected === item.id && 'bg-secondary')} onClick={() => onSelect(item.id)}><span className="truncate">{item.title}</span><M5Status value={item.state} /></Button>)}</div>;
}
