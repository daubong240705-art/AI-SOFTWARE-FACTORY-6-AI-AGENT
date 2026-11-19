import { useCallback, useMemo, useState } from 'react';
import type { AgentConfig, AgentDetail } from '@factory/contracts';
import type { ApiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { i18n } from '@/i18n';
import { Choice, Field, ReadStatus, useAgentLabels, useRead } from './shared';

function lineDiff(before: string, after: string) {
  const oldLines = before ? before.split('\n') : [];
  const newLines = after ? after.split('\n') : [];
  let start = 0, end = 0;
  const shared = Math.min(oldLines.length, newLines.length);
  while (start < shared && oldLines[start] === newLines[start]) start++;
  while (start + end < shared && oldLines[oldLines.length - 1 - end] === newLines[newLines.length - 1 - end]) end++;
  const oldMiddle = oldLines.slice(start, oldLines.length - end);
  const newMiddle = newLines.slice(start, newLines.length - end);
  const stride = newMiddle.length + 1;
  const result = oldLines.slice(Math.max(0, start - 3), start).map(line => `  ${line}`);
  if ((oldMiddle.length + 1) * stride <= 1_000_000) {
    const lcs = new Uint32Array((oldMiddle.length + 1) * stride);
    for (let row = oldMiddle.length - 1; row >= 0; row--) for (let col = newMiddle.length - 1; col >= 0; col--) {
      const offset = row * stride + col;
      lcs[offset] = oldMiddle[row] === newMiddle[col] ? 1 + lcs[offset + stride + 1]! : Math.max(lcs[offset + stride]!, lcs[offset + 1]!);
    }
    let row = 0, col = 0;
    while (row < oldMiddle.length || col < newMiddle.length) {
      const offset = row * stride + col;
      if (row < oldMiddle.length && col < newMiddle.length && oldMiddle[row] === newMiddle[col]) { result.push(`  ${oldMiddle[row]}`); row++; col++; }
      else if (row < oldMiddle.length && (col === newMiddle.length || lcs[offset + stride]! >= lcs[offset + 1]!)) result.push(`- ${oldMiddle[row++]}`);
      else result.push(`+ ${newMiddle[col++]}`);
    }
  } else {
    for (const line of oldMiddle) result.push(`- ${line}`);
    for (const line of newMiddle) result.push(`+ ${line}`);
  }
  if (end) for (const line of oldLines.slice(-end, oldLines.length - end + 3)) result.push(`  ${line}`);
  return result.join('\n');
}

function configDiff(before: AgentConfig, after: AgentConfig) {
  const entries = (value: AgentConfig) => {
    const { runtime, delegation, budget, instructions: _instructions, ...profile } = value;
    return { ...profile, ...runtime, ...delegation, perTaskTokens: budget.perTaskTokens, monthlyTokens: budget.monthlyTokens };
  };
  const previous = entries(before), current = entries(after);
  return (Object.keys(current) as Array<keyof typeof current>).flatMap(key => {
    const oldValue = JSON.stringify(previous[key], null, 2);
    const newValue = JSON.stringify(current[key], null, 2);
    return oldValue === newValue ? [] : [{ key, oldValue, newValue }];
  });
}

export function AgentHistory({ api, detail, busy, rollback }: { api: ApiClient; detail: AgentDetail; busy: boolean; rollback: (revision: number) => void }) {
  const t = useAgentLabels();
  const [revision, setRevision] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const read = useCallback((signal: AbortSignal) => api.getAgentRevision(detail.projectId, detail.id, revision!, signal), [api, detail.projectId, detail.id, revision]);
  const { data, loading, error } = useRead(revision === null ? null : read, retry);
  const diff = useMemo(() => data ? configDiff(data.config, detail.config) : [], [data, detail.config]);
  const instructions = useMemo(() => data && data.config.instructions !== detail.config.instructions ? lineDiff(data.config.instructions, detail.config.instructions) : null, [data, detail.config.instructions]);
  return <div className="space-y-4">
    <Field label={t('tabs.history')} hint={t('historyHelp')}>{props => <Choice {...props} value={revision ?? ''} onChange={event => setRevision(event.target.value ? Number(event.target.value) : null)}>
      <option value="">—</option>
      {[...detail.revisions].sort((left, right) => right.revision - left.revision).map(item => <option key={item.revision} value={item.revision}>
        r{item.revision} · {new Date(item.createdAt).toLocaleString(i18n.locale)}{item.revision === detail.configRevision ? ` · ${t('current')}` : ''}{item.note ? ` · ${item.note}` : ''}
      </option>)}
    </Choice>}</Field>
    <ReadStatus loading={loading} error={error} />
    {error && <Button type="button" variant="outline" onClick={() => setRetry(value => value + 1)}>{t('reload')}</Button>}
    {data && <div className="space-y-3">
      <p className="break-words text-sm text-muted-foreground">r{data.revision} · {data.actorId}{data.note && ` · ${data.note}`}</p>
      {!diff.length && instructions === null && <p className="text-sm text-muted-foreground">{t('noDiff')}</p>}
      {diff.map(({ key, oldValue, newValue }) => <section key={key} className="space-y-2 rounded-lg border border-border p-3">
        <h4 className="text-sm font-medium">{t(`fields.${key}`)}</h4>
        <div className="grid gap-2 sm:grid-cols-2">{([['before', oldValue], ['after', newValue]] as const).map(([side, value]) => <div key={side} className="min-w-0 rounded-md bg-muted/50 p-2">
          <p className="mb-1 text-xs text-muted-foreground">{t(side)}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{value ?? '—'}</pre>
        </div>)}</div>
      </section>)}
      {instructions !== null && <section className="space-y-2"><h4 className="text-sm font-medium">{t('fields.instructions')}</h4><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/50 p-3 text-xs">{instructions}</pre></section>}
      {data.revision !== detail.configRevision && <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={busy || loading || !!error} onClick={() => rollback(data.revision)}>{t('rollback')}</Button>
        <p className="text-xs text-muted-foreground">{t('rollbackHelp')}</p>
      </div>}
    </div>}
  </div>;
}
