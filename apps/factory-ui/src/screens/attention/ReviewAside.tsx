import { Circle, CircleCheck, CircleX } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AttemptEvent } from '../../api/client';
import { useT } from '../../i18n';
import { evidenceView, summariseEvent } from '../../state/attemptView';
import type { Store } from '../../state/store';
import { readableText } from './presentation';

function Row({ label, value }: { label: string; value: string }) {
  const t = useT();
  return <div className="grid min-w-0 grid-cols-2 items-start gap-3 py-2 first:pt-0 last:pb-0"><dt className="text-muted-foreground">{label}</dt><dd className={cn('m-0 min-w-0 text-right font-medium [overflow-wrap:anywhere]', value === t('reviewUi.notReported') && 'text-muted-foreground')}>{value}</dd></div>;
}

export function ReviewAside({ store, taskId, events, totals }: { store: Store; taskId: string; events: AttemptEvent[]; totals?: { files: number; additions: number; deletions: number } }) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  const task = state.tasks.find(item => item.id === taskId);
  // Criterion reports (criterion.report) are shown on their criterion, newest report wins.
  const isCriterion = (event: AttemptEvent) => event.kind === 'evidence' && typeof (event.body as { criterion?: unknown } | null)?.criterion === 'string';
  const reports = new Map<string, { passed: boolean; evidence: string }>();
  for (const event of events) if (isCriterion(event)) {
    const body = event.body as { criterion: string; passed?: unknown; evidence?: unknown };
    reports.set(body.criterion, { passed: body.passed === true, evidence: typeof body.evidence === 'string' ? body.evidence : '' });
  }
  const checks = events.filter(event => event.kind === 'evidence' && !isCriterion(event)).map(summariseEvent).filter(event => event.text);
  const evidence = evidenceView([...events].reverse().find(event => event.kind === 'evidence' && evidenceView(event.body).totals)?.body);
  const changes = totals ?? evidence.totals;
  const tests = checks.filter(check => /\btests?\b|kiểm thử/i.test(check.text));
  const conflict = state.globalInbox.integrationConflicts?.find(item => item.taskId === taskId);
  return <aside className="grid min-w-0 gap-4 min-[1400px]:sticky min-[1400px]:top-5" aria-label={t('attention.facts')}>
    <Card className="gap-3 border-border p-4 shadow-none"><h3 className="text-sm font-semibold text-muted-foreground">{t('taskUi.acceptance')}</h3>
      <ul className="m-0 grid list-none gap-3 p-0">{task?.acceptance.map((criterion, index) => {
        // Only an explicit, successful criterion check can mark a criterion verified.
        const report = reports.get(criterion);
        const Icon = report ? (report.passed ? CircleCheck : CircleX) : Circle;
        const tone = report ? (report.passed ? 'text-ok' : 'text-destructive') : 'text-muted-foreground';
        const status = t(report ? (report.passed ? 'reviewUi.verified' : 'reviewUi.failedCheck') : 'reviewUi.unverified');
        return <li key={index} className="flex items-start gap-2.5 text-sm leading-relaxed"><Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${tone}`} />
          <span className="min-w-0"><span className="sr-only">{status}: </span>{readableText(criterion)}
            {report?.evidence && <span className="mt-1 block text-xs text-muted-foreground [overflow-wrap:anywhere]">{readableText(report.evidence)}</span>}</span></li>;
      })}</ul>{!task?.acceptance.length && <p className="text-sm text-muted-foreground">{t('reviewUi.noCriteria')}</p>}
    </Card>
    <Card className="gap-3 border-border p-4 shadow-none"><h3 className="text-sm font-semibold text-muted-foreground">{t('attention.checks')}</h3>
      <dl className="divide-y divide-border text-sm">
        <Row label={t('reviewUi.test')} value={tests.map(check => readableText(check.text)).join('; ') || t('reviewUi.notReported')} />
        <Row label={t('reviewUi.changes')} value={changes ? t('reviewUi.changeCount').replace('{files}', String(changes.files)).replace('{added}', String(changes.additions)).replace('{removed}', String(changes.deletions)) : t('reviewUi.notReported')} />
        <Row label={t('reviewUi.integration')} value={conflict ? t('attention.kinds.integration-conflict') : t('reviewUi.notReported')} />
      </dl>
      {!checks.length && <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">{t('attention.noChecks')}</p>}
      {checks.filter(check => !tests.includes(check)).map((check, index) => <p key={index} className="text-xs leading-relaxed text-muted-foreground">{readableText(check.text)}</p>)}
    </Card>
  </aside>;
}
