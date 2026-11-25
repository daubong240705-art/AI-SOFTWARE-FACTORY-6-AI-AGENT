import { useState } from 'react';
import { createApiClient } from '@/api/client';
import type { Store } from '@/state/store';
import { DecisionDialog } from '../DecisionDialog';
import { baseUrl } from './live';
import { MonitorView } from './MonitorView';
import { TraceView } from './TraceView';

export default function ProjectObservability({ projectId, traceId, onOpenTask, store }: {
  projectId: string; traceId: string | null; onOpenTask: (id: string) => void; store: Store;
}) {
  const [api] = useState(() => createApiClient({ baseUrl }));
  const [approval, setApproval] = useState<string | null>(null);
  if (!traceId) return <MonitorView api={api} projectId={projectId} onOpenTask={onOpenTask} />;
  return <>
    <TraceView api={api} projectId={projectId} traceId={traceId} onOpenTask={onOpenTask} onOpenApproval={setApproval} />
    {approval && <DecisionDialog store={store} approvalId={approval} onClose={() => setApproval(null)} />}
  </>;
}
