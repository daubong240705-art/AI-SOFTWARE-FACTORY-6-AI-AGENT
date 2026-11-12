import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CommandFormFrame } from '@/components/CommandFormFrame';
import { workflowsDecidePatch } from '@/api/commands';
import type { WorkflowDetail, WorkflowPatch } from '@/api/m5Models';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { Store } from '@/state/store';
import { patchDecisionKey } from '@/state/workflowPatches';
import { relativeTime } from '../Inbox';

function PatchDecision({ store, detail, patch, decision, onClose }: { store: Store; detail: WorkflowDetail; patch: WorkflowPatch; decision: 'approve' | 'reject'; onClose: () => void }) {
  const t = useT(); const id = useId(); const [comment, setComment] = useState(''); const state = store.useStoreSelector(value => value);
  const key = patchDecisionKey(patch.id); const label = t(`planPatch.${decision}`);
  return <CommandFormFrame store={store} pendingKey={key} title={`${label} #${patch.number}`} description={t('planPatch.decisionHelp').replace('{number}', String(patch.number))} submitLabel={label} invalidKey="planPatch.errors.invalid" onClose={onClose}
    submitDisabled={state.session !== 'authenticated' || !detail.patches.some(item => item.id === patch.id && item.state === 'pending')}
    onSubmit={() => state.selectedProjectId ? workflowsDecidePatch({ projectId: state.selectedProjectId, patchId: patch.id, decision, ...(comment.trim() ? { comment: comment.trim() } : {}) }) : 'planPatch.errors.invalid'}
    send={command => store.decideWorkflowPatch(detail.id, command)}>
    <div className="space-y-2"><Label htmlFor={id}>{t('planPatch.commentOptional')}</Label><Textarea id={id} maxLength={500} value={comment} onChange={event => setComment(event.target.value)} /><p className="text-right text-xs text-muted-foreground">{comment.length}/500</p></div>
  </CommandFormFrame>;
}

export function PatchHistory({ store, detail, editMode }: { store: Store; detail: WorkflowDetail; editMode: boolean }) {
  const t = useT(); const state = store.useStoreSelector(value => value); const [decision, setDecision] = useState<{ patch: WorkflowPatch; value: 'approve' | 'reject' } | null>(null);
  if (!detail.patches.length && !editMode) return null;
  const patches = [...detail.patches].sort((a, b) => b.number - a.number);
  return <Collapsible className="rounded-xl border border-border bg-card">
    <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="group h-auto w-full justify-between rounded-xl px-4 py-3"><span className="font-display text-lg font-semibold">{t('planPatch.history')}</span><ChevronDown className="transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger>
    <CollapsibleContent className="border-t border-border">
      {!patches.length && <p className="p-4 text-sm text-muted-foreground">{t('planPatch.emptyHistory')}</p>}
      <ul className="divide-y divide-border">{patches.map(patch => <li key={patch.id} className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">#{patch.number}</span><span className="text-sm">{t(patch.proposedBy === 'lead' ? 'planPatch.lead' : patch.proposedBy === 'operator' ? 'planPatch.you' : 'm5Ui.states.unknown')}</span>
          {patch.policy !== 'unknown' && <Badge variant="secondary" className="font-normal">{t(`planPatch.policies.${patch.policy}`)}</Badge>}
          <Badge variant="outline" className={cn('gap-1.5 font-normal', patch.state === 'pending' && 'border-need/40 text-need')}><span aria-hidden className={cn('size-1.5 rounded-full', patch.state === 'applied' ? 'bg-ok' : patch.state === 'pending' ? 'bg-need' : 'bg-muted-foreground')} />{t(`planPatch.states.${patch.state}`)}</Badge>
          {patch.appliedRevision !== null && <span className="text-xs text-muted-foreground">{t('planPatch.revision').replace('{revision}', String(patch.appliedRevision))}</span>}
          <time dateTime={patch.createdAt} title={patch.createdAt} className="ml-auto text-xs text-muted-foreground">{relativeTime(patch.createdAt)}</time>
        </div>
        <p className="line-clamp-2 break-words text-sm text-muted-foreground" title={patch.reason}>{patch.reason}</p>
        {patch.refusal && <p className="break-words text-sm text-muted-foreground">{t('planPatch.refused').replace('{reason}', patch.refusal)}</p>}
        {patch.state === 'pending' && <div className="flex gap-2">{(['approve', 'reject'] as const).map(value => <Button key={value} type="button" size="sm" variant={value === 'approve' ? 'default' : 'outline'} disabled={state.session !== 'authenticated' || state.loading[patchDecisionKey(patch.id)]} onClick={() => setDecision({ patch, value })}>{t(`planPatch.${value}`)}</Button>)}</div>}
      </li>)}</ul>
    </CollapsibleContent>
    {decision && <PatchDecision key={`${decision.patch.id}:${decision.value}`} store={store} detail={detail} patch={decision.patch} decision={decision.value} onClose={() => setDecision(null)} />}
  </Collapsible>;
}
