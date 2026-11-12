import type { WorkflowPatchOp } from '@factory/contracts';
import type { WorkflowDetail, WorkflowStage } from '@/api/m5Models';
import type { StageDefinition } from './graphTypes';

export type SimplePatchKind = 'addTaskWithinStage' | 'skipOptionalStage' | 'reorderStages' | 'removeRequiredStage';
export function stagePatchKinds(definition: StageDefinition, stage: WorkflowStage): SimplePatchKind[] {
  const kinds: SimplePatchKind[] = [];
  if (['pending', 'ready', 'active', 'blocked'].includes(stage.state)) kinds.push('addTaskWithinStage');
  if (definition.optional && ['pending', 'ready', 'blocked'].includes(stage.state) && !stage.tasks.length) kinds.push('skipOptionalStage');
  if (stage.state === 'pending' && !stage.tasks.length) {
    kinds.push('reorderStages');
    if (!definition.optional) kinds.push('removeRequiredStage');
  }
  return kinds;
}
// The draft accepts the full contract union so later operation editors can register here.
export function patchOpText(op: WorkflowPatchOp, detail: WorkflowDetail, t: (key: string) => string) {
  const title = (key: string) => detail.graph?.stages.find(stage => stage.key === key)?.title || key;
  return t(`planPatch.summary.${op.op}`).replace('{stage}', typeof op.stage === 'string' ? title(op.stage) : op.stage.title)
    .replace('{title}', 'title' in op ? op.title : '').replace('{after}', 'after' in op && op.after ? title(op.after) : '');
}
