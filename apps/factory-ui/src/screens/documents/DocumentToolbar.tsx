import { useId } from 'react';
import { Search } from 'lucide-react';
import { knowledgeKinds, knowledgeStatuses, type KnowledgeFilters } from '@/api/readModels';
import { Select } from '@/components/Select';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useT } from '@/i18n';

export function DocumentToolbar({ query, filters, onQuery, onFilters, onClear }: {
  query: string; filters: KnowledgeFilters; onQuery: (query: string) => void; onFilters: (filters: KnowledgeFilters) => void; onClear: () => void;
}) {
  const t = useT(); const id = useId();
  return <Card className="gap-4 rounded-xl border-border p-5 shadow-none"><form role="search" aria-label={t('knowledgeUi.search')} className="grid items-end gap-4 md:grid-cols-[minmax(12rem,1fr)_12rem_12rem]" onSubmit={event => event.preventDefault()}>
    <div className="space-y-2"><Label htmlFor={`${id}-search`}>{t('knowledgeUi.search')}</Label><div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input id={`${id}-search`} type="search" className="pl-9" maxLength={200} value={query} onChange={event => onQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onQuery(''); } }} /></div></div>
    <div className="space-y-2"><Label htmlFor={`${id}-kind`}>{t('knowledgeUi.kind')}</Label><Select id={`${id}-kind`} value={filters.kinds?.[0] ?? ''} onValueChange={value => onFilters({ ...filters, kinds: value ? [value as typeof knowledgeKinds[number]] : [] })} options={[{ value: '', label: t('knowledgeUi.allKinds') }, ...knowledgeKinds.map(value => ({ value, label: t(`knowledgeUi.kinds.${value}`) }))]} /></div>
    <div className="space-y-2"><Label htmlFor={`${id}-status`}>{t('knowledgeUi.status')}</Label><Select id={`${id}-status`} value={filters.statuses?.[0] ?? ''} onValueChange={value => onFilters({ ...filters, statuses: value ? [value as typeof knowledgeStatuses[number]] : [] })} options={[{ value: '', label: t('knowledgeUi.allStatuses') }, ...knowledgeStatuses.map(value => ({ value, label: t(`knowledgeUi.statuses.${value}`) }))]} /></div>
  </form><div className="flex flex-wrap items-center justify-between gap-3"><ToggleGroup type="single" variant="outline" value={filters.origins?.[0] ?? 'all'} aria-label={t('knowledgeUi.origin')} className="rounded-full" onValueChange={value => { if (value) onFilters({ ...filters, origins: value === 'all' ? [] : [value as 'agent' | 'upload'] }); }}>
    {(['all', 'agent', 'upload'] as const).map(value => <ToggleGroupItem key={value} value={value} className="text-xs first:rounded-l-full last:rounded-r-full">{t(`knowledgeUi.origins.${value}`)}</ToggleGroupItem>)}
  </ToggleGroup><Button type="button" variant="ghost" disabled={!query && !filters.kinds?.length && !filters.statuses?.length && !filters.origins?.length} onClick={onClear}>{t('ux5.clearFilters')}</Button></div></Card>;
}
