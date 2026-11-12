import { useId, useState } from 'react';
import { workflowPatchOpSchema } from '@factory/contracts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PortalContainerContext, Select } from '@/components/Select';
import type { WorkflowDetail } from '@/api/m5Models';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { CapabilityInput, StageIdentityFields } from './StagePatchFields';
import { stageKeyError, stageSlug, useStagePatchForm } from './stagePatchForms';

export function AddStageDialog({ store, detail, onClose, initialStage, initialPosition = 'after' }: {
  store: Store; detail: WorkflowDetail; onClose: () => void; initialStage?: string; initialPosition?: 'after' | 'before';
}) {
  const t = useT(); const id = useId(); const { keys, suggestions, disabled } = useStagePatchForm(store, detail);
  const stages = detail.graph?.stages ?? [];
  const [title, setTitle] = useState(''); const [manualKey, setManualKey] = useState<string | null>(null);
  const [phase, setPhase] = useState(detail.phases[0] ?? '');
  const [position, setPosition] = useState(initialPosition); const [anchor, setAnchor] = useState(initialStage ?? stages.at(-1)?.key ?? '');
  const [caps, setCaps] = useState<string[]>([]); const [capInput, setCapInput] = useState('');
  const [optional, setOptional] = useState(false); const [placement, setPlacement] = useState<'portable' | 'node-bound'>('portable');
  const [teamHint, setTeamHint] = useState(''); const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const key = manualKey ?? stageSlug(title, keys);
  const op = { op: 'addStage' as const, stage: { key, phase, title: title.trim(), requiredCapabilities: caps, optional, placement,
    ...(teamHint.trim() ? { teamHint: teamHint.trim() } : {}), inputs: [], outputs: [] },
    ...(position === 'after' ? { after: anchor } : { before: anchor }) };
  const valid = !disabled && !capInput.trim() && !!title.trim() && title.trim().length <= 120 && !stageKeyError(key, keys)
    && detail.phases.includes(phase) && stages.some(stage => stage.key === anchor) && workflowPatchOpSchema.safeParse(op).success;
  function add() { if (valid && store.addPatchOp(detail.id, op)) onClose(); }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent ref={setPanel} className="max-h-[90dvh] overflow-y-auto rounded-xl border-border bg-card sm:max-w-xl" onEscapeKeyDown={event => event.stopPropagation()}>
      <PortalContainerContext.Provider value={panel}>
        <DialogHeader><DialogTitle className="font-display text-xl">{t('planPatch.stageForm.add')}</DialogTitle><DialogDescription>{t('planPatch.draftOnly')}</DialogDescription></DialogHeader>
        <form className="space-y-5" onSubmit={event => { event.preventDefault(); add(); }}>
          <StageIdentityFields id={id} title={title} stageKey={key} onTitle={setTitle} onKey={setManualKey} used={keys} autoFocus />
          <Field className="gap-2"><FieldLabel htmlFor={`${id}-phase`}>{t('planPatch.stageForm.phase')}</FieldLabel><Select id={`${id}-phase`} value={phase} onValueChange={setPhase} required options={detail.phases.map(value => ({ value, label: value }))} /></Field>
          <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
            <Field className="gap-2"><FieldLabel htmlFor={`${id}-position`}>{t('planPatch.stageForm.position')}</FieldLabel><Select id={`${id}-position`} value={position} onValueChange={value => setPosition(value as 'after' | 'before')} options={(['after', 'before'] as const).map(value => ({ value, label: t(`planPatch.stageForm.${value}`) }))} /></Field>
            <Field className="gap-2"><FieldLabel htmlFor={`${id}-anchor`}>{t('planPatch.chooseStage')}</FieldLabel><Select id={`${id}-anchor`} value={anchor} onValueChange={setAnchor} required options={stages.map(stage => ({ value: stage.key, label: stage.title || stage.key }))} /></Field>
          </div>
          <CapabilityInput id={`${id}-caps`} values={caps} input={capInput} onValues={setCaps} onInput={setCapInput} suggestions={suggestions} />
          <Field orientation="horizontal"><FieldLabel htmlFor={`${id}-optional`}>{t('planPatch.stageForm.optional')}</FieldLabel><Switch id={`${id}-optional`} checked={optional} onCheckedChange={setOptional} /></Field>
          <Field className="gap-2"><FieldLabel htmlFor={`${id}-placement`}>{t('planPatch.stageForm.placement')}</FieldLabel><Select id={`${id}-placement`} value={placement} onValueChange={value => setPlacement(value as 'portable' | 'node-bound')} options={(['portable', 'node-bound'] as const).map(value => ({ value, label: t(`planPatch.stageForm.${value}`) }))} /></Field>
          <Field className="gap-2"><FieldLabel htmlFor={`${id}-team`}>{t('planPatch.stageForm.teamHint')}</FieldLabel><Input id={`${id}-team`} maxLength={160} value={teamHint} onChange={event => setTeamHint(event.target.value)} /></Field>
          {['approval', 'operator'].includes(detail.allowedPatches?.addStage ?? '') && <p className="text-sm text-muted-foreground">{t('planPatch.stageForm.approval')}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t('planPatch.cancel')}</Button><Button type="submit" disabled={!valid}>{t('planPatch.stageForm.addToPatch')}</Button></DialogFooter>
        </form>
      </PortalContainerContext.Provider>
    </DialogContent>
  </Dialog>;
}
