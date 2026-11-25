import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { hasUnsavedFlowDraft } from '../shell/navigation';
import { SetupDialog } from './SetupDialog';

export default function FlowSetupAction({ projectId, flowId }: { projectId: string; flowId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  return <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b px-4 py-2">
    {unsaved && <p role="alert" className="text-sm text-destructive">{t('setupProposalUi.editFlowHelp')}</p>}
    <Button variant="outline" size="sm" data-testid="setup-edit-flow" onClick={() => {
      const dirty = hasUnsavedFlowDraft(); setUnsaved(dirty); if (!dirty) setOpen(true);
    }}>{t('setupProposalUi.editFlow')}</Button>
    {open && <SetupDialog projectId={projectId} target={{ mode: 'flow', flowId }} close={() => setOpen(false)} />}
  </div>;
}
