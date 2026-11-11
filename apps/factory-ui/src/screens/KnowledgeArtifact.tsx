import { useEffect, useId } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorNotice } from '../components/ErrorNotice';
import { i18n, useT } from '../i18n';
import type { Store } from '../state/store';
import { relativeTime } from './Inbox';
import { KnowledgeKindIcon, KnowledgeStatus, KnowledgeText, KnowledgeTitle } from './KnowledgePresentation';

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
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }}><SheetContent side="right" showCloseButton={false} aria-labelledby={`${id}-title`} aria-describedby={undefined} className="w-full gap-0 overflow-y-auto border-border bg-card sm:max-w-2xl">
    <SheetHeader className="sticky top-0 z-10 flex-row items-start justify-between gap-4 border-b border-border bg-card p-5"><div className="min-w-0 space-y-3"><SheetTitle id={`${id}-title`} className="font-display text-2xl leading-tight [overflow-wrap:anywhere]"><KnowledgeTitle title={artifact?.title ?? t('knowledgeUi.detail')} /></SheetTitle>{artifact && <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary"><KnowledgeKindIcon kind={artifact.kind} />{t(`knowledgeUi.kinds.${artifact.kind}`)}</Badge>{latest && <><KnowledgeStatus status={latest.status} /><Badge variant="outline">{t(`knowledgeUi.visibility.${latest.visibility}`)}</Badge></>}</div>}</div><Button variant="ghost" size="icon" onClick={onClose} aria-label={t('knowledgeUi.close')}><X className="size-4" /></Button></SheetHeader>
    <div className="mx-auto w-full max-w-2xl space-y-6 p-5">
      {state.knowledge.loading[area] && <div role="status" aria-label={t('viewStates.loading')} className="space-y-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-32" /></div>}
      {state.knowledge.errors[area] && <div className="space-y-3"><ErrorNotice error={state.knowledge.errors[area]} /><Button variant="outline" onClick={() => { void store.openKnowledgeArtifact(artifactId); }}>{t('errors.retry')}</Button></div>}
      {artifact && <>
        <h3 className="font-display text-lg font-semibold">{t('knowledgeUi.versions')}</h3>
        <ul className="m-0 list-none space-y-5 p-0">{artifact.versions.map(version => {
          const key = `${artifactId}:${version.version}`;
          const content = state.artifactContents[key];
          const error = state.errors[`content:${key}`];
          const read = () => { void store.loadArtifactContent('', artifactId, version.version); };
          return <li key={version.version}><Card className="gap-4 rounded-xl border-border p-5 shadow-none">
            <div className="flex flex-wrap items-center gap-2"><strong className="font-mono text-sm">{t('knowledgeUi.version')} {number(version.version)}</strong><KnowledgeStatus status={version.status} /><Badge variant="outline">{t(`knowledgeUi.visibility.${version.visibility}`)}</Badge></div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><time dateTime={version.createdAt} title={new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(version.createdAt))}>{relativeTime(version.createdAt)}</time><span>{number(version.sizeBytes)} {t('knowledgeUi.bytes')}</span>{version.supersedesVersion !== null && <span>{t('knowledgeUi.supersedes')} {t('knowledgeUi.version')} {number(version.supersedesVersion)}</span>}</div>
            <section className="space-y-2"><h4 className="text-xs font-medium text-muted-foreground">{t('knowledgeUi.l0')}</h4><KnowledgeText text={version.abstractL0} /></section>
            {version.abstractL1 !== null && <section className="space-y-2"><h4 className="text-xs font-medium text-muted-foreground">{t('knowledgeUi.l1')}</h4><KnowledgeText text={version.abstractL1} /></section>}
            {/^text\/(plain|markdown|x-diff)(?:;|$)/i.test(version.mediaType) && <Button variant="outline" className="self-start" disabled={!!state.loading[`content:${key}`]} onClick={read}>{t('knowledgeUi.read')}</Button>}
            {state.loading[`content:${key}`] && <Skeleton role="status" aria-label={t('viewStates.loading')} className="h-24" />}
            {error && <div className="space-y-3"><ErrorNotice error={error} /><Button variant="outline" onClick={read}>{t('errors.retry')}</Button></div>}
            {content && <><KnowledgeText text={content.text.slice(0, 20000)} code={/^text\/x-diff(?:;|$)/i.test(version.mediaType)} />{content.text.length > 20000 && <p className="text-xs text-muted-foreground">{t('knowledgeUi.truncated').replace('{count}', number(20000))}</p>}</>}
          </Card></li>;
        })}</ul>
        <section className="space-y-4 border-t border-border pt-5"><h3 className="font-display text-lg font-semibold">{t('knowledgeUi.provenance')}</h3>{(['inputs', 'dependants'] as const).map(relation => <div key={relation} className="space-y-2"><h4 className="text-sm font-medium">{t(`knowledgeUi.${relation}`)}</h4>{!artifact[relation].length && <p className="text-sm text-muted-foreground">{t('knowledgeUi.noRefs')}</p>}<ul className="space-y-2 text-sm text-muted-foreground">{artifact[relation].map(ref => <li key={`${ref.artifactId}:${ref.version}`} className="[overflow-wrap:anywhere]"><KnowledgeTitle title={ref.title} /> · <span className="font-mono">{t('knowledgeUi.version')} {number(ref.version)}</span></li>)}</ul></div>)}</section>
      </>}
    </div>
  </SheetContent></Sheet>;
}
