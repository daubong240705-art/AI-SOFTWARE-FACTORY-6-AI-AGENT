import { useId, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { workflowPatchOpSchema } from '@factory/contracts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PortalContainerContext } from '@/components/Select';
import type { WorkflowDetail, WorkflowStage } from '@/api/m5Models';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import type { StageDefinition } from './graphTypes';
import { CapabilityInput, StageIdentityFields } from './StagePatchFields';
import { stageKeyError, stageSlug, useStagePatchForm } from './stagePatchForms';

type Part = { id: number; title: string; manualKey: string | null; caps: string[]; capInput: string };
const emptyPart = (id: number): Part => ({ id, title: '', manualKey: null, caps: [], capInput: '' });

export function SplitStageDialog({ store, detail, definition, stage, onClose }: {
  store: Store; detail: WorkflowDetail; definition: StageDefinition; stage: WorkflowStage; onClose: () => void;
}) {
  const t = useT(); const id = useId(); const { keys, suggestions, disabled } = useStagePatchForm(store, detail);
  const [parts, setParts] = useState<Part[]>(() => [
    { ...emptyPart(0), title: `${(definition.title || stage.key).slice(0, 118)} 1`, caps: [...definition.requiredCapabilities] },
    { ...emptyPart(1), title: `${(definition.title || stage.key).slice(0, 118)} 2` },
  ]);
  const [nextId, setNextId] = useState(2); const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  // Reserve manually edited keys first, then generate distinct keys for automatic rows in their display order.
  const reserved = new Set([...keys, ...parts.flatMap(part => part.manualKey === null ? [] : [part.manualKey])]);
  const rows = parts.map(part => {
    const key = part.manualKey ?? stageSlug(part.title, reserved); reserved.add(key); return { ...part, key };
  });
  const op = { op: 'splitStage' as const, stage: stage.key,
    into: rows.map(row => ({ key: row.key, title: row.title.trim(), ...(row.caps.length ? { requiredCapabilities: row.caps } : {}) })) };
  const unfinished = !['done', 'skipped', 'failed', 'cancelled', 'unknown'].includes(stage.state);
  const valid = !disabled && unfinished && detail.graph?.stages.some(item => item.key === stage.key)
    && rows.every(row => row.title.trim().length > 0 && row.title.trim().length <= 120 && !row.capInput.trim() && !stageKeyError(row.key, keys)
      && !rows.some(other => other.id !== row.id && other.key === row.key)) && workflowPatchOpSchema.safeParse(op).success;
  function update(partId: number, patch: Partial<Part>) {
    setParts(current => current.map(part => part.id === partId ? { ...part, ...patch } : part));
  }
  function addRow() {
    if (parts.length >= 5) return;
    setParts(current => [...current, emptyPart(nextId)]); setNextId(value => value + 1);
  }
  function submit() { if (valid && store.addPatchOp(detail.id, op)) onClose(); }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent ref={setPanel} className="max-h-[90dvh] overflow-y-auto rounded-xl border-border bg-card sm:max-w-2xl" onEscapeKeyDown={event => event.stopPropagation()}>
      <PortalContainerContext.Provider value={panel}>
        <DialogHeader><DialogTitle className="font-display text-xl">{t('planPatch.stageForm.split')}</DialogTitle><DialogDescription>{t('planPatch.stageForm.splitDescription')}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); submit(); }}>
          {rows.map((row, index) => <Card key={row.id} className="gap-4 rounded-xl border-border p-4">
            <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{t('planPatch.stageForm.child').replace('{number}', String(index + 1))}</h3>
              <Button type="button" variant="ghost" size="icon-xs" disabled={rows.length <= 2} aria-label={t('planPatch.stageForm.removeChild').replace('{number}', String(index + 1))} onClick={() => setParts(current => current.filter(part => part.id !== row.id))}><X /></Button>
            </div>
            <StageIdentityFields id={`${id}-${row.id}`} title={row.title} stageKey={row.key} autoFocus={index === 0}
              onTitle={title => update(row.id, { title })} onKey={manualKey => update(row.id, { manualKey })}
              used={new Set([...keys, ...rows.filter(other => other.id !== row.id).map(other => other.key)])} />
            <CapabilityInput id={`${id}-${row.id}-caps`} values={row.caps} input={row.capInput}
              onValues={caps => update(row.id, { caps })} onInput={capInput => update(row.id, { capInput })} suggestions={suggestions} />
            {!row.caps.length && <p className="text-xs text-muted-foreground">{t('planPatch.stageForm.inheritCapabilities')}</p>}
          </Card>)}
          <div className="flex items-center justify-between gap-3"><Button type="button" variant="outline" disabled={rows.length >= 5} onClick={addRow}><Plus />{t('planPatch.stageForm.addChild')}</Button><span className="text-xs text-muted-foreground">{t('planPatch.stageForm.childCount').replace('{count}', String(rows.length))}</span></div>
          <p className="text-xs text-muted-foreground">{t('planPatch.draftOnly')}</p>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t('planPatch.cancel')}</Button><Button type="submit" disabled={!valid}>{t('planPatch.stageForm.addToPatch')}</Button></DialogFooter>
        </form>
      </PortalContainerContext.Provider>
    </DialogContent>
  </Dialog>;
}
