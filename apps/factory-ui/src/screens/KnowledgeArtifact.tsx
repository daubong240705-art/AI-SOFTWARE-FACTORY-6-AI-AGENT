import { useEffect, useId } from 'react';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';

export function KnowledgeArtifact({ store, artifactId, onClose }: { store: Store; artifactId: string; onClose: () => void }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const id = useId();
  useEffect(() => { void store.openKnowledgeArtifact(artifactId); return () => store.closeKnowledgeArtifact(artifactId); }, [store, artifactId]);
  if (state.session !== 'authenticated') return null;
  const artifact = state.knowledge.detail[artifactId];
  const area = `knowledge-detail:${artifactId}`;
  const latest = artifact?.versions[0];
  const number = (value: number) => new Intl.NumberFormat(i18n.locale).format(value);
  return <Dialog labelledBy={`${id}-title`} onClose={onClose} className="knowledge-detail-backdrop">
    <Button onClick={onClose}>{t('knowledgeUi.close')}</Button>
    <h2 id={`${id}-title`} className="plain-text">{artifact?.title ?? t('knowledgeUi.detail')}</h2>
    {state.knowledge.loading[area] && <p role="status">{t('viewStates.loading')}</p>}
    {state.knowledge.errors[area] && <><ErrorNotice error={state.knowledge.errors[area]} /><Button onClick={() => { void store.openKnowledgeArtifact(artifactId); }}>{t('errors.retry')}</Button></>}
    {artifact && <>
      <div className="task-meta"><Badge>{t(`knowledgeUi.kinds.${artifact.kind}`)}</Badge>{latest && <><Badge>{t(`knowledgeUi.statuses.${latest.status}`)}</Badge><Badge>{t(`knowledgeUi.visibility.${latest.visibility}`)}</Badge></>}</div>
      <h3>{t('knowledgeUi.versions')}</h3>
      <ul className="task-list stack">{artifact.versions.map(version => {
        const key = `${artifactId}:${version.version}`;
        const content = state.artifactContents[key];
        const error = state.errors[`content:${key}`];
        const read = () => { void store.loadArtifactContent('', artifactId, version.version); };
        return <li key={version.version} className="card stack">
          <div className="task-meta"><strong>{t('knowledgeUi.version')} {number(version.version)}</strong><Badge>{t(`knowledgeUi.statuses.${version.status}`)}</Badge><Badge>{t(`knowledgeUi.visibility.${version.visibility}`)}</Badge></div>
          <time dateTime={version.createdAt}>{new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(version.createdAt))}</time>
          <span>{number(version.sizeBytes)} {t('knowledgeUi.bytes')}</span>
          {version.supersedesVersion !== null && <span>{t('knowledgeUi.supersedes')} {t('knowledgeUi.version')} {number(version.supersedesVersion)}</span>}
          <h4>{t('knowledgeUi.l0')}</h4><p className="plain-text">{version.abstractL0}</p>
          {version.abstractL1 !== null && <><h4>{t('knowledgeUi.l1')}</h4><p className="plain-text">{version.abstractL1}</p></>}
          {/^text\/(plain|markdown|x-diff)(?:;|$)/i.test(version.mediaType) && <Button disabled={!!state.loading[`content:${key}`]} onClick={read}>{t('knowledgeUi.read')}</Button>}
          {state.loading[`content:${key}`] && <p role="status">{t('viewStates.loading')}</p>}
          {error && <><ErrorNotice error={error} /><Button onClick={read}>{t('errors.retry')}</Button></>}
          {content && <><pre className="plain-text artifact-text">{content.text.slice(0, 20000)}</pre>{content.text.length > 20000 && <p>{t('knowledgeUi.truncated').replace('{count}', number(20000))}</p>}</>}
        </li>;
      })}</ul>
      <section className="stack"><h3>{t('knowledgeUi.provenance')}</h3>{(['inputs', 'dependants'] as const).map(relation => <div key={relation}><h4>{t(`knowledgeUi.${relation}`)}</h4>{!artifact[relation].length && <p>{t('knowledgeUi.noRefs')}</p>}<ul>{artifact[relation].map(ref => <li key={`${ref.artifactId}:${ref.version}`} className="plain-text">{ref.title} · {t('knowledgeUi.version')} {number(ref.version)}</li>)}</ul></div>)}</section>
    </>}
  </Dialog>;
}
