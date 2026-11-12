import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PortalContainerContext, Select } from '@/components/Select';
import type { WorkflowDetail, WorkflowStage } from '@/api/m5Models';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { patchPendingKey } from '@/state/workflowPatches';
import type { StageDefinition } from './graphTypes';
import { stagePatchKinds, type SimplePatchKind } from './patchOperations';
import { AddStageDialog } from './AddStageDialog';
import { SplitStageDialog } from './SplitStageDialog';

export function StagePatchActions({ store, detail, definition, stage }: { store: Store; detail: WorkflowDetail; definition: StageDefinition; stage: WorkflowStage }) {
  const t = useT(); const state = store.useStoreSelector(value => value); const id = useId();
  const [kind, setKind] = useState<SimplePatchKind | null>(null); const [title, setTitle] = useState('');
  const [after, setAfter] = useState(''); const [understood, setUnderstood] = useState(false);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [addPosition, setAddPosition] = useState<'after' | 'before' | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  // The Host refuses extra tasks unless the definition allows at least two per stage (an older Host does not say, so offer it).
  const noRoom = definition.maxTasks !== undefined && definition.maxTasks < 2;
  const kinds = stagePatchKinds(definition, stage).filter(item => item !== 'reorderStages' || (detail.graph?.stages.length ?? 0) > 1).filter(item => item !== 'addTaskWithinStage' || !noRoom);
  const disabled = state.session !== 'authenticated' || state.loading[patchPendingKey(detail.id)] || (state.m5.patchDrafts[detail.id]?.ops.length ?? 0) >= 10;
  const valid = kind && kinds.includes(kind) && !disabled && (kind !== 'addTaskWithinStage' || !!title.trim()) && (kind !== 'reorderStages' || !!after && detail.graph?.stages.some(item => item.key === after && item.key !== stage.key)) && (kind !== 'removeRequiredStage' || understood);
  function add() {
    if (!kind || !valid) return;
    const op = kind === 'addTaskWithinStage' ? { op: kind, stage: stage.key, title: title.trim() }
      : kind === 'reorderStages' ? { op: kind, stage: stage.key, after } : { op: kind, stage: stage.key };
    if (store.addPatchOp(detail.id, op)) setKind(null);
  }
  return <section className="space-y-3" aria-label={t('planPatch.editStage')}>
    <h4 className="text-sm font-medium">{t('planPatch.editStage')}</h4>
    <div className="flex flex-col items-start gap-2">{kinds.map(item => <Button key={item} type="button" size="sm" variant={item === 'removeRequiredStage' ? 'destructive' : 'outline'} disabled={Boolean(disabled)} onClick={() => { setTitle(''); setAfter(''); setUnderstood(false); setKind(item); }}>{t(`planPatch.actions.${item}`)}</Button>)}</div>
    <div className="flex flex-col items-start gap-2">{(['after', 'before'] as const).map(position => <Button key={position} type="button" size="sm" variant="outline" disabled={Boolean(disabled) || !detail.phases.length} onClick={() => setAddPosition(position)}>{t(`planPatch.stageForm.add${position === 'after' ? 'After' : 'Before'}`)}</Button>)}</div>
    {addPosition && <AddStageDialog store={store} detail={detail} initialStage={stage.key} initialPosition={addPosition} onClose={() => setAddPosition(null)} />}
    {!['done', 'skipped', 'failed', 'cancelled', 'unknown'].includes(stage.state) && <Button type="button" size="sm" variant="outline" disabled={Boolean(disabled)} onClick={() => setSplitOpen(true)}>{t('planPatch.stageForm.splitAction')}</Button>}
    {splitOpen && <SplitStageDialog store={store} detail={detail} definition={definition} stage={stage} onClose={() => setSplitOpen(false)} />}
    {noRoom && <p className="text-xs text-muted-foreground">{t('planPatch.noRoom')}</p>}
    {(state.m5.patchDrafts[detail.id]?.ops.length ?? 0) >= 10 && <p className="text-xs text-muted-foreground">{t('planPatch.limit')}</p>}
    <Dialog open={!!kind} onOpenChange={open => { if (!open) setKind(null); }}>
      <DialogContent ref={setPanel} className="rounded-xl border-border bg-card" onEscapeKeyDown={event => event.stopPropagation()}>
        <PortalContainerContext.Provider value={panel}>
        <DialogHeader><DialogTitle className="font-display text-xl">{kind && t(`planPatch.actions.${kind}`)}</DialogTitle><DialogDescription>{kind === 'removeRequiredStage' ? t('planPatch.requiredWarning') : kind === 'skipOptionalStage' ? t('planPatch.skipConfirm').replace('{stage}', definition.title || stage.key) : t('planPatch.draftOnly')}</DialogDescription></DialogHeader>
        <form className="space-y-5" onSubmit={event => { event.preventDefault(); add(); }}>
          {kind === 'addTaskWithinStage' && <div className="space-y-2"><Label htmlFor={`${id}-title`}>{t('planPatch.taskTitle')}</Label><Input id={`${id}-title`} autoFocus required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /><p className="text-right text-xs text-muted-foreground">{title.length}/120</p></div>}
          {kind === 'reorderStages' && <div className="space-y-2"><Label htmlFor={`${id}-after`}>{t('planPatch.after')}</Label><Select id={`${id}-after`} value={after} onValueChange={setAfter} placeholder={t('planPatch.chooseStage')} options={(detail.graph?.stages ?? []).filter(item => item.key !== stage.key).map(item => ({ value: item.key, label: item.title || item.key }))} required /><p className="text-xs text-muted-foreground">{t('planPatch.cycleHint')}</p></div>}
          {kind === 'removeRequiredStage' && <div className="flex items-center gap-2"><Checkbox id={`${id}-understood`} checked={understood} onCheckedChange={value => setUnderstood(value === true)} /><Label htmlFor={`${id}-understood`}>{t('planPatch.understood')}</Label></div>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setKind(null)}>{t('planPatch.cancel')}</Button><Button type="submit" variant={kind === 'removeRequiredStage' ? 'destructive' : 'default'} disabled={!valid}>{t('planPatch.addToDraft')}</Button></DialogFooter>
        </form>
        </PortalContainerContext.Provider>
      </DialogContent>
    </Dialog>
  </section>;
}
