import { workflowKeySchema } from '@factory/contracts';
import type { WorkflowDetail } from '@/api/m5Models';
import type { Store } from '@/state/store';
import { canPatchWorkflow, patchPendingKey } from '@/state/workflowPatches';

export function stageSlug(title: string, used: ReadonlySet<string>) {
  const text = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const base = (text || 'stage').slice(0, 40).replace(/-+$/g, '');
  if (workflowKeySchema.safeParse(base).success && !used.has(base)) return base;
  let suffix = 2;
  while (true) {
    const ending = `-${suffix++}`;
    const candidate = `${base.slice(0, 40 - ending.length).replace(/-+$/g, '')}${ending}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function stageKeyError(key: string, used: ReadonlySet<string>) {
  return !workflowKeySchema.safeParse(key).success ? 'planPatch.stageForm.keyFormat'
    : used.has(key) ? 'planPatch.stageForm.keyTaken' : null;
}

export function useStagePatchForm(store: Store, detail: WorkflowDetail) {
  const state = store.useStoreSelector(value => value);
  const draft = state.m5.patchDrafts[detail.id];
  const keys = new Set([...detail.stages.map(stage => stage.key), ...(detail.graph?.stages ?? []).map(stage => stage.key)]);
  for (const op of draft?.ops ?? []) {
    if (op.op === 'addStage') keys.add(op.stage.key);
    if (op.op === 'splitStage') op.into.forEach(part => keys.add(part.key));
  }
  return { keys, suggestions: [...new Set((detail.graph?.stages ?? []).flatMap(stage => stage.requiredCapabilities))],
    disabled: state.session !== 'authenticated' || !canPatchWorkflow(detail.state)
      || !!state.loading[patchPendingKey(detail.id)] || (draft?.ops.length ?? 0) >= 10 };
}
