import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ChevronDown, Upload } from 'lucide-react';
import type { KnowledgeFilters, KnowledgeGroupKey } from '@/api/readModels';
import { Badge } from '@/components/ui/badge';
import { Page } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorNotice } from '@/components/ErrorNotice';
import { i18n, plural, useT } from '@/i18n';
import type { Store } from '@/state/store';
import { KnowledgeArtifact } from './KnowledgeArtifact';
import { DossierPanel } from './Dossier';
import { DocumentToolbar } from './documents/DocumentToolbar';
import { UploadDialog } from './documents/UploadDialog';
import { DocumentList } from './documents/DocumentList';
import { DocumentGroups, defaultGroup, groupLabel } from './documents/DocumentGroups';
import { MascotEmpty } from '@/components/mascot';

export function ProjectKnowledge({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const knowledge = state.knowledge;
  const [query, setQuery] = useState(knowledge.query);
  const [filters, setFilters] = useState<KnowledgeFilters>(() => { const { group: _group, ...rest } = knowledge.filters; return rest; });
  // The selected group is remembered per project for this browser tab; 'all' is a real choice too.
  const groupKey = `factory.documents.group.${projectId}`;
  const [group, setGroup] = useState<KnowledgeGroupKey | 'all' | null>(() => { try { return (sessionStorage.getItem(groupKey) as KnowledgeGroupKey | 'all' | null) ?? null; } catch { return null; } });
  const chooseGroup = (value: KnowledgeGroupKey | 'all') => { store.cancelKnowledgeSearch(); setGroup(value); try { sessionStorage.setItem(groupKey, value); } catch { /* storage may be unavailable */ } };
  const [detailed, setDetailedState] = useState(() => { try { return localStorage.getItem('factory.documents.detailed') === '1'; } catch { return false; } });
  const setDetailed = (value: boolean) => { setDetailedState(value); try { localStorage.setItem('factory.documents.detailed', value ? '1' : '0'); } catch { /* storage may be unavailable */ } };
  const [selected, setSelected] = useState<string | null>(null);
  // The element that opened the document gets focus back when the sheet closes.
  const opener = useRef<HTMLElement | null>(null);
  const select = (artifactId: string) => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSelected(artifactId); };
  const [upload, setUpload] = useState<{ file: File | null } | null>(null);
  const [dragging, setDragging] = useState(false); const dragDepth = useRef(0);
  useEffect(() => { store.openKnowledgeList(); return () => store.closeKnowledgeList(); }, [store, projectId]);
  const index = knowledge.groups;
  // Pick a default group once the index arrives, and leave a group that no longer has documents.
  useEffect(() => {
    if (!index) return;
    if (group === null || (group !== 'all' && !index.groups.some(item => item.key === group))) setGroup(defaultGroup(index));
  }, [index, group]);
  const searching = !!query.trim();
  const activeGroup = searching || group === null || group === 'all' ? undefined : group;
  const effective: KnowledgeFilters = { ...filters, ...(activeGroup ? { group: activeGroup } : {}) };
  const effectiveKey = JSON.stringify(effective);
  useEffect(() => {
    if (state.session !== 'authenticated') return;
    store.cancelKnowledgeSearch();
    const run = () => { void store.searchKnowledge(query, effective); };
    if (!query.trim()) { run(); return; }
    const handle = store.knowledgeTimer.setTimeout(run, 300);
    return () => store.knowledgeTimer.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effectiveKey captures the filters.
  }, [store, projectId, query, effectiveKey, state.session]);
  useEffect(() => {
    const clear = () => { dragDepth.current = 0; setDragging(false); };
    window.addEventListener('dragend', clear); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('dragend', clear); window.removeEventListener('blur', clear); };
  }, []);
  if (state.session !== 'authenticated') return null;
  const rows = searching ? knowledge.results : knowledge.list;
  const loading = knowledge.loading.knowledge || query.trim() !== knowledge.query || JSON.stringify(knowledge.filters.group ?? null) !== JSON.stringify(activeGroup ?? null);
  const selectedGroup = activeGroup ? index?.groups.find(item => item.key === activeGroup) : undefined;
  const heading = searching ? t('knowledgeUi.results') : selectedGroup ? groupLabel(t, selectedGroup) : t('knowledgeUi.allDocuments');
  const number = (value: number) => new Intl.NumberFormat(i18n.locale).format(value);
  const openUpload = (file: File | null = null) => { store.resetDocumentUpload(); setUpload({ file }); };
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  return <Page className="relative min-h-full space-y-6 px-6 2xl:px-6"
    onDragEnter={event => { if (hasFiles(event)) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragOver={event => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDragLeave={event => { if (hasFiles(event) && --dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
    onDrop={event => { if (!hasFiles(event)) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); const file = event.dataTransfer.files[0]; if (file) openUpload(file); }}>
    <header className="flex items-center justify-between gap-4"><h2 className="font-display text-3xl font-semibold tracking-tight">{t('projectUi.knowledge')}</h2><Button onClick={() => openUpload()}><Upload className="size-4" />{t('knowledgeUi.upload')}</Button></header>
    <Collapsible asChild><section aria-label={t('knowledgeUi.pinned')}><CollapsibleTrigger className="group flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"><ChevronDown aria-hidden="true" className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />{t('knowledgeUi.pinned')}</CollapsibleTrigger><CollapsibleContent className="pt-3"><DossierPanel store={store} /></CollapsibleContent></section></Collapsible>
    <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className={`max-h-72 overflow-y-auto rounded-xl border border-border p-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-10rem)] ${searching ? 'opacity-60' : ''}`}>
        <DocumentGroups index={index} selected={searching ? 'all' : group ?? 'all'} onSelect={value => { if (searching) { store.cancelKnowledgeSearch(); setQuery(''); } chooseGroup(value); }} />
      </aside>
      <section aria-label={heading} className="min-w-0 space-y-4">
        <DocumentToolbar query={query} filters={filters} totals={selectedGroup ? { all: selectedGroup.documents + selectedGroup.images, images: selectedGroup.images, documents: selectedGroup.documents } : index?.totals ?? null} detailed={detailed} onDetailed={setDetailed} onQuery={value => { store.cancelKnowledgeSearch(); setQuery(value); }} onFilters={value => { store.cancelKnowledgeSearch(); setFilters(value); }} onClear={() => { store.cancelKnowledgeSearch(); setQuery(''); setFilters({}); }} />
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="flex min-w-0 items-center gap-2 font-display text-xl font-semibold"><span className="truncate">{heading}</span>{selectedGroup?.task && <Badge variant="outline" className="shrink-0 font-sans text-xs font-normal">{t(`taskUi.lifecycle.${selectedGroup.task.state}`)}</Badge>}</h3><p role="status" className="text-xs text-muted-foreground">{number(rows.length)} {plural(t, i18n.locale, rows.length, 'knowledgeUi.count')}</p></div>
        {loading && <div role="status" aria-label={t('viewStates.loading')} className="space-y-3">{[0, 1, 2].map(key => <Skeleton key={key} className="h-12 rounded-xl" />)}</div>}
        {knowledge.errors.knowledge && <div className="space-y-3"><ErrorNotice error={knowledge.errors.knowledge} /><Button variant="outline" onClick={() => { void store.searchKnowledge(query, effective); }}>{t('errors.retry')}</Button></div>}
        {!loading && !knowledge.errors.knowledge && !rows.length && <Card className="rounded-xl border-border py-0 shadow-none"><Empty><MascotEmpty seat="BA" state={searching ? 'thinking' : 'idle'} compact={searching} fallback={<EmptyHeader><EmptyDescription>{t(searching ? 'knowledgeUi.noMatches' : 'knowledgeUi.empty')}</EmptyDescription></EmptyHeader>}><EmptyDescription>{t(searching ? 'knowledgeUi.noMatches' : 'knowledgeUi.empty')}</EmptyDescription>{!searching && <p className="text-sm text-muted-foreground">{t('knowledgeUi.drop')}</p>}</MascotEmpty></Empty></Card>}
        {!loading && !!rows.length && <DocumentList store={store} rows={rows} onSelect={select} showTask={searching || !activeGroup} detailed={detailed} />}
        {knowledge.hasMore && <Button variant="outline" disabled={!!loading} onClick={() => { void store.loadKnowledgeMore(); }}>{t('knowledgeUi.more')}</Button>}
      </section>
    </div>
    {selected && <KnowledgeArtifact key={selected} store={store} artifactId={selected} returnFocus={opener.current} onClose={() => setSelected(null)} />}
    {upload && <UploadDialog store={store} initialFile={upload.file} onClose={() => setUpload(null)} onUploaded={id => { setUpload(null); setSelected(id); }} />}
    {dragging && <div role="status" className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/95 p-6"><div className="flex flex-col items-center gap-4"><Upload aria-hidden="true" className="size-10 text-muted-foreground" /><p className="font-display text-2xl font-semibold">{t('knowledgeUi.drop')}</p></div></div>}
  </Page>;
}
