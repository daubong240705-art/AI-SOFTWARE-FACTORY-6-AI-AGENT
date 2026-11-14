import { useCallback, useId } from 'react';
import type { GameReport } from '@factory/contracts';
import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { i18n, useT } from '@/i18n';
import type { Store } from '@/state/store';
import { stageName } from './presentation';
import { useStudioRead } from './useStudioRead';

const tokenKeys = ['input', 'cachedInput', 'output', 'reasoning'] as const;
type Tokens = GameReport['totals']['tokens'];
const count = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat(i18n.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
function duration(ms: number | null, t: (key: string) => string) {
  if (ms === null) return '—';
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor(seconds % 3600 / 60);
  if (hours) return `${hours} ${t('studioUi.hours')} ${minutes} ${t('studioUi.minutes')}`;
  if (minutes) return `${minutes} ${t('studioUi.minutes')} ${seconds % 60} ${t('studioUi.seconds')}`;
  return `${seconds} ${t('studioUi.seconds')}`;
}
function TokenCells({ tokens }: { tokens: Tokens }) {
  return tokenKeys.map(key => <td key={key} className="px-3 py-2 text-right tabular-nums">{count(tokens?.[key])}</td>);
}

export function GameReportCard({ store, projectId, active }: { store: Store; projectId: string; active: boolean }) {
  const t = useT(); const id = useId();
  const read = useCallback((signal: AbortSignal) => store.getGameReport(projectId, signal), [store, projectId]);
  const { data, error, reload } = useStudioRead(read, active ? 15_000 : false);
  return <Card className="min-w-0 gap-4 p-5" aria-labelledby={id}>
    <h3 id={id} className="text-lg font-semibold">{t('studioUi.report')}</h3>
    {error && <div role="alert" className="flex flex-wrap items-center gap-3"><p>{t('studioUi.reportError')}</p><Button variant="outline" onClick={reload}>{t('errors.retry')}</Button></div>}
    {!data && !error && <p role="status">{t('viewStates.loading')}</p>}
    {data && <>
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 xl:grid-cols-6">
        <div><dt className="text-muted-foreground">{t('studioUi.duration')}</dt><dd className="font-semibold">{duration(data.totals.durationMs, t)}</dd></div>
        <div><dt className="text-muted-foreground">{t('studioUi.attempts')}</dt><dd className="font-semibold">{count(data.totals.attempts)}</dd></div>
        {tokenKeys.map(key => <div key={key}><dt className="text-muted-foreground">{t(`studioUi.tokens.${key}`)}</dt><dd className="font-semibold">{count(data.totals.tokens?.[key])}</dd></div>)}
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('studioUi.stageReport')}</caption>
          <thead className="border-b border-border text-left text-muted-foreground"><tr>
            {['stage', 'iteration', 'duration', 'attempts'].map(key => <th key={key} scope="col" className="px-3 py-2 font-medium">{t(`studioUi.${key}`)}</th>)}
            {tokenKeys.map(key => <th key={key} scope="col" className="px-3 py-2 text-right font-medium">{t(`studioUi.tokens.${key}`)}</th>)}
          </tr></thead>
          <tbody>{data.stages.flatMap(stage => stage.iterations.map(iteration => <tr key={`${stage.key}-${iteration.iteration}-${iteration.taskCode}`} className="border-b border-border/60">
            <th scope="row" className="px-3 py-2 text-left font-medium [overflow-wrap:anywhere]">{stageName(stage.key, t, stage.title)}</th>
            <td className="px-3 py-2 tabular-nums">{iteration.iteration}</td><td className="px-3 py-2 whitespace-nowrap">{duration(iteration.durationMs, t)}</td>
            <td className="px-3 py-2 tabular-nums">{count(iteration.attempts)}</td><TokenCells tokens={iteration.tokens} />
          </tr>))}</tbody>
        </table>
      </div>
      {!data.stages.some(stage => stage.iterations.length) && <p className="text-sm text-muted-foreground">{t('studioUi.noReport')}</p>}
      <h4 className="font-medium">{t('studioUi.qa')}</h4>
      {!data.qaRounds.length && <p className="text-sm text-muted-foreground">{t('studioUi.noQa')}</p>}
      {data.qaRounds.map(round => <details key={`${round.taskCode}-${round.iteration}`} className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm"><span className="mr-3">{t('studioUi.qaRound').replace('{iteration}', String(round.iteration))}</span><Badge variant="outline" className={round.verdict === 'passed' ? 'text-ok' : round.verdict === 'changes-requested' ? 'text-destructive' : 'text-info'}>{t(`studioUi.verdicts.${round.verdict}`)}</Badge></summary>
        {!round.criteria.length && <p className="mt-3 text-sm text-muted-foreground">{t('studioUi.noCriteria')}</p>}
        <ul className="mt-3 space-y-3">{round.criteria.map((criterion, index) => {
          const Icon = criterion.passed === true ? CheckCircle2 : criterion.passed === false ? XCircle : CircleHelp;
          const result = criterion.passed === true ? 'pass' : criterion.passed === false ? 'fail' : 'notReported';
          return <li key={index} className="flex gap-2 text-sm"><span className={criterion.passed === true ? 'text-ok' : criterion.passed === false ? 'text-destructive' : 'text-muted-foreground'}><Icon aria-hidden="true" className="mt-0.5 size-4" /><span className="sr-only">{t(`studioUi.${result}`)}</span></span>
            <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]"><p className="font-medium whitespace-pre-wrap">{criterion.criterion}</p><p className="text-muted-foreground whitespace-pre-wrap">{criterion.evidence ?? t('studioUi.noEvidence')}</p></div>
          </li>;
        })}</ul>
      </details>)}
    </>}
  </Card>;
}
