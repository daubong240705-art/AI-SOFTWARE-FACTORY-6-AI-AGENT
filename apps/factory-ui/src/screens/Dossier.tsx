import { useEffect, useId, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { artifactsTransition, dossierRefresh } from '../api/commands';
import { changeKeys } from '../api/m3Models';
import type { Store } from '../state/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorNotice } from '../components/ErrorNotice';
import { useT } from '../i18n';
import { useM3Command } from './M3Shared';
import { relativeTime } from './Inbox';
import { KnowledgeStatus, KnowledgeText } from './KnowledgePresentation';
import { KnowledgeArtifact } from './KnowledgeArtifact';

function DossierState({ store, area, empty = false, retry }: { store: Store; area: string; empty?: boolean; retry: () => void }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  return <div className="space-y-3 empty:hidden">
    {state.loading[area] && <Skeleton role="status" aria-label={t('viewStates.loading')} className="h-24" />}
    {state.errors[area] && <><ErrorNotice error={state.errors[area]!} /><Button variant="outline" size="sm" onClick={retry}>{t('errors.retry')}</Button></>}
    {empty && !state.loading[area] && !state.errors[area] && <Empty className="py-6"><EmptyHeader><EmptyDescription>{t('m3.empty')}</EmptyDescription></EmptyHeader></Empty>}
  </div>;
}

export function DossierPanel({ store }: { store: Store }) {
  const t = useT();
  const id = useId();
  const state = store.useStoreSelector(s => s);
  const { dossier, briefing } = state.m3;
  const [comment, setComment] = useState('');
  const [since, setSince] = useState('');
  const [baseline, setBaseline] = useState<string | undefined>();
  const [reviewing, setReviewing] = useState<{ artifactId: string; version: number } | null>(null);
  useEffect(() => store.watchM3('dossier', store.loadDossier), [store]);
  useEffect(() => store.watchM3('briefing', () => store.loadBriefing(baseline)), [store, baseline]);
  const command = useM3Command(store, async () => { await Promise.all([store.loadDossier(), store.loadBriefing(baseline)]); });
  const projectId = state.selectedProjectId;
  const next = dossier?.status === 'draft' ? 'in-review' : dossier?.status === 'in-review' ? 'reviewed' : dossier?.status === 'reviewed' ? 'approved' : null;
  const validSince = !since || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(since) && Number.isFinite(Date.parse(since));
  return <Card className="gap-0 rounded-xl border-border py-0 shadow-none" aria-label={t('m3.dossier')}>
    <section className="space-y-5 p-5"><header className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-xl font-semibold">{t('ux5.dossier')}</h2><Button variant="ghost" size="sm" disabled={command.busy || !projectId} onClick={() => { if (projectId) void command.run(dossierRefresh({ projectId })); }}><RefreshCw className="size-4" />{t('m3.refreshDossier')}</Button></header>
      <DossierState store={store} area="dossier" empty={!dossier} retry={() => { void store.loadDossier(); }} />
      {dossier && <><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="font-mono">{t('workUi.version')} {dossier.ref.version}</span><KnowledgeStatus status={dossier.status} /><Badge variant="secondary">{t(`m3.${dossier.state}`)}</Badge><time dateTime={dossier.createdAt} className="sm:ml-auto">{relativeTime(dossier.createdAt)}</time></div><KnowledgeText text={dossier.markdown} />
        {next && <form className="flex flex-wrap items-end gap-3 border-t border-border pt-5" onSubmit={event => { event.preventDefault(); if (projectId && !command.busy) void command.run(artifactsTransition({ projectId, ...dossier.ref, to: next, comment })); }}><Field className="min-w-40 flex-1 gap-2"><FieldLabel htmlFor={`${id}-comment`}>{t('m3.comment')}</FieldLabel><Input id={`${id}-comment`} maxLength={4000} value={comment} disabled={command.busy} onChange={event => setComment(event.target.value)} /></Field><Button type="submit" variant="outline" disabled={command.busy}>{t(`m3.values.${next}`)}</Button></form>}
      </>}{command.notice}
    </section>
    <Separator />
    <section className="space-y-5 p-5"><h2 className="font-display text-xl font-semibold">{t('ux5.briefing')}</h2>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (validSince) setBaseline(since ? new Date(since).toISOString() : undefined); }}><Field className="max-w-xs gap-2" data-invalid={!validSince || undefined}><FieldLabel htmlFor={`${id}-since`}>{t('m3.since')}</FieldLabel><Input id={`${id}-since`} type="datetime-local" value={since} onChange={event => setSince(event.target.value)} aria-invalid={!validSince || undefined} aria-describedby={!validSince ? `${id}-date-error` : undefined} />{!validSince && <FieldError id={`${id}-date-error`}>{t('m3.invalidDate')}</FieldError>}</Field><Button type="submit" variant="outline" disabled={!validSince}>{t('m3.apply')}</Button></form>
      <DossierState store={store} area="briefing" empty={!briefing} retry={() => { void store.loadBriefing(baseline); }} />
      {briefing && <>
        <p className="text-xs text-muted-foreground">{t('m3.baseline')}: <time dateTime={briefing.baseline.since}>{relativeTime(briefing.baseline.since)}</time>{briefing.baseline.dossierRef && <> · {t('workUi.version')} {briefing.baseline.dossierRef.version}</>}</p>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{changeKeys.map(key => <div key={key} className="space-y-2 border-t border-border pt-3"><h3 className="flex items-center justify-between gap-2 text-sm font-medium">{t(`m3.changes.${key}`)}<Badge variant="secondary">{briefing.changes[key].count}</Badge></h3><ul className="space-y-1 text-sm leading-relaxed text-muted-foreground">{briefing.changes[key].examples.map((line, index) => <li key={index} className="[overflow-wrap:anywhere]">{line}</li>)}</ul></div>)}</div>
        <Separator /><section className="space-y-3"><h3 className="font-medium">{t('m3.freshness')}</h3><p className="text-sm text-muted-foreground">{t('m3.unapprovedDossier')}: {t(briefing.freshness.unapprovedDossier ? 'm3.yes' : 'm3.no')}</p>
          <h4 className="text-sm font-medium">{t('m3.stale')}</h4><ul className="space-y-2 text-sm text-muted-foreground">{briefing.freshness.stale.map((value, index) => <li key={index} className="flex flex-wrap items-center justify-between gap-2 [overflow-wrap:anywhere]"><span className="min-w-0 flex-1">{value.title} · <span className="font-mono">{value.ref.version}</span> · {value.because}</span><Button type="button" variant="ghost" size="sm" aria-label={`${t('knowledgeWrite.reviewDocument')}: ${value.title}`} onClick={() => setReviewing(value.ref)}>{t('knowledgeWrite.reviewDocument')}</Button></li>)}</ul>
          <h4 className="text-sm font-medium">{t('m3.awaitingReview')}</h4><ul className="space-y-2 text-sm text-muted-foreground">{briefing.freshness.awaitingReview.map((value, index) => <li key={index} className="[overflow-wrap:anywhere]">{value.title} · <span className="font-mono">{value.ref.version}</span> · {value.ageDays} {t('m3.days')}</li>)}</ul>
        </section>
        <Separator /><section className="space-y-3"><h3 className="font-medium">{t('m3.teams')}</h3><ul className="space-y-2 text-sm">{briefing.teams.map((value, index) => <li key={index} className="flex flex-wrap items-center gap-2"><span>{value.teamName}</span><span className="text-xs text-muted-foreground">{value.packKey} {value.packVersion}</span><Badge variant="outline">{t(`m3.values.${value.engagementState}`)}</Badge></li>)}</ul></section>
        {(['suggestions', 'limits'] as const).map(key => <section key={key} className="space-y-2"><h3 className="text-sm font-medium">{t(`m3.${key}`)}</h3><ul className="list-inside list-disc space-y-1 text-sm leading-relaxed text-muted-foreground">{briefing[key].map((line, index) => <li key={index}>{line}</li>)}</ul></section>)}
      </>}
    </section>
    {reviewing && <KnowledgeArtifact key={`${reviewing.artifactId}:${reviewing.version}`} store={store} artifactId={reviewing.artifactId} initialVersion={reviewing.version} onClose={() => setReviewing(null)} />}
  </Card>;
}
