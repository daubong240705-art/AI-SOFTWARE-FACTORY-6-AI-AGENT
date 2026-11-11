import { useEffect, useId, useState } from 'react';
import { Search } from 'lucide-react';
import { knowledgeKinds, knowledgeStatuses, type KnowledgeFilters } from '../api/readModels';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorNotice } from '../components/ErrorNotice';
import { Select } from '../components/Select';
import { i18n, plural, useT } from '../i18n';
import type { Store } from '../state/store';
import { relativeTime } from './Inbox';
import { KnowledgeArtifact } from './KnowledgeArtifact';
import { KnowledgeKindIcon, KnowledgeStatus } from './KnowledgePresentation';

export function ProjectKnowledge({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const knowledge = state.knowledge;
  const [query, setQuery] = useState(knowledge.query);
  const [kind, setKind] = useState<NonNullable<KnowledgeFilters['kinds']>[number] | ''>(knowledge.filters.kinds?.[0] ?? '');
  const [status, setStatus] = useState<NonNullable<KnowledgeFilters['statuses']>[number] | ''>(knowledge.filters.statuses?.[0] ?? '');
  const [selected, setSelected] = useState<string | null>(null);
  const id = useId();
  const filters = (): KnowledgeFilters => ({ ...(kind ? { kinds: [kind] } : {}), ...(status ? { statuses: [status] } : {}) });
  useEffect(() => { store.openKnowledgeList(); return () => store.closeKnowledgeList(); }, [store, projectId]);
  useEffect(() => {
    if (state.session !== 'authenticated') return;
    store.cancelKnowledgeSearch();
    const run = () => { void store.searchKnowledge(query, { ...(kind ? { kinds: [kind] } : {}), ...(status ? { statuses: [status] } : {}) }); };
    if (!query.trim()) { run(); return; }
    const handle = store.knowledgeTimer.setTimeout(run, 300);
    return () => store.knowledgeTimer.clearTimeout(handle);
  }, [store, projectId, query, kind, status, state.session]);
  if (state.session !== 'authenticated') return null;
  const searching = !!query.trim();
  const rows = searching ? knowledge.results : knowledge.list;
  const loading = knowledge.loading.knowledge || query.trim() !== knowledge.query;
  const number = (value: number) => new Intl.NumberFormat(i18n.locale).format(value);
  return <div className="space-y-5">
    <Card className="rounded-xl border-border p-5 shadow-none"><form role="search" aria-label={t('knowledgeUi.search')} className="grid items-end gap-4 lg:grid-cols-[minmax(12rem,1fr)_12rem_12rem_auto]" onSubmit={event => event.preventDefault()}>
      <div className="space-y-2"><Label htmlFor={`${id}-search`}>{t('knowledgeUi.search')}</Label><div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input id={`${id}-search`} type="search" className="pl-9" maxLength={200} value={query} onChange={event => { store.cancelKnowledgeSearch(); setQuery(event.target.value); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setQuery(''); } }} /></div></div>
      <div className="space-y-2"><Label htmlFor={`${id}-kind`}>{t('knowledgeUi.kind')}</Label><Select id={`${id}-kind`} value={kind} onValueChange={next => setKind(next as typeof kind)} options={[{ value: '', label: t('knowledgeUi.allKinds') }, ...knowledgeKinds.map(value => ({ value, label: t(`knowledgeUi.kinds.${value}`) }))]} /></div>
      <div className="space-y-2"><Label htmlFor={`${id}-status`}>{t('knowledgeUi.status')}</Label><Select id={`${id}-status`} value={status} onValueChange={next => setStatus(next as typeof status)} options={[{ value: '', label: t('knowledgeUi.allStatuses') }, ...knowledgeStatuses.map(value => ({ value, label: t(`knowledgeUi.statuses.${value}`) }))]} /></div>
      <Button type="button" variant="ghost" disabled={!query && !kind && !status} onClick={() => { store.cancelKnowledgeSearch(); setQuery(''); setKind(''); setStatus(''); }}>{t('ux5.clearFilters')}</Button>
    </form></Card>
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-display text-xl font-semibold">{t(searching ? 'knowledgeUi.results' : 'knowledgeUi.allDocuments')}</h3><p role="status" className="text-xs text-muted-foreground">{number(rows.length)} {plural(t, i18n.locale, rows.length, 'knowledgeUi.count')}</p></div>
    {loading && <div role="status" aria-label={t('viewStates.loading')} className="space-y-3">{[0, 1, 2].map(key => <Skeleton key={key} className="h-24 rounded-xl" />)}</div>}
    {knowledge.errors.knowledge && <div className="space-y-3"><ErrorNotice error={knowledge.errors.knowledge} /><Button variant="outline" onClick={() => { void store.searchKnowledge(query, filters()); }}>{t('errors.retry')}</Button></div>}
    {!loading && !knowledge.errors.knowledge && !rows.length && <Card className="rounded-xl border-border py-0 shadow-none"><Empty><EmptyHeader><EmptyDescription>{t(searching ? 'knowledgeUi.noMatches' : 'knowledgeUi.empty')}</EmptyDescription></EmptyHeader></Empty></Card>}
    {!!rows.length && <Card className="gap-0 overflow-hidden rounded-xl border-border py-0 shadow-none"><ul className="m-0 list-none divide-y divide-border p-0">{rows.map(row => <li key={row.artifactId}><Item asChild className="w-full flex-nowrap items-start rounded-none text-left hover:bg-secondary"><button type="button" onClick={() => setSelected(row.artifactId)}><ItemMedia variant="icon" className="rounded-lg text-muted-foreground"><KnowledgeKindIcon kind={row.kind} /></ItemMedia><ItemContent className="min-w-0 gap-2"><ItemTitle className="w-full flex-wrap [overflow-wrap:anywhere]">{row.title}<KnowledgeStatus status={row.status} /></ItemTitle><ItemDescription className="line-clamp-1 text-left">{'snippet' in row && row.snippet.trim() ? row.snippet : row.abstractL0}</ItemDescription><span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{t(`knowledgeUi.kinds.${row.kind}`)}</span><span>{t(`knowledgeUi.visibility.${row.visibility}`)}</span><span>{t('knowledgeUi.version')} {number(row.version)}</span>{'versionCount' in row && <span>{number(row.versionCount)} {plural(t, i18n.locale, row.versionCount, 'knowledgeUi.versionCount')}</span>}{'createdAt' in row && <time dateTime={row.createdAt} className="sm:ml-auto">{relativeTime(row.createdAt)}</time>}</span></ItemContent></button></Item></li>)}</ul></Card>}
    {knowledge.hasMore && <Button variant="outline" disabled={!!loading} onClick={() => { void store.loadKnowledgeMore(); }}>{t('knowledgeUi.more')}</Button>}
    {selected && <KnowledgeArtifact key={selected} store={store} artifactId={selected} onClose={() => setSelected(null)} />}
  </div>;
}

