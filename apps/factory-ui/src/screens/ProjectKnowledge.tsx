import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ChevronDown, Upload } from 'lucide-react';
import type { KnowledgeFilters } from '@/api/readModels';
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
import { MascotEmpty } from '@/components/mascot';

export function ProjectKnowledge({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const knowledge = state.knowledge;
  const [query, setQuery] = useState(knowledge.query);
  const [filters, setFilters] = useState<KnowledgeFilters>(knowledge.filters);
  const [selected, setSelected] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ file: File | null } | null>(null);
  const [dragging, setDragging] = useState(false); const dragDepth = useRef(0);
  useEffect(() => { store.openKnowledgeList(); return () => store.closeKnowledgeList(); }, [store, projectId]);
  useEffect(() => {
    if (state.session !== 'authenticated') return;
    store.cancelKnowledgeSearch();
    const run = () => { void store.searchKnowledge(query, filters); };
    if (!query.trim()) { run(); return; }
    const handle = store.knowledgeTimer.setTimeout(run, 300);
    return () => store.knowledgeTimer.clearTimeout(handle);
  }, [store, projectId, query, filters, state.session]);
  useEffect(() => {
    const clear = () => { dragDepth.current = 0; setDragging(false); };
    window.addEventListener('dragend', clear); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('dragend', clear); window.removeEventListener('blur', clear); };
  }, []);
  if (state.session !== 'authenticated') return null;
  const searching = !!query.trim();
  const rows = searching ? knowledge.results : knowledge.list;
  const loading = knowledge.loading.knowledge || query.trim() !== knowledge.query;
  const number = (value: number) => new Intl.NumberFormat(i18n.locale).format(value);
  const openUpload = (file: File | null = null) => { store.resetDocumentUpload(); setUpload({ file }); };
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  return <Page className="relative min-h-full space-y-6 px-6 2xl:px-6"
    onDragEnter={event => { if (hasFiles(event)) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragOver={event => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDragLeave={event => { if (hasFiles(event) && --dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
    onDrop={event => { if (!hasFiles(event)) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); const file = event.dataTransfer.files[0]; if (file) openUpload(file); }}>
    <header className="flex items-center justify-between gap-4"><h2 className="font-display text-3xl font-semibold tracking-tight">{t('projectUi.knowledge')}</h2><Button onClick={() => openUpload()}><Upload className="size-4" />{t('knowledgeUi.upload')}</Button></header>
    <DocumentToolbar query={query} filters={filters} onQuery={value => { store.cancelKnowledgeSearch(); setQuery(value); }} onFilters={value => { store.cancelKnowledgeSearch(); setFilters(value); }} onClear={() => { store.cancelKnowledgeSearch(); setQuery(''); setFilters({}); }} />
    <Collapsible asChild><section aria-label={t('knowledgeUi.pinned')}><CollapsibleTrigger className="group flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"><ChevronDown aria-hidden="true" className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />{t('knowledgeUi.pinned')}</CollapsibleTrigger><CollapsibleContent className="pt-3"><DossierPanel store={store} /></CollapsibleContent></section></Collapsible>
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-display text-xl font-semibold">{t(searching ? 'knowledgeUi.results' : 'knowledgeUi.allDocuments')}</h3><p role="status" className="text-xs text-muted-foreground">{number(rows.length)} {plural(t, i18n.locale, rows.length, 'knowledgeUi.count')}</p></div>
    {loading && <div role="status" aria-label={t('viewStates.loading')} className="space-y-3">{[0, 1, 2].map(key => <Skeleton key={key} className="h-24 rounded-xl" />)}</div>}
    {knowledge.errors.knowledge && <div className="space-y-3"><ErrorNotice error={knowledge.errors.knowledge} /><Button variant="outline" onClick={() => { void store.searchKnowledge(query, filters); }}>{t('errors.retry')}</Button></div>}
    {!loading && !knowledge.errors.knowledge && !rows.length && <Card className="rounded-xl border-border py-0 shadow-none"><Empty><MascotEmpty seat="BA" state={searching ? 'thinking' : 'idle'} compact={searching} fallback={<EmptyHeader><EmptyDescription>{t(searching ? 'knowledgeUi.noMatches' : 'knowledgeUi.empty')}</EmptyDescription></EmptyHeader>}><EmptyDescription>{t(searching ? 'knowledgeUi.noMatches' : 'knowledgeUi.empty')}</EmptyDescription>{!searching && <p className="text-sm text-muted-foreground">{t('knowledgeUi.drop')}</p>}</MascotEmpty></Empty></Card>}
    {!!rows.length && <DocumentList store={store} rows={rows} onSelect={setSelected} />}
    {knowledge.hasMore && <Button variant="outline" disabled={!!loading} onClick={() => { void store.loadKnowledgeMore(); }}>{t('knowledgeUi.more')}</Button>}
    {selected && <KnowledgeArtifact key={selected} store={store} artifactId={selected} onClose={() => setSelected(null)} />}
    {upload && <UploadDialog store={store} initialFile={upload.file} onClose={() => setUpload(null)} onUploaded={id => { setUpload(null); setSelected(id); }} />}
    {dragging && <div role="status" className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/95 p-6"><div className="flex flex-col items-center gap-4"><Upload aria-hidden="true" className="size-10 text-muted-foreground" /><p className="font-display text-2xl font-semibold">{t('knowledgeUi.drop')}</p></div></div>}
  </Page>;
}
