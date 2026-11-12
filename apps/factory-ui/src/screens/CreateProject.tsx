import { useId, useRef, useState, type FormEvent } from 'react';
import type { Command } from '@factory/contracts';
import { projectsCreate } from '../api/commands';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { Dialog } from '../components/Dialog';
import { ErrorNotice } from '../components/ErrorNotice';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { DialogFooter, DialogHeader, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Folder, FolderOpen, GitBranch } from 'lucide-react';
import { FolderPicker } from './projects/FolderPicker';

type ValidationErrors = { name?: string; root?: string };
function invalidFields(error: unknown): ValidationErrors {
  const errors: ValidationErrors = {};
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
    for (const issue of error.issues as unknown[]) {
      if (!issue || typeof issue !== 'object' || !('path' in issue) || !Array.isArray(issue.path)) continue;
      if (issue.path.includes('name')) errors.name = 'validation.projectName';
      if (issue.path.includes('root')) errors.root = 'validation.workspacePath';
    }
  }
  return Object.keys(errors).length ? errors : { name: 'validation.projectName' };
}

export function CreateProject({ store, onClose, onCreated }: { store: Store; onClose: () => void; onCreated?: (id: string) => void }) {
  const t = useT(); const titleId = useId();
  const [name, setName] = useState(''); const [root, setRoot] = useState('');
  const [kind, setKind] = useState<'directory' | 'git'>('directory');
  const [pickerOpen, setPickerOpen] = useState(false);
  const rootInput = useRef<HTMLInputElement>(null);
  const browseButton = useRef<HTMLButtonElement>(null);
  const [errors, setErrors] = useState<ValidationErrors>({}); const [command, setCommand] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const pending = store.useStoreSelector(state => command ? state.pending[command.commandId] : undefined);
  async function execute(created: Command, retry = false) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true);
    try {
      const result = await (retry ? store.retry(created.commandId) : store.send(created));
      if (result && store.getState().session === 'authenticated') {
        await store.loadProjects();
        if (store.getState().session === 'authenticated') { onCreated ? onCreated(created.projectId) : void store.selectProject(created.projectId); onClose(); }
      }
    } finally { inFlight.current = false; setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current || command) return;
    let created: Command;
    try { created = projectsCreate({ name: name.trim(), root, kind }); }
    catch (error) { setErrors(invalidFields(error)); return; }
    setErrors({}); setCommand(created); void execute(created);
  }
  const unsafePath = /^\/mnt\//i.test(root.trim()) || /^[A-Za-z]:/.test(root.trim());
  return <Dialog labelledBy={titleId} onClose={onClose}>
    <DialogHeader className="gap-2 text-left"><DialogTitle id={titleId} className="font-display text-2xl">{t('ux5.createTitle')}</DialogTitle><DialogDescription>{t('ux5.createDescription')}</DialogDescription></DialogHeader>
    <form className="mt-2 space-y-6" onSubmit={submit} noValidate>
      <Field><FieldLabel htmlFor={`${titleId}-name`}>{t('projects.name')}</FieldLabel><Input id={`${titleId}-name`} value={name} disabled={!!command} aria-invalid={!!errors.name} aria-describedby={errors.name ? `${titleId}-name-error` : undefined} onChange={event => setName(event.target.value)} />{errors.name && <FieldError id={`${titleId}-name-error`}>{t(errors.name)}</FieldError>}</Field>
      <fieldset disabled={!!command} className="grid gap-3 border-0 p-0"><legend className="mb-3 text-sm font-medium">{t('inboxUi.workspaceKind')}</legend>
        <RadioGroup value={kind} onValueChange={value => setKind(value as typeof kind)} className="grid grid-cols-2 gap-3" aria-label={t('inboxUi.workspaceKind')}>
          {(['directory', 'git'] as const).map(value => <Label key={value} htmlFor={`${titleId}-${value}`} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition-colors', kind === value ? 'border-ring bg-secondary' : 'border-border hover:bg-secondary/50')}>
            <RadioGroupItem id={`${titleId}-${value}`} value={value} className="mt-0.5" />
            <span className="grid gap-2"><span className="flex flex-wrap items-center gap-2 font-medium">{value === 'directory' ? <Folder className="size-4" /> : <GitBranch className="size-4" />}{t(`ux5.${value}`)}</span><span className="text-xs font-normal leading-relaxed text-muted-foreground">{t(`ux5.${value}Description`)}</span></span>
          </Label>)}
        </RadioGroup>
      </fieldset>
      <Field>
        <FieldLabel htmlFor={`${titleId}-root`}>{t('projects.root')}</FieldLabel>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input ref={rootInput} id={`${titleId}-root`} value={root} disabled={!!command} placeholder={t('projects.rootPlaceholder')}
            className="min-w-0 flex-1 font-mono" aria-invalid={!!errors.root}
            aria-describedby={`${titleId}-root-hint${errors.root ? ` ${titleId}-root-error` : ''}`} onChange={event => setRoot(event.target.value)} />
          <Button ref={browseButton} type="button" variant="outline" disabled={!!command} aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={() => setPickerOpen(true)}>
            <FolderOpen aria-hidden="true" />{t('folderPicker.open')}
          </Button>
        </div>
        <FieldDescription id={`${titleId}-root-hint`}>{t(`ux5.${kind}PathHint`)}</FieldDescription>
        {unsafePath && <Alert className="border-info/30 bg-info/10"><AlertDescription className="text-info">{t('ux5.pathWarning')}</AlertDescription></Alert>}
        {errors.root && <FieldError id={`${titleId}-root-error`}>{t(errors.root)}</FieldError>}
      </Field>
      {pending?.error && <ErrorNotice error={pending.error} />}
      <DialogFooter className="-mx-6 border-t border-border px-6 pt-4"><Button type="button" variant="ghost" onClick={onClose}>{t('actions.cancel')}</Button>{pending?.status === 'failed' && command ? <Button type="button" disabled={busy} onClick={() => { void execute(command, true); }}>{t('errors.retry')}</Button> : <Button type="submit" disabled={busy || !!command}>{t('projects.create')}</Button>}</DialogFooter>
    </form>
    {pickerOpen && <FolderPicker initialPath={root} browseFolders={store.browseFolders}
      onClose={() => setPickerOpen(false)}
      onChoose={(path, isGit) => { setRoot(path); if (isGit) setKind('git'); setErrors(previous => { const { root: _root, ...rest } = previous; return rest; }); setPickerOpen(false); }}
      onReturnFocus={chosen => { (chosen ? rootInput.current : browseButton.current)?.focus(); }} />}
  </Dialog>;
}
