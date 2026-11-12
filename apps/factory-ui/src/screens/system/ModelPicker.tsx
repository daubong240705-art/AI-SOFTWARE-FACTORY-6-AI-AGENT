import { useMemo, useState } from 'react';
import { Brain, BrainCircuit, Bot, Check, Cpu, Eye, Layers, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import type { CatalogModel } from '@/api/modelSettings';

export type PickerModel = CatalogModel & { id: string; name?: string; outside?: boolean };

export function displayName(model: PickerModel) {
  if (model.name) return model.name;
  // Combos have no provider prefix: show their id as the gateway names them (coding-main, pm).
  if (!model.id.includes('/')) return model.id;
  const raw = model.id.slice(model.id.indexOf('/') + 1);
  return raw.replace(/[-_]+/g, ' ').replace(/\b\w/g, value => value.toUpperCase());
}
function provider(model: PickerModel) {
  if (!model.id.includes('/')) return 'Combos';
  const prefix = model.id.slice(0, model.id.indexOf('/')).toLowerCase();
  const mapped: Record<string, string> = { cx: 'OpenAI Codex', ag: 'Antigravity', ds: 'DeepSeek', oc: 'OpenCode' };
  return mapped[prefix] ?? model.provider ?? prefix.replace(/[-_]+/g, ' ').replace(/\b\w/g, value => value.toUpperCase());
}
function ProviderIcon({ group }: { group: string }) {
  if (group === 'Combos') return <Layers className="size-4" />;
  if (group === 'Antigravity') return <Sparkles className="size-4" />;
  if (group === 'OpenAI Codex') return <Bot className="size-4" />;
  if (group === 'DeepSeek') return <Brain className="size-4" />;
  return <Cpu className="size-4" />;
}
function providerTone(group: string) {
  if (group === 'Combos') return 'text-primary';
  if (group === 'Antigravity') return 'text-info';
  if (group === 'OpenAI Codex') return 'text-ok';
  if (group === 'DeepSeek') return 'text-run';
  return 'text-muted-foreground';
}

export function ModelPicker({ models, selected, multi, onChange }: {
  models: PickerModel[]; selected: string[]; multi: boolean; onChange: (next: string[]) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return models.filter(model => !needle || `${model.id} ${displayName(model)}`.toLocaleLowerCase().includes(needle));
  }, [models, query]);
  const groups = useMemo(() => {
    const result = new Map<string, PickerModel[]>();
    for (const model of filtered) { const group = provider(model); result.set(group, [...(result.get(group) ?? []), model]); }
    return [...result.entries()].sort(([a], [b]) => a === 'Combos' ? -1 : b === 'Combos' ? 1 : a.localeCompare(b)).map(([name, items]) => [name, items.sort((a, b) => displayName(a).localeCompare(displayName(b)))] as const);
  }, [filtered]);
  const allShown = multi && filtered.length > 0 && filtered.every(model => selected.includes(model.id));
  const bulkExceedsLimit = new Set([...selected, ...filtered.map(model => model.id)]).size > 8;
  function selectShown() {
    if (allShown) onChange(selected.filter(id => !filtered.some(model => model.id === id)));
    else if (!bulkExceedsLimit) onChange([...selected, ...groups.flatMap(([, items]) => items.map(model => model.id)).filter(id => !selected.includes(id))]);
  }
  const toggle = (model: PickerModel) => {
    if (!multi) { onChange([model.id]); return; }
    if (selected.includes(model.id)) onChange(selected.filter(id => id !== model.id));
    else if (selected.length < 8) onChange([...selected, model.id]);
  };
  return <div className="min-w-0 space-y-3">
    <Input value={query} onChange={event => setQuery(event.target.value)} aria-label={t('modelsUi.search')} placeholder={t('modelsUi.search')} className="h-9" />
    <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground" aria-live="polite">{t('modelsUi.count').replace('{count}', String(filtered.length))}</span>
      {multi && <Button type="button" size="sm" variant="outline" disabled={!filtered.length || (!allShown && bulkExceedsLimit)} onClick={selectShown} aria-describedby={bulkExceedsLimit ? 'model-picker-limit' : undefined}>{allShown ? t('modelsUi.clearAll') : t('modelsUi.selectAll').replace('{count}', String(filtered.length))}</Button>}
    </div>
    {multi && <p id="model-picker-limit" className="text-xs text-muted-foreground" role="status">{t('modelsUi.limit')}</p>}
    <ScrollArea className="h-[min(48vh,430px)] rounded-lg border border-border bg-background/20 p-3"><div className="space-y-5 pr-2">
      {groups.map(([group, items]) => <section key={group} className="space-y-2"><div className={cn('flex items-center gap-2 text-sm font-medium', providerTone(group))}><ProviderIcon group={group} /><span>{group}</span><span className="text-xs text-muted-foreground">({items.length})</span></div><div className="flex flex-wrap gap-2">
        {items.map(model => { const picked = selected.includes(model.id); const disabled = multi && !picked && selected.length >= 8; return <Toggle key={model.id} type="button" variant="outline" pressed={picked} disabled={disabled} onPressedChange={() => toggle(model)} aria-label={`${displayName(model)} (${model.id})${model.vision ? `, ${t('modelsUi.vision')}` : ''}${model.reasoning ? `, ${t('modelsUi.reasoning')}` : ''}`} title={model.id} className={cn('h-auto min-h-9 max-w-full rounded-full border-border bg-card px-3 py-1.5 text-left hover:border-primary/60 hover:bg-card data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground', disabled && 'opacity-45')}>
          <span className="min-w-0 break-all whitespace-normal font-medium">{displayName(model)}</span>{model.vision && <TooltipProvider><Tooltip><TooltipTrigger asChild><span className="inline-flex"><Eye className="size-3.5 text-info" aria-hidden="true" /><span className="sr-only">{t('modelsUi.vision')}</span></span></TooltipTrigger><TooltipContent>{t('modelsUi.vision')}</TooltipContent></Tooltip></TooltipProvider>}{model.reasoning && <TooltipProvider><Tooltip><TooltipTrigger asChild><span className="inline-flex"><BrainCircuit className="size-3.5 text-run" aria-hidden="true" /><span className="sr-only">{t('modelsUi.reasoning')}</span></span></TooltipTrigger><TooltipContent>{t('modelsUi.reasoning')}</TooltipContent></Tooltip></TooltipProvider>}{model.outside && <Badge variant="outline" className="border-border px-1.5 text-[10px] text-muted-foreground">{t('modelsUi.outside')}</Badge>}{picked && <Check className="size-3.5 text-primary" aria-hidden="true" />}</Toggle>; })}
      </div></section>)}
      {!groups.length && <p className="py-8 text-center text-sm text-muted-foreground">{t('modelsUi.empty')}</p>}
    </div></ScrollArea>
  </div>;
}
