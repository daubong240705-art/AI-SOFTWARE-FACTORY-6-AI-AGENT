import { ArrowDown, ArrowUp, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

export function ModelPickerAgentOrder({ models, onChange }: { models: string[]; onChange: (models: string[]) => void }) {
  const t = useT();
  function move(index: number, target: number) {
    if (target < 0 || target >= models.length) return;
    const next = [...models]; const [model] = next.splice(index, 1);
    if (model) next.splice(target, 0, model);
    onChange(next);
  }
  return <section className="space-y-2" aria-label={t('modelsUi.chosen')}>
    <h3 className="text-sm font-medium">{t('modelsUi.chosen')} <span className="text-muted-foreground">({models.length}/8)</span></h3>
    {!models.length && <p className="text-xs text-muted-foreground">{t('modelsUi.minimum')}</p>}
    <ol className="space-y-1">{models.map((model, index) => <li key={model} className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background/20 px-2 py-1">
      <span className="w-4 shrink-0 text-center font-mono text-xs text-muted-foreground">{index + 1}</span>
      <span className="min-w-0 flex-1 break-all text-xs">{model}</span>
      {index === 0 && <Badge variant="secondary" className="text-[10px]">{t('modelsUi.default')}</Badge>}
      <Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" aria-label={t('modelsUi.makeDefault').replace('{model}', model)} aria-pressed={index === 0} onClick={() => move(index, 0)}><Star className={cn('size-3.5', index === 0 && 'fill-primary text-primary')} /></Button>
      <Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" disabled={index === 0} aria-label={t('modelsUi.moveUp').replace('{model}', model)} onClick={() => move(index, index - 1)}><ArrowUp className="size-3.5" /></Button>
      <Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" disabled={index === models.length - 1} aria-label={t('modelsUi.moveDown').replace('{model}', model)} onClick={() => move(index, index + 1)}><ArrowDown className="size-3.5" /></Button>
    </li>)}</ol>
  </section>;
}
