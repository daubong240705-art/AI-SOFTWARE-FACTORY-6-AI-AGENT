import { MoreHorizontal, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import * as commands from '@/api/commands';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { pendingKey, type Target } from './types';

export function rowCommand(target: Target, projectId: string, action: 'pause' | 'resume' | 'delete' | 'run-now') {
  const expectedRevision = target.item.revision;
  if (expectedRevision === undefined) return;
  if (target.area === 'schedules') {
    const input = { projectId, scheduleId: target.item.id, expectedRevision };
    return action === 'run-now' ? commands.schedulesRunNow(input) : action === 'delete' ? commands.schedulesDelete(input)
      : action === 'pause' ? commands.schedulesPause(input) : commands.schedulesResume(input);
  }
  if (target.area === 'rules') {
    const input = { projectId, ruleId: target.item.id, expectedRevision };
    return action === 'delete' ? commands.rulesDelete(input) : action === 'pause' ? commands.rulesPause(input) : commands.rulesResume(input);
  }
  const input = { projectId, monitorId: target.item.id, expectedRevision };
  return action === 'delete' ? commands.monitorsDelete(input) : action === 'pause' ? commands.monitorsPause(input) : commands.monitorsResume(input);
}
export function RowActions({ target, store, projectId, onEdit, onConfirm }: {
  target: Target; store: Store; projectId: string; onEdit: (target: Target) => void;
  onConfirm: (target: Target, action: 'delete' | 'run-now') => void;
}) {
  const t = useT();
  const busy = store.useStoreSelector(s => s.loading[pendingKey(target.area, target.item.id)]);
  const disabled = Boolean(busy) || target.item.revision === undefined;
  const paused = target.item.state !== 'active';
  async function toggle() {
    const command = rowCommand(target, projectId, paused ? 'resume' : 'pause');
    if (command) await store.sendAutomation(command);
  }
  return <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label={t('automationWrite.actions')} disabled={disabled} title={target.item.revision === undefined ? t('automationWrite.revisionMissing') : undefined}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="rounded-lg border-border">
      {target.area === 'schedules' && <DropdownMenuItem disabled={disabled} onSelect={() => onConfirm(target, 'run-now')}><Play />{t('automationWrite.runNow')}</DropdownMenuItem>}
      <DropdownMenuItem disabled={disabled} onSelect={() => { void toggle(); }}>{paused ? <Play /> : <Pause />}{t(paused ? 'automationWrite.resume' : 'automationWrite.pause')}</DropdownMenuItem>
      <DropdownMenuItem disabled={disabled} onSelect={() => onEdit(target)}><Pencil />{t('automationWrite.edit')}</DropdownMenuItem>
      <DropdownMenuSeparator /><DropdownMenuItem disabled={disabled} onSelect={() => onConfirm(target, 'delete')}><Trash2 />{t('automationWrite.delete')}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
export function RowError({ store, target }: { store: Store; target: Target }) {
  const error = store.useStoreSelector(s => s.errors[pendingKey(target.area, target.item.id)]);
  return error ? <div className="pt-2"><ErrorNotice error={error} /></div> : null;
}
