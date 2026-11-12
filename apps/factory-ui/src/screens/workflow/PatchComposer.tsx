import { useState } from 'react';
import { Send, Trash2, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ErrorNotice } from '@/components/ErrorNotice';
import type { WorkflowDetail } from '@/api/m5Models';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { canPatchWorkflow, patchOutcomeText, patchPendingKey } from '@/state/workflowPatches';
import { patchOpText } from './patchOperations';

export function PatchComposer({ store, detail }: { store: Store; detail: WorkflowDetail }) {
  const t = useT(); const state = store.useStoreSelector(value => value); const [confirmClear, setConfirmClear] = useState(false);
  const draft = state.m5.patchDrafts[detail.id]; const outcome = state.m5.patchOutcomes[detail.id];
  const busy = Boolean(state.loading[patchPendingKey(detail.id)]); const error = state.errors[patchPendingKey(detail.id)];
  const editable = canPatchWorkflow(detail.state); const disabled = busy || state.session !== 'authenticated' || !editable;
  if ((!draft?.ops.length && !outcome) || (!editable && !outcome)) return null;
  function clear() { store.clearPatchDraft(detail.id); setConfirmClear(false); }
  return <Card className="sticky bottom-0 z-10 gap-4 rounded-xl border-border bg-card p-4 shadow-sm" aria-label={t('planPatch.composer')} aria-busy={busy}>
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="min-w-0 flex-1 font-display text-lg font-semibold">{t('planPatch.drafting').replace('{count}', String(draft?.ops.length ?? 0))}</h3>
      {outcome && outcome.policy !== 'unknown' && <Badge variant="secondary">{t(`planPatch.policies.${outcome.policy}`)}</Badge>}
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => (draft?.ops.length ?? 0) > 1 ? setConfirmClear(true) : clear()}><Trash2 />{t('planPatch.clear')}</Button>
    </div>
    {editable && !!draft?.ops.length && <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!disabled && draft.reason.trim() && detail.revision !== undefined) void store.submitPatch(detail.id, draft.reason); }}>
      <ul className="max-h-40 space-y-2 overflow-y-auto">{draft.ops.map((op, index) => <li key={index} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 break-words">{patchOpText(op, detail, t)}</span>{detail.allowedPatches?.[op.op] && <Badge variant="secondary" className="shrink-0">{t(`planPatch.policies.${detail.allowedPatches[op.op]}`)}</Badge>}<Button type="button" variant="ghost" size="icon-xs" disabled={disabled} aria-label={`${t('planPatch.remove')}: ${patchOpText(op, detail, t)}`} onClick={() => store.removePatchOp(detail.id, index)}><X /></Button>
      </li>)}</ul>
      <div className="space-y-2"><Label htmlFor={`patch-reason-${detail.id}`}>{t('planPatch.reason')}</Label><Textarea id={`patch-reason-${detail.id}`} required maxLength={500} rows={2} disabled={disabled} value={draft.reason} onChange={event => store.setPatchReason(detail.id, event.target.value)} placeholder={t('planPatch.reasonPlaceholder')} aria-describedby={`patch-counter-${detail.id}`} />
        <div className="flex flex-wrap items-center justify-between gap-2"><span id={`patch-counter-${detail.id}`} className="text-xs text-muted-foreground">{draft.reason.length}/500</span><Button type="submit" disabled={disabled || !draft.reason.trim() || detail.revision === undefined}><Send />{busy ? t('automationWrite.saving') : t('planPatch.submit')}</Button></div>
      </div>
    </form>}
    {error && <ErrorNotice error={error} />}
    {outcome && <Alert className={outcome.state === 'pending' ? 'border-need/40' : ''}><AlertDescription className="break-words text-foreground">{patchOutcomeText(outcome, t)}</AlertDescription></Alert>}
    <Dialog open={confirmClear} onOpenChange={setConfirmClear}><DialogContent className="rounded-xl border-border bg-card"><DialogHeader><DialogTitle className="font-display text-xl">{t('planPatch.clearConfirm')}</DialogTitle><DialogDescription>{t('planPatch.clearDescription')}</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setConfirmClear(false)}>{t('planPatch.cancel')}</Button><Button type="button" disabled={busy} onClick={clear}>{t('planPatch.clear')}</Button></DialogFooter></DialogContent></Dialog>
  </Card>;
}
