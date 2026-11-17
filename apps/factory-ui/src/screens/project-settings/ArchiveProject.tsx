import { useId, useRef, useState } from 'react';
import type { Command } from '@factory/contracts';
import { toast } from 'sonner';
import { projectsArchive } from '@/api/commands';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/Dialog';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ErrorNotice';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';
import { useNavigation } from '../shell/navigation';

export function ArchiveProject({ store, projectId }: { store: Store; projectId: string }) {
  const t = useT(), id = useId(), navigation = useNavigation();
  const project = store.useStoreSelector(state => state.projects.find(item => item.id === projectId));
  const [open, setOpen] = useState(false), [confirmName, setConfirmName] = useState('');
  const [command, setCommand] = useState<Command | null>(null), [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = store.useStoreSelector(state => command ? state.pending[command.commandId] : undefined);
  async function archive(retry = false) {
    if (!project || confirmName !== project.name || inFlight.current) return;
    const sent = retry && command ? command : projectsArchive({ projectId, expectedRevision: project.revision, confirmName });
    inFlight.current = true; setBusy(true); setCommand(sent);
    try {
      const result = await (retry ? store.retry(sent.commandId) : store.send(sent));
      if (result) {
        if (result.receipt.message) toast.info(result.receipt.message);
        await store.loadProjects(); store.clearProject(); setOpen(false); navigation.navigate('overview');
      } else if (store.getState().pending[sent.commandId]?.error?.code === 'conflict') await store.loadProjects();
    } finally { inFlight.current = false; setBusy(false); }
  }
  if (!project) return null;
  return <section className="rounded-xl border border-destructive/30 p-5">
    <h2 className="font-display text-lg">{t('projectArchive.title')}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{t('projectArchive.description')}</p>
    <Button className="mt-4" variant="destructive" type="button" onClick={() => { setConfirmName(''); setCommand(null); setOpen(true); }}>{t('projectArchive.open')}</Button>
    {open && <Dialog labelledBy={`${id}-title`} onClose={() => { if (!inFlight.current) setOpen(false); }}>
      <DialogHeader><DialogTitle id={`${id}-title`}>{t('projectArchive.open')}</DialogTitle><DialogDescription>{t('projectArchive.details')}</DialogDescription></DialogHeader>
      <form className="mt-5 space-y-5" aria-busy={busy} onSubmit={event => { event.preventDefault(); void archive(pending?.status === 'failed' && ['network', 'bad-response'].includes(pending.error?.kind ?? '')); }}>
        <Field><FieldLabel htmlFor={`${id}-name`}>{t('projectArchive.confirm').replace('{name}', project.name)}</FieldLabel><Input id={`${id}-name`} autoComplete="off" value={confirmName} disabled={busy} onChange={event => { setConfirmName(event.target.value); setCommand(null); }} autoFocus /></Field>
        {pending?.error && <ErrorNotice error={pending.error} />}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>{t('actions.cancel')}</Button><Button type="submit" variant="destructive" disabled={busy || confirmName !== project.name}>{busy ? t('projectArchive.archiving') : pending?.status === 'failed' ? t('errors.retry') : t('projectArchive.open')}</Button></DialogFooter>
      </form>
    </Dialog>}
  </section>;
}
