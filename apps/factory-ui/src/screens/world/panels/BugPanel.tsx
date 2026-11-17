import { useId } from 'react';
import { Button } from '@/components/ui/button';
import type { Bug } from '../data/types';
import { labels, type LabLocale } from '../scene/lab/labels';

export type BugPanelProps = {
  bug: Bug | null;
  gameName: string;
  onOpenProject: (projectId: string) => void;
  onClose?: () => void;
  locale?: LabLocale;
};

/** HTML only: server criterion/evidence always remain escaped React text nodes. */
export function BugPanel({ bug, gameName, onOpenProject, onClose, locale = 'vi' }: BugPanelProps) {
  const titleId = useId();
  if (!bug) return null;
  const copy = labels[locale];
  return <aside aria-labelledby={titleId} className="w-full max-w-sm rounded-xl border border-border bg-surface p-4 text-foreground shadow-md">
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
    <Button type="button" className="mt-4" onClick={() => onOpenProject(bug.projectId)}>{copy.openProject}</Button>
  </aside>;
}
