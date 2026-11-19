import { useState } from 'react';
import { createApiClient } from '@/api/client';
import type { Store } from '@/state/store';
import { openFlowRoute, type FlowRoute } from '../shell/navigation';
import { DecisionDialog } from '../DecisionDialog';
import { baseUrl } from './shared';
import { FlowEditor } from './FlowEditor';
import { FlowList } from './FlowList';
import { RunView } from './RunView';

export default function ProjectFlows({ projectId, route, store, onOpenTask }: { projectId: string; route: FlowRoute | null; store: Store; onOpenTask: (taskId: string) => void }) {
  const [api] = useState(() => createApiClient({ baseUrl }));
  const [approval, setApproval] = useState<{ runId: string; id: string } | null>(null);
  const onBack = () => openFlowRoute(projectId);
  if (route?.kind === 'flows') return <FlowEditor key={route.id} api={api} projectId={projectId} flowId={route.id} onBack={onBack} />;
  if (route?.kind === 'runs') return <>
    <RunView key={route.id} api={api} projectId={projectId} runId={route.id} onBack={onBack} onOpenTask={onOpenTask} onOpenApproval={id => setApproval({ runId: route.id, id })} />
    {approval?.runId === route.id && <DecisionDialog store={store} approvalId={approval.id} onClose={() => setApproval(null)} />}
  </>;
  return <FlowList api={api} projectId={projectId} />;
}
