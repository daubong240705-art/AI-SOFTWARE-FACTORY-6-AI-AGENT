import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { MascotEmpty } from '@/components/mascot';
import { useT } from '@/i18n';
import type { WorkflowGraphProps } from './graphTypes';

const WorkflowGraph = lazy(() => import('./WorkflowGraph'));
export function LazyWorkflowGraph(props: WorkflowGraphProps) {
  const t = useT();
  return <Suspense fallback={<div role="status" aria-label={t('viewStates.loading')} className="h-full p-5"><MascotEmpty seat="Lead" state="thinking" compact className="h-full" fallback={<Skeleton className="h-full min-h-40 w-full rounded-xl" />}><p className="text-sm text-muted-foreground">{t('viewStates.loading')}</p></MascotEmpty></div>}><WorkflowGraph {...props} /></Suspense>;
}
