import { useId, useRef, useState, type FormEvent } from 'react';
import type { Command } from '@factory/contracts';
import { nextTaskCode, tasksCreate } from '../api/commands';
import type { Store } from '../state/store';
import { useT } from '../i18n';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorNotice } from '../components/ErrorNotice';
import { Field } from '../components/Field';

type FormErrors = { title?: boolean; goal?: boolean; acceptance?: boolean };
export function NewTask({ store, projectId, open: controlledOpen, formId }: { store: Store; projectId: string; open?: boolean; formId?: string }) {
  const t = useT();
  const state = store.useStoreSelector((value) => value);
  const id = useId();
  const [localOpen, setOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [command, setCommand] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = command ? state.pending[command.commandId] : undefined;
  const conflict = pending?.error?.code === 'conflict';
  const code = nextTaskCode(state.tasks);
  async function execute(created: Command, retry = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await (retry ? store.retry(created.commandId) : store.send(created));
      if (result && store.getState().session === 'authenticated') {
        await store.loadTasks(); setTitle(''); setGoal(''); setAcceptance(''); setCommand(null); setErrors({});
      } else if (store.getState().pending[created.commandId]?.error?.code === 'conflict') await store.loadTasks();
    } finally { inFlight.current = false; setBusy(false); }
  }
  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (inFlight.current || state.session !== 'authenticated' || (command && !conflict)) return;
    const criteria = acceptance.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const invalid: FormErrors = {};
    if (!title.trim() || title.trim().length > 160) invalid.title = true;
    if (!goal.trim() || goal.trim().length > 500) invalid.goal = true;
    if (!criteria.length || criteria.length > 30 || criteria.some((line) => line.length > 500)) invalid.acceptance = true;
    setErrors(invalid);
    if (Object.keys(invalid).length) return;
    const created = tasksCreate({ projectId, code: nextTaskCode(store.getState().tasks), title: title.trim(), goal: goal.trim(), acceptance: criteria });
    setCommand(created); void execute(created);
  }
  return <Card className={open ? 'new-task-form' : 'new-task-closed'}>
    {controlledOpen === undefined && <Button aria-expanded={open} aria-controls={formId ?? `${id}-form`} onClick={() => setOpen(!open)}>{t('taskUi.new')}</Button>}
    {open && <form id={formId ?? `${id}-form`} className="stack" onSubmit={submit} noValidate>
      <p>{t('taskUi.code')}: {code}</p>
      <Field label={t('taskUi.title')} value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} error={errors.title ? t('taskUi.validation.title') : undefined} />
      <div className="field"><label htmlFor={`${id}-goal`}>{t('taskUi.goal')}</label><textarea id={`${id}-goal`} rows={3} value={goal} disabled={busy} onChange={(event) => setGoal(event.target.value)} aria-invalid={errors.goal || undefined} aria-describedby={errors.goal ? `${id}-goal-error` : undefined} />
        {errors.goal && <p className="field-error" id={`${id}-goal-error`}>{t('taskUi.validation.goal')}</p>}
      </div>
      <div className="field"><label htmlFor={`${id}-acceptance`}>{t('taskUi.acceptance')}</label><textarea id={`${id}-acceptance`} rows={4} value={acceptance} disabled={busy} onChange={(event) => setAcceptance(event.target.value)} aria-invalid={errors.acceptance || undefined} aria-describedby={`${id}-help${errors.acceptance ? ` ${id}-acceptance-error` : ''}`} />
        <p className="muted" id={`${id}-help`}>{t('taskUi.acceptanceHelp')}</p>
        {errors.acceptance && <p className="field-error" id={`${id}-acceptance-error`}>{t('taskUi.validation.acceptance')}</p>}
      </div>
      {pending?.error && <ErrorNotice error={pending.error} />}
      {pending?.status === 'failed' && command ? <Button disabled={busy || state.session !== 'authenticated'} onClick={() => { if (conflict) submit(); else void execute(command, true); }}>{t(conflict ? 'taskUi.retryNew' : 'errors.retry')}</Button>
        : <Button variant="primary" type="submit" disabled={busy || !!command || state.session !== 'authenticated'}>{t('taskUi.create')}</Button>}
    </form>}
  </Card>;
}
