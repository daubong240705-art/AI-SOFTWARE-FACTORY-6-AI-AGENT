import { LoadingState } from '@/components/LoadingState';
import { lazy, Suspense } from 'react';
import type { WorkflowGraphProps } from './graphTypes';

const WorkflowGraph = lazy(() => import('./WorkflowGraph'));
export function LazyWorkflowGraph(props: WorkflowGraphProps) {
  return <Suspense fallback={<LoadingState className="min-h-40" />}><WorkflowGraph {...props} /></Suspense>;
}
