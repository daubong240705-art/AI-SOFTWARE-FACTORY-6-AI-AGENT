import { useEffect, useState } from 'react';
import type { Task } from '@factory/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { Attempt, AttemptPatch } from '../api/client';
import { ErrorNotice } from '../components/ErrorNotice';
import { i18n, plural, useT } from '../i18n';
import { evidenceView } from '../state/attemptView';
import type { Store, TaskDetailState } from '../state/store';
import { DiffView } from './DiffView';
import { readableText } from './attention/presentation';
export function Results({ store, task, detail, attempt }: { store: Store; task: Task; detail: TaskDetailState; attempt: Attempt | undefined }) {
  const t = useT();
  const state = store.useStoreSelector(value => value);
  const [patchId, setPatchId] = useState<string | null>(null);
  const [textKey, setTextKey] = useState<string | null>(null);
  const selectedAttempt = detail.attempts.find(item => item.id === patchId) ?? attempt;
  const patchLoaded = selectedAttempt ? Object.hasOwn(detail.patches, selectedAttempt.id) : false;
  useEffect(() => { if (selectedAttempt && !patchLoaded) void store.loadPatch(task.id, selectedAttempt.id); }, [store, task.id, selectedAttempt?.id, patchLoaded]);
  const events = selectedAttempt ? detail.events[selectedAttempt.id] ?? [] : [];
  const evidence = evidenceView([...events].reverse().find(event => event.kind === 'evidence' && evidenceView(event.body).totals !== null)?.body);
  const patch = selectedAttempt ? detail.patches[selectedAttempt.id] : undefined;
  const patchError = selectedAttempt ? state.errors[`patch:${selectedAttempt.id}`] : undefined;
  const textError = textKey ? state.errors[`content:${textKey}`] : undefined;
  const number = (value: number) => new Intl.NumberFormat(i18n.locale).format(value);
  return <>
    {!detail.artifacts.length && <p className="text-sm text-muted-foreground">{readableText(t('workUi.noResults'))}</p>}
    <ul className="m-0 list-none space-y-4 p-0">{detail.artifacts.map(artifact => <li key={artifact.artifactId}><Card className="gap-3 border-border p-5 shadow-none"><h3 className="text-sm font-semibold">{readableText(artifact.title)}</h3><ul className="space-y-4">{artifact.versions.map(version => <li key={version.version} className="space-y-3 text-sm">
      <Separator /><div className="flex flex-wrap items-center gap-2"><span>{t('workUi.version')} {number(version.version)}</span><Badge variant="secondary">{t(`workUi.statuses.${version.status}`)}</Badge></div><p className="whitespace-pre-wrap text-muted-foreground">{readableText(version.abstractL0)}</p>
      <time className="block text-xs text-muted-foreground" dateTime={version.createdAt}>{new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(version.createdAt))}</time>
      {artifact.kind === 'code-ref' ? <Button type="button" variant="outline" size="sm" disabled={!version.producedByAttemptId} onClick={() => { setPatchId(version.producedByAttemptId); }}>{t('workUi.viewPatch')}</Button>
        : /^text\/(plain|markdown)(?:;|$)/i.test(version.mediaType) && <Button type="button" variant="outline" size="sm" disabled={!!state.loading[`content:${artifact.artifactId}:${version.version}`]} onClick={() => { setTextKey(`${artifact.artifactId}:${version.version}`); void store.loadArtifactContent(task.id, artifact.artifactId, version.version); }}>{t('workUi.viewText')}</Button>}
    </li>)}</ul></Card></li>)}</ul>
    {textError && <ErrorNotice error={textError} />}
    {textKey && state.artifactContents[textKey] && <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs whitespace-pre-wrap break-words">{state.artifactContents[textKey].text}</pre>}
    {evidence.totals && <Card className="gap-3 border-border p-5 text-sm shadow-none"><h3 className="font-semibold">{t('workUi.evidence')}</h3><p className="text-muted-foreground">{(['files', 'additions', 'deletions'] as const).map(key => `${number(evidence.totals![key])} ${plural(t, i18n.locale, evidence.totals![key], `workUi.${key}`)}`).join(' · ')}</p><ul className="space-y-1 font-mono text-xs break-all">{evidence.files.map((file, index) => <li key={index}>{file.status} {file.path}</li>)}</ul></Card>}
    {patchError && <><ErrorNotice error={patchError} /><Button onClick={() => { if (selectedAttempt) void store.loadPatch(task.id, selectedAttempt.id); }}>{t('errors.retry')}</Button></>}
    {patch === null && <p>{t('workUi.noPatch')}</p>}
    {patch && selectedAttempt && <PatchResult key={`${selectedAttempt.id}:${patch.sha256}`} task={task} attempt={selectedAttempt} patch={patch} />}
  </>;
}
function PatchResult({ task, attempt, patch }: { task: Task; attempt: Attempt; patch: AttemptPatch }) {
  const t = useT();
  const [message, setMessage] = useState<'copied' | 'copyFailed' | 'downloadFailed' | null>(null);
  async function copy() {
    try { if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(patch.patch); setMessage('copied'); }
    catch { setMessage('copyFailed'); }
  }
  function download() {
    let url: string | undefined;
    const link = document.createElement('a');
    try {
      url = URL.createObjectURL(new Blob([patch.patch], { type: 'text/x-patch;charset=utf-8' }));
      link.href = url; link.download = `${task.code}-e${attempt.epoch}.patch`; document.body.append(link); link.click();
    } catch { setMessage('downloadFailed'); }
    finally { link.remove(); if (url) URL.revokeObjectURL(url); }
  }
  return <><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => { void copy(); }}>{t('workUi.copy')}</Button><Button type="button" variant="outline" size="sm" onClick={download}>{t('workUi.download')}</Button></div>
    {message && <p role="status">{t(`workUi.${message}`)}</p>}
    {message && message !== 'copied' && <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs whitespace-pre-wrap break-words">{patch.patch}</pre>}
    <DiffView patch={patch.patch} />
  </>;
}

