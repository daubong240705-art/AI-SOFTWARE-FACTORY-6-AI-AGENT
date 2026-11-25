import { useCallback, useReducer, useState } from 'react';
import { idSchema, textSchema, flowNodeRunSchema, type FlowRunDetail, type FlowNodeRun } from '@factory/contracts';
import type { ApiClient } from '@/api/client';
import { integrationModels } from '@/api/integrationModels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { toast } from 'sonner';
import { FlowDialog, FlowError, useRead } from './shared';
import { useProjectIntegrations } from '../integrations/shared';
import type { ActionNode } from './nodeTypes';

const outputSchema = flowNodeRunSchema.pick({}).extend({
  state: integrationModels.effects.shape.effects.element.shape.state,
  commit: textSchema.regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i).nullable(),
  response: flowNodeRunSchema.shape.output,
  log: textSchema.min(0),
});

function httpAddress(value: string, base?: string) {
  if (/[\u0000-\u0020\\]/.test(value) || value.startsWith('//')) return undefined;
  try {
    const url = value.startsWith('/') ? new URL(value, base) : new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
  } catch { return undefined; }
  return undefined;
}

export function BundleRunResult({ api, projectId, runId, attempt, node, inputs, refresh }: {
  api: ApiClient; projectId: string; runId: string; attempt: FlowNodeRun; node: ActionNode; inputs: FlowRunDetail['inputs']; refresh: () => void;
}) {
  const t = useT();
  const [epoch, reload] = useReducer(value => value + 1, 0);
  const [resolution, setResolution] = useState<'done' | 'failed' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const output = outputSchema.safeParse(attempt.output);
  const unknown = output.data?.state === 'unknown';
  const response = output.data?.response;
  const record = response && typeof response === 'object' && !Array.isArray(response) ? response : null;
  const play = record && 'playPath' in record && typeof record.playPath === 'string' ? record.playPath : null;
  const integrationRef = node.params.integrationId;
  const input = typeof integrationRef === 'string' ? /^\s*\{\{\s*inputs\.([A-Za-z][A-Za-z0-9]*)\s*\}\}\s*$/.exec(integrationRef)?.[1] : undefined;
  const integrationId = input && Object.hasOwn(inputs, input) ? inputs[input] : integrationRef;
  const scope = useProjectIntegrations(api, play?.startsWith('/') ? projectId : undefined);
  const integration = scope.data?.find(item => item.id === integrationId);
  const readEffect = useCallback(async (signal: AbortSignal) => {
    const monitor = await api.getProjectMonitor(projectId, signal);
    let traceId = monitor.activeFlowRuns.find(run => run.id === runId)?.traceId;
    if (!traceId) {
      const { traces } = await api.listTraces(projectId, signal, 200);
      traceId = traces.find(span => span.kind === 'request' && span.title === 'flow-runs.start' && span.detail.targetId === runId)?.traceId;
    }
    if (!traceId) return null;
    const [{ spans }, { effects: records }] = await Promise.all([api.getTrace(projectId, traceId, signal), api.listHttpEffects(projectId, signal)]);
    const node = spans.find(span => span.kind === 'node-run' && span.ref === `${runId}:${attempt.nodeId}:${attempt.iteration}:${attempt.attemptNo}`);
    const effects = node ? spans.filter(span => span.parentId === node.id && span.kind === 'effect' && span.title === 'bundle.publish' && span.status === 'unknown') : [];
    const id = effects.length === 1 ? idSchema.safeParse(effects[0]?.ref).data : undefined;
    return id && records.some(record => record.id === id && record.state === 'unknown') ? id : null;
  }, [api, projectId, runId, attempt.nodeId, attempt.iteration, attempt.attemptNo]);
  const effect = useRead(unknown ? readEffect : null, epoch);
  async function reconcile() {
    if (!effect.data || effect.loading || !resolution || busy) return;
    setBusy(true); setError(null);
    try {
      await api.reconcileHttpEffect(projectId, effect.data, resolution);
      setResolution(null); toast.success(t('flowBundleUi.recorded')); refresh(); reload();
    } catch (failure) { setError(failure); refresh(); reload(); }
    finally { setBusy(false); }
  }
  if (!output.success) return <p className="text-xs text-muted-foreground">{attempt.output === null ? t('flowsUi.noOutput') : t('safeErrors.bad-response')}</p>;
  const { state, commit, log } = output.data;
  const version = record && 'version' in record && (typeof record.version === 'string' || typeof record.version === 'number') ? record.version : null;
  const address = play ? httpAddress(play, integration?.kind === 'http-api' ? integration.config.baseUrl : undefined) : undefined;
  return <section data-testid="flow-bundle-result" aria-label={t('flowBundleUi.result')} className="min-w-0 space-y-2">
    <Badge data-testid="flow-bundle-state" variant={state === 'failed' || unknown ? 'destructive' : 'outline'}>{t(`flowBundleUi.state.${state}`)}</Badge>
    {commit && <div className="flex flex-wrap items-center gap-2"><span>{t('flowBundleUi.commit')}: <code title={commit}>{commit.slice(0, 8)}</code></span>
      <Button type="button" size="sm" variant="outline" data-testid="flow-bundle-copy" onClick={async () => {
        try { await navigator.clipboard.writeText(commit); toast.success(t('flowBundleUi.copied')); } catch { toast.error(t('flowBundleUi.copyFailed')); }
      }}>{t('flowBundleUi.copy')}</Button></div>}
    {response !== null && <div className="space-y-1 break-words">
      {version !== null && <p>{t('flowBundleUi.version')}: {version}</p>}
      {play && <p>{t('flowBundleUi.play')}: {address ? <a data-testid="flow-bundle-play" href={address} target="_blank" rel="noopener noreferrer" className="text-primary underline">{play}</a> : play}</p>}
      <details><summary>{t('flowBundleUi.response')}</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{JSON.stringify(response, null, 2)}</pre></details>
    </div>}
    {log && <div><p>{t('flowBundleUi.log')}</p><pre data-testid="flow-bundle-log" tabIndex={0} className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs">{log}</pre></div>}
    {unknown && <div className="space-y-2">
      {effect.loading && <p role="status">{t('flowsUi.loading')}</p>}
      <FlowError error={effect.error} />
      {!effect.loading && (effect.error || !effect.data) && <p>{t('flowBundleUi.unavailable')} <Button type="button" variant="outline" size="sm" data-testid="flow-bundle-reload" onClick={reload}>{t('flowsUi.reload')}</Button></p>}
      <div className="flex flex-wrap gap-2">{(['done', 'failed'] as const).map(value => <Button key={value} type="button" variant="outline" size="sm" data-testid={`flow-bundle-reconcile-${value}`}
        disabled={!effect.data || effect.loading || !!effect.error || busy} onClick={() => { setError(null); setResolution(value); }}>{t(`flowBundleUi.${value}`)}</Button>)}</div>
    </div>}
    {unknown && resolution && <FlowDialog title={t('flowBundleUi.reconcile')} description={t('flowBundleUi.reconcileHelp')} close={() => setResolution(null)} busy={busy}
      disabled={!effect.data || effect.loading || !!effect.error} submit={t(`flowBundleUi.${resolution}`)} submitTestId="flow-bundle-confirm" onSubmit={() => void reconcile()}>
      <p>{t('flowBundleUi.outcome').replace('{state}', t(`flowBundleUi.${resolution}`))}</p><FlowError error={error} />
    </FlowDialog>}
  </section>;
}
