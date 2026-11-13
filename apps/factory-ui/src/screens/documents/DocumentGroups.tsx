import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, FileUp, Files, ListChecks, Search, Bot } from 'lucide-react';
import type { KnowledgeGroup, KnowledgeGroupKey, KnowledgeGroups } from '@/api/readModels';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

type SectionKey = 'review' | 'active' | 'done' | 'closed';
const sections: Array<{ key: SectionKey; states: string[]; open: boolean }> = [
  { key: 'review', states: ['in-review', 'awaiting-go'], open: true },
  { key: 'active', states: ['draft', 'proposed', 'accepted', 'ready', 'active'], open: true },
  { key: 'done', states: ['done'], open: true },
  { key: 'closed', states: ['failed', 'cancelled', 'declined', 'superseded'], open: false },
];
const DONE_LIMIT = 10;
const sectionOf = (state: string): SectionKey => sections.find(section => section.states.includes(state))?.key ?? 'active';
const stateTone = (state: string) => sectionOf(state) === 'review' ? 'bg-need' : sectionOf(state) === 'active' ? 'bg-run' : sectionOf(state) === 'done' ? 'bg-ok' : 'bg-muted-foreground/50';

/** The group shown first: the newest task waiting for the operator, otherwise the newest group. */
export function defaultGroup(index: KnowledgeGroups | null): KnowledgeGroupKey | 'all' {
  const groups = index?.groups ?? [];
  return groups.find(group => group.task && sectionOf(group.task.state) === 'review')?.key ?? groups[0]?.key ?? 'all';
}
export function groupLabel(t: (key: string) => string, group: KnowledgeGroup): string {
  return group.task ? `${group.task.code} ${group.task.title}` : t(`knowledgeUi.groups.${group.key}`);
}
const count = (group: KnowledgeGroup) => group.documents + group.images;

function Entry({ selected, onSelect, icon, label, code, total, tone, title }: { selected: boolean; onSelect: () => void; icon?: ReactNode; label: string; code?: string; total: number; tone?: string; title?: string }) {
  return <li><button type="button" aria-current={selected ? 'true' : undefined} onClick={onSelect} title={title}
    className={cn('flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', selected && 'bg-secondary font-medium text-foreground')}>
    {icon ?? <span aria-hidden="true" className={cn('ml-1 size-1.5 shrink-0 rounded-full', tone)} />}
    {code && <span className="shrink-0 font-mono text-xs text-muted-foreground">{code}</span>}
    <span className="min-w-0 flex-1 truncate">{label}</span>
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{total}</span>
  </button></li>;
}

/** Task index for the documents page: one line per task, grouped by what the task needs from the operator. */
export function DocumentGroups({ index, selected, onSelect }: { index: KnowledgeGroups | null; selected: KnowledgeGroupKey | 'all'; onSelect: (key: KnowledgeGroupKey | 'all') => void }) {
  const t = useT(); const id = useId();
  const [filter, setFilter] = useState('');
  const [showAllDone, setShowAllDone] = useState(false);
  const groups = index?.groups ?? [];
  const pinned = (['uploads', 'plans', 'other'] as const).flatMap(key => groups.filter(group => group.key === key));
  const needle = filter.trim().toLocaleLowerCase();
  const tasks = groups.filter(group => group.task && (!needle || `${group.task.code} ${group.task.title}`.toLocaleLowerCase().includes(needle)));
  const pinnedIcon = (key: KnowledgeGroupKey) => key === 'uploads' ? <FileUp aria-hidden="true" className="size-4 text-muted-foreground" /> : key === 'plans' ? <ListChecks aria-hidden="true" className="size-4 text-muted-foreground" /> : <Bot aria-hidden="true" className="size-4 text-muted-foreground" />;
  return <nav aria-label={t('knowledgeUi.groupIndex')} className="space-y-3">
    <ul className="m-0 list-none space-y-0.5 p-0">
      <Entry selected={selected === 'all'} onSelect={() => onSelect('all')} icon={<Files aria-hidden="true" className="size-4 text-muted-foreground" />} label={t('knowledgeUi.groups.all')} total={index?.totals.all ?? 0} />
      {pinned.map(group => <Entry key={group.key} selected={selected === group.key} onSelect={() => onSelect(group.key)} icon={pinnedIcon(group.key)} label={t(`knowledgeUi.groups.${group.key}`)} total={count(group)} />)}
    </ul>
    {groups.some(group => group.task) && <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" /><Input id={`${id}-filter`} type="search" aria-label={t('knowledgeUi.findTask')} placeholder={t('knowledgeUi.findTask')} className="h-8 pl-8 text-sm" maxLength={100} value={filter} onChange={event => setFilter(event.target.value)} /></div>}
    {sections.map(section => {
      const items = tasks.filter(group => group.task && sectionOf(group.task.state) === section.key);
      if (!items.length) return null;
      const limited = section.key === 'done' && !showAllDone && !needle ? items.slice(0, DONE_LIMIT) : items;
      const hasSelection = items.some(group => group.key === selected);
      return <Collapsible key={section.key} defaultOpen={section.open || hasSelection || !!needle}>
        <CollapsibleTrigger className="group flex w-full items-center gap-1.5 border-0 bg-transparent px-1 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"><ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" />{t(`knowledgeUi.sections.${section.key}`)}<span className="ml-auto tabular-nums">{items.length}</span></CollapsibleTrigger>
        <CollapsibleContent><ul className="m-0 list-none space-y-0.5 p-0 pt-1">
          {limited.map(group => <Entry key={group.key} selected={selected === group.key} onSelect={() => onSelect(group.key)} code={group.task?.code ?? ''} label={group.task?.title ?? ''} title={group.task?.title ?? ""} total={count(group)} tone={stateTone(group.task?.state ?? '')} />)}
          {limited.length < items.length && <li><button type="button" className="border-0 bg-transparent px-2 py-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setShowAllDone(true)}>{t('knowledgeUi.showMoreTasks').replace('{count}', String(items.length - limited.length))}</button></li>}
        </ul></CollapsibleContent>
      </Collapsible>;
    })}
    {needle && !tasks.length && <p className="px-2 text-xs text-muted-foreground">{t('knowledgeUi.noTaskMatches')}</p>}
  </nav>;
}
