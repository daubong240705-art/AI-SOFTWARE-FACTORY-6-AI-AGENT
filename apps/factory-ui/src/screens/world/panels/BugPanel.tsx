import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { useEffect, useState, useId } from 'react';
import { Button } from '@/components/ui/button';
import type { Bug } from '../data/types';
import { worldCopy, type LabLocale } from '../copy';

export type BugPanelProps = {
  bug: Bug | null;
  store?: Store;
  gameName: string;
  onOpenProject: (projectId: string) => void;
  onTask?: (projectId: string, taskId: string) => void;
  onClose?: () => void;
  locale?: LabLocale;
};

/** HTML only: server criterion/evidence always remain escaped React text nodes. */
export function BugPanel({ bug, store, gameName, onOpenProject, onTask, onClose, locale = 'vi' }: BugPanelProps) {
  const t = useT();
  const titleId = useId(); const [resolvedTask, setResolvedTask] = useState<{ code: string | undefined; id: string | null } | null>(null);
  useEffect(() => {
    if (!bug || bug.taskId || !bug.taskCode || !store) return;
    const controller = new AbortController();
    void store.listTasks(bug.projectId, controller.signal).then(value => { if (!controller.signal.aborted) setResolvedTask({ code: bug.taskCode, id: value.items.find(task => task.code === bug.taskCode)?.id ?? null }); }, () => {});
    return () => controller.abort();
  }, [store, bug?.projectId, bug?.taskCode, bug?.taskId]);
  if (!bug) return null;
  const taskId = bug.taskId ?? (resolvedTask?.code === bug.taskCode ? resolvedTask?.id : null);
  const copy = worldCopy[locale].lab;
  return <aside aria-labelledby={titleId} className="world-panel-content min-w-0 max-w-full">
    <div className="flex items-center justify-between gap-3">
      <h2 id={titleId} className="font-semibold">{copy.bugDetails}</h2>
      {onClose && <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label={copy.close}>×</Button>}
    </div>
    <p className="mt-2 break-words font-medium">{gameName}</p>
    <p className="mt-1 text-sm text-muted-foreground">{bug.state === 'open' ? copy.open : copy.retesting}</p>
    <dl className="mt-4 space-y-2 text-sm">
      <dt className="font-medium">{copy.criterion}</dt>
      <dd className="whitespace-pre-wrap break-words">{bug.criterion}</dd>
      <dt className="font-medium">{copy.evidence}</dt>
      <dd className="whitespace-pre-wrap break-words">{bug.evidence ?? copy.noEvidence}</dd>
    </dl>
    {taskId && onTask && <Button className="mt-4" onClick={() => onTask(bug.projectId, taskId!)}>{t('worldUi.taskDetails.openTask')}</Button>}
    <Button type="button" variant="outline" className="mt-4" onClick={() => onOpenProject(bug.projectId)}>{copy.openProject}</Button>
  </aside>;
}
