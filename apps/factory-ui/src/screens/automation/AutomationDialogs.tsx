import { useRef } from 'react';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { MonitorForm } from './MonitorForm';
import { RuleForm } from './RuleForm';
import { ScheduleForm } from './ScheduleForm';
import { rowCommand } from './RowActions';
import { pendingKey, type Editor, type Target } from './types';

export function AutomationEditor({ editor, store, projectId, onClose }: {
  editor: Editor; store: Store; projectId: string; onClose: () => void;
}) {
  const common = { store, projectId, onClose };
  if (editor.area === 'schedules') return <ScheduleForm {...common} {...(editor.item ? { item: editor.item } : {})} />;
  if (editor.area === 'rules') return <RuleForm {...common} {...(editor.item ? { item: editor.item } : {})} />;
  return <MonitorForm {...common} {...(editor.item ? { item: editor.item } : {})} />;
}
export function AutomationConfirmation({ target, action, store, projectId, onClose }: {
  target: Target; action: 'delete' | 'run-now'; store: Store; projectId: string; onClose: () => void;
}) {
  const t = useT(); const inFlight = useRef(false); const key = pendingKey(target.area, target.item.id);
  const { busy, error } = store.useStoreSelector(s => ({ busy: s.loading[key], error: s.errors[key] }));
  const run = action === 'run-now';
  async function confirm() {
    if (inFlight.current || busy) return;
    const command = rowCommand(target, projectId, action);
    if (!command) return;
    inFlight.current = true;
    try {
      const result = await store.sendAutomation(command);
      if (result || store.getState().errors[key]?.code === 'conflict') onClose();
    } finally { inFlight.current = false; }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy && !inFlight.current) onClose(); }}><DialogContent showCloseButton={false} className="rounded-xl border-border bg-card">
    <DialogHeader><DialogTitle className="font-display text-xl">{t(run ? 'automationWrite.runTitle' : 'automationWrite.deleteTitle')}</DialogTitle><DialogDescription className="break-words">{t(run ? 'automationWrite.runHelp' : 'automationWrite.deleteHelp').replace('{name}', target.item.name)}</DialogDescription></DialogHeader>
    {error && <ErrorNotice error={error} />}
    <DialogFooter><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={onClose}>{t('automationWrite.cancel')}</Button><Button type="button" disabled={Boolean(busy)} onClick={() => { void confirm(); }}>{t(run ? 'automationWrite.runNow' : 'automationWrite.delete')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
