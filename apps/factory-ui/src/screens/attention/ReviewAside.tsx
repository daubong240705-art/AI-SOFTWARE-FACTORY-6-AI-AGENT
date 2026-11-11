import { Circle, CircleCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { AttemptEvent } from '../../api/client';
import { useT } from '../../i18n';
import { evidenceView, summariseEvent } from '../../state/attemptView';
import type { Store } from '../../state/store';
import { Facts } from './ReviewShared';
import { readableText } from './presentation';

export function ReviewAside({ store, taskId, events, totals }: { store: Store; taskId: string; events: AttemptEvent[]; totals?: { files: number; additions: number; deletions: number } }) {
  const t = useT(); const state = store.useStoreSelector(value => value);
  const task = state.tasks.find(item => item.id === taskId);
  const checks = events.filter(event => event.kind === 'evidence').map(summariseEvent).filter(event => event.text);
  const evidence = evidenceView([...events].reverse().find(event => event.kind === 'evidence' && evidenceView(event.body).totals)?.body);
  const changes = totals ?? evidence.totals;
  const tests = checks.filter(check => /\btests?\b|kiểm thử/i.test(check.text));
  const conflict = state.globalInbox.integrationConflicts?.find(item => item.taskId === taskId);
  return <aside className="grid min-w-0 gap-4 min-[1400px]:sticky min-[1400px]:top-5" aria-label={t('attention.facts')}>
    <Card className="gap-3 border-border p-4 shadow-none"><h3 className="text-sm font-semibold text-muted-foreground">{t('taskUi.acceptance')}</h3>
      <ul className="m-0 grid list-none gap-3 p-0">{task?.acceptance.map((criterion, index) => {
        // Only an explicit, successful criterion check can mark a criterion verified.
        const verified = events.some(event => { const body = event.body as { criterion?: unknown; passed?: unknown } | null; return event.kind === 'evidence' && body?.criterion === criterion && body.passed === true; });
        const Icon = verified ? CircleCheck : Circle;
        return <li key={index} className="flex items-start gap-2.5 text-sm leading-relaxed"><Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${verified ? 'text-ok' : 'text-muted-foreground'}`} /><span><span className="sr-only">{t(verified ? 'reviewUi.verified' : 'reviewUi.unverified')}: </span>{readableText(criterion)}</span></li>;
      })}</ul>{!task?.acceptance.length && <p className="text-sm text-muted-foreground">{t('reviewUi.noCriteria')}</p>}
    </Card>
    <Card className="gap-3 border-border p-4 shadow-none"><h3 className="text-sm font-semibold text-muted-foreground">{t('attention.checks')}</h3>
      <Facts rows={[
        [t('reviewUi.test'), tests.map(check => readableText(check.text)).join('; ') || t('reviewUi.notReported')],
        [t('reviewUi.changes'), changes ? t('reviewUi.changeCount').replace('{files}', String(changes.files)).replace('{added}', String(changes.additions)).replace('{removed}', String(changes.deletions)) : t('reviewUi.notReported')],
        [t('reviewUi.integration'), conflict ? t('attention.kinds.integration-conflict') : t('reviewUi.notReported')],
      ]} />
      {!checks.length && <p className="text-xs leading-relaxed text-muted-foreground">{t('attention.noChecks')}</p>}
      {checks.filter(check => !tests.includes(check)).map((check, index) => <p key={index} className="text-xs leading-relaxed text-muted-foreground">{readableText(check.text)}</p>)}
    </Card>
  </aside>;
}
