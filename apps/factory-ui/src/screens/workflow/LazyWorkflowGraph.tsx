import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import type { WorkflowGraphProps } from './graphTypes';

const WorkflowGraph = lazy(() => import('./WorkflowGraph'));
export function LazyWorkflowGraph(props: WorkflowGraphProps) {
  const t = useT();
  return <Suspense fallback={<div role="status" aria-label={t('viewStates.loading')} className="h-full p-5"><Skeleton className="h-full min-h-40 w-full rounded-xl" /></div>}><WorkflowGraph {...props} /></Suspense>;
}
