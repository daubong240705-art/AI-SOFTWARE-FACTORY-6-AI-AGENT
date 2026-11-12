import type { WorkflowPatchOp } from '@factory/contracts';
import type { WorkflowPatch } from '@/api/m5Models';

export type PatchDraft = { ops: WorkflowPatchOp[]; reason: string };
export const emptyPatchDraft = (): PatchDraft => ({ ops: [], reason: '' });
export const patchPendingKey = (id: string) => `workflow-patch:${id}`;
export const patchDecisionKey = (id: string) => `workflow-patch-decision:${id}`;
export const canPatchWorkflow = (state: string) => ['draft', 'proposed', 'active', 'awaiting-approval', 'paused', 'stalled'].includes(state);
export function patchOutcomeText(patch: WorkflowPatch, t: (key: string) => string) {
  if (patch.state === 'applied') return t('planPatch.applied').replace('{revision}', String(patch.appliedRevision ?? '?'));
  if (patch.state === 'pending') return t('planPatch.pending');
  if (patch.state === 'refused') return t('planPatch.refused').replace('{reason}', patch.refusal ?? t('planPatch.noRefusal'));
  return t(`planPatch.states.${patch.state}`);
}
