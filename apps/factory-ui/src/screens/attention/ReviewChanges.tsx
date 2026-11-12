import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Copy, Download } from 'lucide-react';
import type { Attempt } from '../../api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '../../i18n';
import type { Store } from '../../state/store';
import { parseDiff } from '../../state/diff';
import { DiffView } from '../DiffView';

export function ReviewChanges({ store, taskId, code, attempt }: { store: Store; taskId: string; code: string; attempt: Attempt }) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  const patch = state.details[taskId]?.patches[attempt.id];
  const loaded = Object.hasOwn(state.details[taskId]?.patches ?? {}, attempt.id);
  const error = state.errors[`patch:${attempt.id}`];
  const [message, setMessage] = useState<'copied' | 'copyFailed' | 'downloadFailed' | null>(null);
  useEffect(() => { if (!loaded) void store.loadPatch(taskId, attempt.id); }, [store, taskId, attempt.id, loaded]);
  const files = useMemo(() => parseDiff(patch?.patch ?? '').files, [patch]);
  async function copy() {
    try { if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(patch?.patch ?? ''); setMessage('copied'); }
    catch { setMessage('copyFailed'); }
  }
  function download() {
    let url: string | undefined; const link = document.createElement('a');
    try { url = URL.createObjectURL(new Blob([patch?.patch ?? ''], { type: 'text/x-patch;charset=utf-8' })); link.href = url; link.download = `${code}-e${attempt.epoch}.patch`; document.body.append(link); link.click(); }
    catch { setMessage('downloadFailed'); }
    finally { link.remove(); if (url) URL.revokeObjectURL(url); }
  }
  if (error) return <Alert className="border-border"><AlertCircle /><AlertTitle>{t('errors.title')}</AlertTitle><AlertDescription><p>{t(`safeErrors.${error.code}`)}</p><Button variant="outline" size="sm" onClick={() => { void store.loadPatch(taskId, attempt.id); }}>{t('errors.retry')}</Button></AlertDescription></Alert>;
  if (!loaded || state.loading[`patch:${attempt.id}`]) return <div role="status" className="space-y-3"><span className="sr-only">{t('viewStates.loading')}</span><Skeleton className="h-7 w-1/2" /><Skeleton className="h-72 w-full" /></div>;
  if (!patch?.patch.trim()) return <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">{t('reviewUi.noChanges')}</p>;
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap gap-2">{files.map((file, index) => <Badge key={index} variant="outline" className="max-w-full gap-2 rounded-full px-3 py-1 font-mono text-xs font-normal"><span className="truncate">{file.name.replace(/^a\/(.*?) b\/(.*)$/, '$2') || t('workUi.unnamed')}</span><span className="text-ok">+{file.lines.filter(line => line.kind === 'added').length}</span></Badge>)}</div>
    <DiffView key={patch.sha256} patch={patch.patch} />
    <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => { void copy(); }}><Copy />{t('workUi.copy')}</Button><Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={download}><Download />{t('workUi.download')}</Button></div>
    {message && <p role="status" className="text-xs text-muted-foreground">{t(`workUi.${message}`)}</p>}
    {message && message !== 'copied' && <pre className="max-h-64 overflow-auto rounded-lg border border-border p-3 font-mono text-xs">{patch.patch}</pre>}
  </div>;
}
