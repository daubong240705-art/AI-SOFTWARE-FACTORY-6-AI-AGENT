import { useEffect, useState } from 'react';
import { artifactsTransition, dossierRefresh } from '../api/commands';
import { changeKeys } from '../api/m3Models';
import type { Store } from '../state/store';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { useT } from '../i18n';
import { AreaState, useM3Command } from './M3Shared';

export function DossierPanel({ store }: { store: Store }) {
  const t = useT(); const state = store.useStoreSelector(s => s); const { dossier, briefing } = state.m3; const [comment, setComment] = useState(''); const [since, setSince] = useState(''); const [baseline, setBaseline] = useState<string | undefined>();
  useEffect(() => store.watchM3('dossier', store.loadDossier), [store]);
  useEffect(() => store.watchM3('briefing', () => store.loadBriefing(baseline)), [store, baseline]);
  const command = useM3Command(store, async () => { await Promise.all([store.loadDossier(),store.loadBriefing(baseline)]); });
  const projectId = state.selectedProjectId; const next = dossier?.status === 'draft' ? 'in-review' : dossier?.status === 'in-review' ? 'reviewed' : dossier?.status === 'reviewed' ? 'approved' : null;
  const validSince = !since || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(since) && Number.isFinite(Date.parse(since));
  return <section className="stack"><h2>{t('m3.dossier')}</h2><AreaState store={store} area="dossier" empty={!dossier} /><Button disabled={command.busy || !projectId} onClick={() => { if (projectId) void command.run(dossierRefresh({ projectId })); }}>{t('m3.refreshDossier')}</Button>
    {dossier && <Card><p>{t('workUi.version')} {dossier.ref.version} | {t(`m3.values.${dossier.status}`)} | <Badge>{t(`m3.${dossier.state}`)}</Badge></p><time>{dossier.createdAt}</time><pre className="plain-text artifact-text">{dossier.markdown}</pre>{next && <form onSubmit={e => { e.preventDefault(); if (projectId && !command.busy) void command.run(artifactsTransition({ projectId, ...dossier.ref, to: next, comment })); }}><Field label={t('m3.comment')} maxLength={4000} value={comment} disabled={command.busy} onChange={e => setComment(e.target.value)} /><Button type="submit" disabled={command.busy}>{t(`m3.values.${next}`)}</Button></form>}</Card>}{command.notice}
    <h2>{t('m3.briefing')}</h2><form onSubmit={e => { e.preventDefault(); if (validSince) setBaseline(since ? new Date(since).toISOString() : undefined); }}><Field type="datetime-local" label={t('m3.since')} value={since} onChange={e => setSince(e.target.value)} error={validSince ? undefined : t('m3.invalidDate')} /><Button type="submit" disabled={!validSince}>{t('m3.apply')}</Button></form><AreaState store={store} area="briefing" />
    {briefing && <><p>{t('m3.baseline')}: {briefing.baseline.since}{briefing.baseline.dossierRef && <> | {t('workUi.version')} {briefing.baseline.dossierRef.version}</>}</p><div className="stack">{changeKeys.map(key => <Card key={key}><h3>{t(`m3.changes.${key}`)}: {briefing.changes[key].count}</h3><ul>{briefing.changes[key].examples.map((line,i) => <li key={i}>{line}</li>)}</ul></Card>)}</div><h3>{t('m3.freshness')}</h3><p>{t('m3.unapprovedDossier')}: {t(briefing.freshness.unapprovedDossier ? 'm3.yes' : 'm3.no')}</p><h4>{t('m3.stale')}</h4><ul>{briefing.freshness.stale.map((v,i) => <li key={i}>{v.title} | {v.ref.version} | {v.because}</li>)}</ul><h4>{t('m3.awaitingReview')}</h4><ul>{briefing.freshness.awaitingReview.map((v,i) => <li key={i}>{v.title} | {v.ref.version} | {v.ageDays} {t('m3.days')}</li>)}</ul><h3>{t('m3.teams')}</h3><ul>{briefing.teams.map((v,i) => <li key={i}>{v.teamName} | {v.packKey} {v.packVersion} | {t(`m3.values.${v.engagementState}`)}</li>)}</ul>{(['suggestions','limits'] as const).map(key => <section key={key}><h3>{t(`m3.${key}`)}</h3><ul>{briefing[key].map((line,i) => <li key={i}>{line}</li>)}</ul></section>)}</>}
  </section>;
}
