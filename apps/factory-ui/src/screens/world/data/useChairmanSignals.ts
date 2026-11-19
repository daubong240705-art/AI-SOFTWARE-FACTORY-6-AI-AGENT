import { useEffect, useRef, useState } from 'react';
import type { Store } from '@/state/store';
import { toys } from '../scene/toys/store';
import { tone } from '../scene/toys/sound';

/** Read Portal replies independently of the currently focused project. Initial
 * snapshots and visibility resumes establish a baseline; they never ring. */
export function useChairmanSignals(store: Store, quiet: boolean) {
  const [portalProjectId, setPortalProjectId] = useState<string | null>(null);
  const [phonePulse, setPhonePulse] = useState(0), [approvalPulse, setApprovalPulse] = useState(0);
  const approvals = store.useStoreSelector(s => s.globalInbox.approvals);
  const previous = useRef<Set<string> | null>(null), soundOff = useRef(quiet); soundOff.current = quiet;
  useEffect(() => {
    const ids = new Set(approvals.map(a => a.id));
    if (previous.current && [...ids].some(id => !previous.current!.has(id))) setApprovalPulse(performance.now());
    previous.current = ids;
  }, [approvals]);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    let baseline: Set<string> | null = null, projectId: string | null = null;
    const controller = new AbortController();
    async function read() {
      if (!active) return;
      if (document.hidden) { baseline = null; timer = setTimeout(read, 6000); return; }
      try {
        const portal = await store.getPortal(controller.signal);
        if (!active) return;
        const next = portal.configured ? portal.projectId : null;
        if (projectId !== next) baseline = null;
        projectId = next; setPortalProjectId(next);
        if (next) {
          const office = await store.getProjectInteractions(next, 60, controller.signal);
          if (!active) return;
          const replies = office.items.filter(item => item.from.kind === 'seat' && item.to?.kind === 'operator' && ['message', 'answer'].includes(item.kind));
          const ids = new Set(replies.map(item => item.id));
          if (baseline && [...ids].some(id => !baseline!.has(id))) {
            setPhonePulse(performance.now());
            if (toys.snapshot().sound && !soundOff.current) tone('phone');
          }
          baseline = ids;
        }
      } catch { /* Panels expose errors and retries; retain the last good signal. */ }
      if (active) timer = setTimeout(read, 6000);
    }
    void read();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [store]);
  return { portalProjectId, phonePulse, approvalPulse };
}
