import { useId, useRef, useState, type FormEvent } from 'react';
import type { Command } from '@factory/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { nextTaskCode, tasksCreate } from '../api/commands';
import type { Store } from '../state/store';
import { useT } from '../i18n';
import { ErrorNotice } from '../components/ErrorNotice';

type FormErrors = { title?: boolean; goal?: boolean; acceptance?: boolean };
export function NewTask({ store, projectId, open: controlledOpen, formId }: { store: Store; projectId: string; open?: boolean; formId?: string }) {
  const t = useT(); const state = store.useStoreSelector(value => value); const id = useId();
  const [localOpen, setOpen] = useState(false); const open = controlledOpen ?? localOpen;
  const [title, setTitle] = useState(''); const [goal, setGoal] = useState(''); const [acceptance, setAcceptance] = useState('');
  const [errors, setErrors] = useState<FormErrors>({}); const [command, setCommand] = useState<Command | null>(null); const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const pending = command ? state.pending[command.commandId] : undefined; const conflict = pending?.error?.code === 'conflict'; const code = nextTaskCode(state.tasks);
  async function execute(created: Command, retry = false) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true);
    try { const result = await (retry ? store.retry(created.commandId) : store.send(created));
      if (result && store.getState().session === 'authenticated') { await store.loadTasks(); setTitle(''); setGoal(''); setAcceptance(''); setCommand(null); setErrors({}); }
      else if (store.getState().pending[created.commandId]?.error?.code === 'conflict') await store.loadTasks();
    } finally { inFlight.current = false; setBusy(false); }
  }
  function submit(event?: FormEvent) {
    event?.preventDefault(); if (inFlight.current || state.session !== 'authenticated' || (command && !conflict)) return;
    const criteria = acceptance.split(/\r?\n/).map(line => line.trim()).filter(Boolean); const invalid: FormErrors = {};
    if (!title.trim() || title.trim().length > 160) invalid.title = true; if (!goal.trim() || goal.trim().length > 500) invalid.goal = true;
    if (!criteria.length || criteria.length > 30 || criteria.some(line => line.length > 500)) invalid.acceptance = true;
    setErrors(invalid); if (Object.keys(invalid).length) return;
    const created = tasksCreate({ projectId, code: nextTaskCode(store.getState().tasks), title: title.trim(), goal: goal.trim(), acceptance: criteria }); setCommand(created); void execute(created);
  }
  return <Card className={cn('border-border shadow-none', open ? 'gap-0' : 'gap-0 p-0')}>
    {controlledOpen === undefined && <CardHeader className="p-4"><Button type="button" variant="outline" className="self-start" aria-expanded={open} aria-controls={formId ?? `${id}-form`} onClick={() => setOpen(!open)}>{t('taskUi.new')}</Button></CardHeader>}
    {open && <form id={formId ?? `${id}-form`} onSubmit={submit} noValidate>
      <CardHeader className="gap-1 border-b border-border px-5 py-4"><CardTitle className="font-display text-lg">{t('taskUi.new')}</CardTitle><p className="font-mono text-xs text-muted-foreground">{t('taskUi.code')}: {code}</p></CardHeader>
      <CardContent className="grid gap-4 px-5 py-5">
        <Field data-invalid={errors.title || undefined}><FieldLabel htmlFor={`${id}-title`}>{t('taskUi.title')}</FieldLabel><Input id={`${id}-title`} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} aria-invalid={errors.title || undefined} aria-describedby={`${id}-title-hint${errors.title ? ` ${id}-title-error` : ''}`} /><FieldDescription id={`${id}-title-hint`}>{t('ux4.titleHint')}</FieldDescription>{errors.title && <FieldError id={`${id}-title-error`}>{t('taskUi.validation.title')}</FieldError>}</Field>
        <Field data-invalid={errors.goal || undefined}><FieldLabel htmlFor={`${id}-goal`}>{t('taskUi.goal')}</FieldLabel><Textarea id={`${id}-goal`} rows={3} value={goal} disabled={busy} onChange={event => setGoal(event.target.value)} aria-invalid={errors.goal || undefined} aria-describedby={`${id}-goal-hint${errors.goal ? ` ${id}-goal-error` : ''}`} /><FieldDescription id={`${id}-goal-hint`}>{t('ux4.goalHint')}</FieldDescription>{errors.goal && <FieldError id={`${id}-goal-error`}>{t('taskUi.validation.goal')}</FieldError>}</Field>
        <Field data-invalid={errors.acceptance || undefined}><FieldLabel htmlFor={`${id}-acceptance`}>{t('taskUi.acceptance')}</FieldLabel><Textarea id={`${id}-acceptance`} rows={4} value={acceptance} disabled={busy} onChange={event => setAcceptance(event.target.value)} aria-invalid={errors.acceptance || undefined} aria-describedby={`${id}-acceptance-hint${errors.acceptance ? ` ${id}-acceptance-error` : ''}`} /><FieldDescription id={`${id}-acceptance-hint`}>{t('ux4.criteriaHint')}</FieldDescription>{errors.acceptance && <FieldError id={`${id}-acceptance-error`}>{t('taskUi.validation.acceptance')}</FieldError>}</Field>
        {pending?.error && <ErrorNotice error={pending.error} />}
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t border-border px-5 py-4"><Button type="button" variant="ghost" disabled={busy} onClick={() => { setOpen(false); setErrors({}); }}>{t('ux4.cancel')}</Button>{pending?.status === 'failed' && command ? <Button type="button" variant="outline" disabled={busy || state.session !== 'authenticated'} onClick={() => { if (conflict) submit(); else void execute(command, true); }}>{t(conflict ? 'taskUi.retryNew' : 'errors.retry')}</Button> : <Button type="submit" disabled={busy || !!command || state.session !== 'authenticated'}>{t('taskUi.create')}</Button>}</CardFooter>
    </form>}
  </Card>;
}
