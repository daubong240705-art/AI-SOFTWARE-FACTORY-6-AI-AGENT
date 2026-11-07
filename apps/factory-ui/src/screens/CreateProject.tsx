import { useId, useRef, useState, type FormEvent } from 'react';
import type { Command } from '@factory/contracts';
import { projectsCreate } from '../api/commands';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { ErrorNotice } from '../components/ErrorNotice';

type ValidationErrors = { name?: string; root?: string };
// Read only the contract's issue paths; never expose input values or raw exceptions.
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

export function CreateProject({ store, onClose }: { store: Store; onClose: () => void }) {
  const t = useT();
  const titleId = useId();
  const [name, setName] = useState('');
  const [root, setRoot] = useState('');
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [command, setCommand] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = store.useStoreSelector((state) => command ? state.pending[command.commandId] : undefined);
  async function execute(created: Command, retry = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await (retry ? store.retry(created.commandId) : store.send(created));
      if (result && store.getState().session === 'authenticated') {
        await store.loadProjects();
        if (store.getState().session === 'authenticated') { void store.selectProject(created.projectId); onClose(); }
      }
    } finally { inFlight.current = false; setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || command) return;
    let created: Command;
    try { created = projectsCreate({ name: name.trim(), root }); }
    catch (error) { setErrors(invalidFields(error)); return; }
    setErrors({}); setCommand(created); void execute(created);
  }
  return <Dialog labelledBy={titleId} onClose={onClose}>
    <h2 id={titleId}>{t('projects.create')}</h2>
    <form className="stack" onSubmit={submit} noValidate>
      <Field label={t('projects.name')} value={name} onChange={(event) => setName(event.target.value)} disabled={!!command} error={errors.name ? t(errors.name) : undefined} />
      <Field label={t('projects.root')} value={root} onChange={(event) => setRoot(event.target.value)} placeholder={t('projects.rootPlaceholder')} disabled={!!command} error={errors.root ? t(errors.root) : undefined} />
      {pending?.error && <ErrorNotice error={pending.error} />}
      <div className="dialog-actions">
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        {pending?.status === 'failed' && command ? <Button variant="primary" disabled={busy} onClick={() => { void execute(command, true); }}>{t('errors.retry')}</Button>
          : <Button variant="primary" type="submit" disabled={busy || !!command}>{t('actions.create')}</Button>}
      </div>
    </form>
  </Dialog>;
}
