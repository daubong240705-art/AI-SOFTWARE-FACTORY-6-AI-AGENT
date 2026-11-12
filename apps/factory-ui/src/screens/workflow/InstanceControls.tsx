import { useId, useState, type ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { workflowsCancel, workflowsPause, workflowsResume, workflowsStart } from '@/api/commands';
import type { WorkflowDetail } from '@/api/m5Models';
import type { Store } from '@/state/store';
import { useT } from '@/i18n';
import { useM3Command } from '../M3Shared';
import { M5Status } from '../M5Shared';

export function InstanceControls({ store, projectId, instance, liveChip }: { store: Store; projectId: string; instance: WorkflowDetail; liveChip?: ReactNode }) {
  const t = useT(); const id = useId(); const session = store.useStoreSelector(state => state.session);
  const [pauseOpen, setPauseOpen] = useState(false); const [cancelOpen, setCancelOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState(''); const [cancelReason, setCancelReason] = useState('');
  const command = useM3Command(store, store.loadWorkflows, () => { setPauseOpen(false); setCancelOpen(false); setPauseReason(''); setCancelReason(''); });
  const terminal = ['completed', 'failed', 'cancelled', 'superseded', 'unknown'].includes(instance.state);
  const disabled = command.busy || session !== 'authenticated' || instance.revision === undefined;
  const canStart = ['draft', 'proposed'].includes(instance.state); const canPause = ['active', 'resuming', 'stalled'].includes(instance.state);
  function run(action: 'start' | 'pause' | 'resume' | 'cancel') {
    if (disabled || instance.revision === undefined) return;
    const args = { projectId, instanceId: instance.id, expectedRevision: instance.revision };
    if (action === 'start' && canStart) void command.run(workflowsStart(args));
    if (action === 'resume' && instance.state === 'paused') void command.run(workflowsResume(args));
    if (action === 'pause' && canPause && pauseReason.trim()) void command.run(workflowsPause({ ...args, reason: pauseReason.trim() }));
    if (action === 'cancel' && !terminal && cancelReason.trim()) void command.run(workflowsCancel({ ...args, reason: cancelReason.trim() }));
  }
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <div role="group" aria-label={t('workflowUi.detail')} className="flex flex-wrap items-center gap-2">
      <M5Status value={instance.state} />
      {liveChip}
      {canStart && <Button type="button" size="sm" disabled={disabled} onClick={() => run('start')}><Play />{t('workflowGraph.start')}</Button>}
      {canPause && <Popover open={pauseOpen} onOpenChange={open => { setPauseOpen(open); if (open) setCancelOpen(false); }}><PopoverTrigger asChild><Button type="button" variant="outline" size="sm" disabled={disabled}><Pause />{t('workflowGraph.pause')}</Button></PopoverTrigger><PopoverContent align="start" className="w-80 space-y-3 border-border bg-card">
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); run('pause'); }}><Label htmlFor={`${id}-pause`}>{t('workflowGraph.reason')}</Label><Textarea id={`${id}-pause`} required maxLength={500} rows={3} value={pauseReason} disabled={command.busy} onChange={event => setPauseReason(event.target.value)} /><Button type="submit" size="sm" disabled={disabled || !pauseReason.trim()}>{t('workflowGraph.confirm')}</Button></form>
      </PopoverContent></Popover>}
      {instance.state === 'paused' && <Button type="button" size="sm" disabled={disabled} onClick={() => run('resume')}><Play />{t('workflowGraph.resume')}</Button>}
      {!terminal && <Popover open={cancelOpen} onOpenChange={open => { setCancelOpen(open); if (open) setPauseOpen(false); }}><PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className="text-info" disabled={disabled}>{t('workflowGraph.cancel')}</Button></PopoverTrigger><PopoverContent align="start" className="w-80 space-y-3 border-border bg-card">
        <p className="text-sm text-muted-foreground">{t('workflowGraph.cancelExplanation')}</p>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); run('cancel'); }}><Label htmlFor={`${id}-cancel`}>{t('workflowGraph.reason')}</Label><Textarea id={`${id}-cancel`} required maxLength={500} rows={3} value={cancelReason} disabled={command.busy} onChange={event => setCancelReason(event.target.value)} />
          <div className="flex flex-wrap gap-2"><Button type="submit" variant="outline" size="sm" className="text-info" disabled={disabled || !cancelReason.trim()}>{t('workflowGraph.cancel')}</Button><Button type="button" variant="ghost" size="sm" disabled={command.busy} onClick={() => { setCancelOpen(false); setCancelReason(''); }}>{t('workflowGraph.back')}</Button></div></form>
      </PopoverContent></Popover>}
    </div>
    {instance.revision === undefined && !terminal && <p className="text-sm text-muted-foreground">{t('workflowGraph.revisionUnavailable')}</p>}
    {command.notice}
  </div>;
}
