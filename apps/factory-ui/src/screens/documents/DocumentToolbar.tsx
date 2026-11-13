import { useId } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { knowledgeKinds, knowledgeStatuses, type KnowledgeFilters, type KnowledgeGroups } from '@/api/readModels';
import { Select } from '@/components/Select';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useT } from '@/i18n';

export type DocumentCategory = 'all' | 'images' | 'documents';
const categories: DocumentCategory[] = ['all', 'images', 'documents'];

/** Category chips filter by media type inside the selected task group. */
export function categoryOf(filters: KnowledgeFilters): DocumentCategory {
  return filters.media === 'image' ? 'images' : filters.media === 'document' ? 'documents' : 'all';
}
function withCategory(filters: KnowledgeFilters, category: DocumentCategory): KnowledgeFilters {
  const { media: _media, ...rest } = filters;
  return category === 'images' ? { ...rest, media: 'image' } : category === 'documents' ? { ...rest, media: 'document' } : rest;
}

export function DocumentToolbar({ query, filters, totals, detailed, onQuery, onFilters, onDetailed, onClear }: {
  query: string; filters: KnowledgeFilters; totals: Pick<KnowledgeGroups['totals'], 'all' | 'images' | 'documents'> | null; detailed: boolean;
  onQuery: (query: string) => void; onFilters: (filters: KnowledgeFilters) => void; onDetailed: (detailed: boolean) => void; onClear: () => void;
}) {
  const t = useT(); const id = useId();
  const category = categoryOf(filters);
  const advanced = !!filters.statuses?.length || !!filters.kinds?.length;
  // Counts describe the selected group when one is chosen, otherwise the whole project.
  const counts: Record<DocumentCategory, number | undefined> = totals ? { all: totals.all, images: totals.images, documents: totals.documents } : { all: undefined, images: undefined, documents: undefined };
  return <div className="space-y-3">
    <form role="search" aria-label={t('knowledgeUi.search')} className="relative" onSubmit={event => event.preventDefault()}>
      <Label htmlFor={`${id}-search`} className="sr-only">{t('knowledgeUi.search')}</Label>
      <Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
      <Input id={`${id}-search`} type="search" className="pl-9" placeholder={t('knowledgeUi.searchAll')} maxLength={200} value={query} onChange={event => onQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onQuery(''); } }} />
    </form>
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup type="single" variant="outline" size="sm" value={category} aria-label={t('knowledgeUi.category')} className="flex-wrap" onValueChange={value => { if (value) onFilters(withCategory(filters, value as DocumentCategory)); }}>
        {categories.map(value => <ToggleGroupItem key={value} value={value} className="gap-1.5 px-3 text-xs">{t(`knowledgeUi.categories.${value}`)}{counts[value] !== undefined && <span className="text-muted-foreground tabular-nums">{counts[value]}</span>}</ToggleGroupItem>)}
      </ToggleGroup>
      <span className="flex-1" />
      <ToggleGroup type="single" variant="outline" size="sm" value={detailed ? 'detailed' : 'compact'} aria-label={t('knowledgeUi.density')} onValueChange={value => { if (value) onDetailed(value === 'detailed'); }}>
        <ToggleGroupItem value="compact" className="px-3 text-xs">{t('knowledgeUi.compact')}</ToggleGroupItem>
        <ToggleGroupItem value="detailed" className="px-3 text-xs">{t('knowledgeUi.detailed')}</ToggleGroupItem>
      </ToggleGroup>
    </div>
    <Collapsible defaultOpen={advanced}>
      <div className="flex items-center justify-between gap-3">
        <CollapsibleTrigger className="group flex items-center gap-1.5 border-0 bg-transparent px-0 text-xs font-medium text-muted-foreground hover:text-foreground"><ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" />{t('knowledgeUi.advancedFilters')}</CollapsibleTrigger>
        <Button type="button" variant="ghost" size="sm" disabled={!query && !filters.kinds?.length && !filters.statuses?.length && !filters.origins?.length && !filters.media} onClick={onClear}>{t('ux5.clearFilters')}</Button>
      </div>
      <CollapsibleContent className="grid gap-3 pt-2 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor={`${id}-kind`} className="text-xs">{t('knowledgeUi.kind')}</Label><Select id={`${id}-kind`} value={filters.kinds?.[0] ?? ''} onValueChange={value => onFilters({ ...filters, kinds: value ? [value as typeof knowledgeKinds[number]] : [] })} options={[{ value: '', label: t('knowledgeUi.allKinds') }, ...knowledgeKinds.map(value => ({ value, label: t(`knowledgeUi.kinds.${value}`) }))]} /></div>
        <div className="space-y-1.5"><Label htmlFor={`${id}-status`} className="text-xs">{t('knowledgeUi.status')}</Label><Select id={`${id}-status`} value={filters.statuses?.[0] ?? ''} onValueChange={value => onFilters({ ...filters, statuses: value ? [value as typeof knowledgeStatuses[number]] : [] })} options={[{ value: '', label: t('knowledgeUi.allStatuses') }, ...knowledgeStatuses.map(value => ({ value, label: t(`knowledgeUi.statuses.${value}`) }))]} /></div>
      </CollapsibleContent>
    </Collapsible>
  </div>;
}
