import { useMemo } from 'react';
import type { ActivityRun } from '@/api/activityModels';
import type { WorkflowStage } from '@/api/m5Models';
import type { Store } from '@/state/store';
import { useActivity } from '../teams/activity/useActivity';

export type LiveRun = Pick<ActivityRun, 'attemptState' | 'startedAt' | 'progress'> & {
  seatName: string; seatRole: string; needsYou: boolean; approvalId: string | null;
};
export type LiveRuns = ReadonlyMap<string, LiveRun>;
export const noLiveRuns: LiveRuns = new Map();

export function stageLiveRuns(stage: WorkflowStage, liveRuns: LiveRuns) {
  return stage.tasks.flatMap(task => {
    const run = liveRuns.get(task.taskId);
    return run ? [{ ...task, run }] : [];
  });
}

export function workflowLiveRuns(stages: WorkflowStage[], liveRuns: LiveRuns) {
  const taskIds = new Set(stages.flatMap(stage => stage.tasks.map(task => task.taskId)));
  return [...liveRuns].filter(([taskId]) => taskIds.has(taskId));
}

/** The workflow tab mounts this hook; only its visible diagram subscribes to activity. */
export function useLiveRuns(store: Store, projectId: string, enabled: boolean) {
  useActivity(store, enabled);
  const activity = store.useStoreSelector(state => state.activity);
  return useMemo(() => {
    const runs = new Map<string, LiveRun>();
    if (!enabled) return runs;
    for (const team of activity?.teams ?? []) for (const seat of team.seats) for (const run of seat.runs) {
      if (run.projectId !== projectId) continue;
      const need = seat.needsYou.find(item => item.taskId === run.taskId);
      runs.set(run.taskId, {
        seatName: seat.name, seatRole: seat.role, attemptState: run.attemptState,
        startedAt: run.startedAt, progress: run.progress, needsYou: !!need, approvalId: need?.approvalId ?? null,
      });
    }
    return runs;
  }, [activity, projectId, enabled]);
}
