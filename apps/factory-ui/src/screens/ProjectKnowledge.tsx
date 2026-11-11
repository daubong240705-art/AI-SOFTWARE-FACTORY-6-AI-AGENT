import { useEffect, useId, useState } from 'react';
import { knowledgeKinds, knowledgeStatuses, type KnowledgeFilters } from '../api/readModels';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorNotice } from '../components/ErrorNotice';
import { Field } from '../components/Field';
import { i18n, plural, useT } from '../i18n';
import type { Store } from '../state/store';
import { KnowledgeArtifact } from './KnowledgeArtifact';
import { Select } from '../components/Select';

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
  useEffect(() => {
    store.openKnowledgeList();
    return () => store.closeKnowledgeList();
  }, [store, projectId]);
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
  return <div className="knowledge stack">
    <form role="search" aria-label={t('knowledgeUi.search')} className="knowledge-filters" onSubmit={event => event.preventDefault()}>
      <Field type="search" label={t('knowledgeUi.search')} maxLength={200} value={query} onChange={event => { store.cancelKnowledgeSearch(); setQuery(event.target.value); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setQuery(''); } }} />
      <div className="field"><label htmlFor={`${id}-kind`}>{t('knowledgeUi.kind')}</label><Select id={`${id}-kind`} value={kind} onValueChange={next => setKind(next as typeof kind)} options={[{ value: '', label: t('knowledgeUi.allKinds') }, ...knowledgeKinds.map(value => ({ value, label: t(`knowledgeUi.kinds.${value}`) }))]} /></div>
      <div className="field"><label htmlFor={`${id}-status`}>{t('knowledgeUi.status')}</label><Select id={`${id}-status`} value={status} onValueChange={next => setStatus(next as typeof status)} options={[{ value: '', label: t('knowledgeUi.allStatuses') }, ...knowledgeStatuses.map(value => ({ value, label: t(`knowledgeUi.statuses.${value}`) }))]} /></div>
    </form>
    <h2>{t(searching ? 'knowledgeUi.results' : 'knowledgeUi.allDocuments')}</h2>
    <p role="status">{number(rows.length)} {plural(t, i18n.locale, rows.length, 'knowledgeUi.count')}</p>
    {loading && <p role="status">{t('viewStates.loading')}</p>}
    {knowledge.errors.knowledge && <><ErrorNotice error={knowledge.errors.knowledge} /><Button onClick={() => { void store.searchKnowledge(query, filters()); }}>{t('errors.retry')}</Button></>}
    {!loading && !knowledge.errors.knowledge && !rows.length && <Card><p>{t(searching ? 'knowledgeUi.noMatches' : 'knowledgeUi.empty')}</p></Card>}
    <ul className="task-list stack">{rows.map(row => <li key={row.artifactId}><button type="button" className="knowledge-row card stack" onClick={() => setSelected(row.artifactId)}>
      <strong className="plain-text">{row.title}</strong>
      <span className="task-meta"><Badge>{t(`knowledgeUi.kinds.${row.kind}`)}</Badge><Badge>{t(`knowledgeUi.statuses.${row.status}`)}</Badge><Badge>{t(`knowledgeUi.visibility.${row.visibility}`)}</Badge><span>{t('knowledgeUi.version')} {number(row.version)}</span>{'versionCount' in row && <span>{number(row.versionCount)} {plural(t, i18n.locale, row.versionCount, 'knowledgeUi.versionCount')}</span>}</span>
      <span className="plain-text">{row.abstractL0}</span>{'snippet' in row && row.snippet.trim() && row.snippet.trim() !== row.abstractL0.trim() && <span className="plain-text muted">{row.snippet}</span>}
    </button></li>)}</ul>
    {knowledge.hasMore && <Button disabled={!!loading} onClick={() => { void store.loadKnowledgeMore(); }}>{t('knowledgeUi.more')}</Button>}
    {selected && <KnowledgeArtifact key={selected} store={store} artifactId={selected} onClose={() => setSelected(null)} />}
  </div>;
}
