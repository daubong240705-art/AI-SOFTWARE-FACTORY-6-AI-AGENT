import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Command } from '@factory/contracts';
import type { KnowledgeItem } from '@/api/readModels';
import { Checkbox } from '@/components/ui/checkbox';
import { readableText } from './attention/presentation';
import { isReferenceImage } from './attention/TaskInputs';
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
  const [selection, setSelection] = useState<{ projectId: string; documents: KnowledgeItem[] }>({ projectId, documents: [] });
  const selected = selection.projectId === projectId ? selection.documents : [];
  const knowledge = state.knowledge;
  useEffect(() => {
    if (!open || state.session !== 'authenticated') return;
    store.openKnowledgeList();
    void store.loadKnowledgeList();
    return () => store.closeKnowledgeList();
  }, [store, projectId, open, state.session]);
  const pending = command ? state.pending[command.commandId] : undefined; const conflict = pending?.error?.code === 'conflict'; const code = nextTaskCode(state.tasks);
  async function execute(created: Command, retry = false) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true);
    try { const result = await (retry ? store.retry(created.commandId) : store.send(created));
      if (result && store.getState().session === 'authenticated') { await store.loadTasks(); setSelection({ projectId, documents: [] }); setTitle(''); setGoal(''); setAcceptance(''); setCommand(null); setErrors({}); }
      else if (store.getState().pending[created.commandId]?.error?.code === 'conflict') await store.loadTasks();
    } finally { inFlight.current = false; setBusy(false); }
  }
  function submit(event?: FormEvent) {
    event?.preventDefault(); if (inFlight.current || state.session !== 'authenticated' || (command && !conflict)) return;
    const criteria = acceptance.split(/\r?\n/).map(line => line.trim()).filter(Boolean); const invalid: FormErrors = {};
    if (!title.trim() || title.trim().length > 160) invalid.title = true; if (!goal.trim() || goal.trim().length > 500) invalid.goal = true;
    if (!criteria.length || criteria.length > 30 || criteria.some(line => line.length > 500)) invalid.acceptance = true;
    setErrors(invalid); if (Object.keys(invalid).length) return;
    const created = tasksCreate({ projectId, code: nextTaskCode(store.getState().tasks), title: title.trim(), goal: goal.trim(), acceptance: criteria, inputs: selected.map(document => ({ artifactId: document.artifactId, version: knowledge.list.find(item => item.artifactId === document.artifactId)?.version ?? document.version })) }); setCommand(created); void execute(created);
  }
  return <Card className={cn('border-border shadow-none', open ? 'gap-0' : 'gap-0 p-0')}>
    {controlledOpen === undefined && <CardHeader className="p-4"><Button type="button" variant="outline" className="self-start" aria-expanded={open} aria-controls={formId ?? `${id}-form`} onClick={() => setOpen(!open)}>{t('taskUi.new')}</Button></CardHeader>}
    {open && <form id={formId ?? `${id}-form`} onSubmit={submit} noValidate>
      <CardHeader className="gap-1 border-b border-border px-5 py-4"><CardTitle className="font-display text-lg">{t('taskUi.new')}</CardTitle><p className="font-mono text-xs text-muted-foreground">{t('taskUi.code')}: {code}</p></CardHeader>
      <CardContent className="grid gap-4 px-5 py-5">
        <Field data-invalid={errors.title || undefined}><FieldLabel htmlFor={`${id}-title`}>{t('taskUi.title')}</FieldLabel><Input id={`${id}-title`} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} aria-invalid={errors.title || undefined} aria-describedby={`${id}-title-hint${errors.title ? ` ${id}-title-error` : ''}`} /><FieldDescription id={`${id}-title-hint`}>{t('ux4.titleHint')}</FieldDescription>{errors.title && <FieldError id={`${id}-title-error`}>{t('taskUi.validation.title')}</FieldError>}</Field>
        <Field data-invalid={errors.goal || undefined}><FieldLabel htmlFor={`${id}-goal`}>{t('taskUi.goal')}</FieldLabel><Textarea id={`${id}-goal`} rows={3} value={goal} disabled={busy} onChange={event => setGoal(event.target.value)} aria-invalid={errors.goal || undefined} aria-describedby={`${id}-goal-hint${errors.goal ? ` ${id}-goal-error` : ''}`} /><FieldDescription id={`${id}-goal-hint`}>{t('ux4.goalHint')}</FieldDescription>{errors.goal && <FieldError id={`${id}-goal-error`}>{t('taskUi.validation.goal')}</FieldError>}</Field>
        <Field data-invalid={errors.acceptance || undefined}><FieldLabel htmlFor={`${id}-acceptance`}>{t('taskUi.acceptance')}</FieldLabel><Textarea id={`${id}-acceptance`} rows={4} value={acceptance} disabled={busy} onChange={event => setAcceptance(event.target.value)} aria-invalid={errors.acceptance || undefined} aria-describedby={`${id}-acceptance-hint${errors.acceptance ? ` ${id}-acceptance-error` : ''}`} /><FieldDescription id={`${id}-acceptance-hint`}>{t('ux4.criteriaHint')}</FieldDescription>{errors.acceptance && <FieldError id={`${id}-acceptance-error`}>{t('taskUi.validation.acceptance')}</FieldError>}</Field>
        <fieldset className="min-w-0 space-y-3" aria-describedby={`${id}-inputs-hint`}>
          <legend className="text-sm font-medium">{t('taskInputs.title')}</legend>
          <p id={`${id}-inputs-hint`} className="text-sm text-muted-foreground">{t('taskInputs.help')}</p>
          <p role="status" className="text-xs text-muted-foreground">{t('taskInputs.selected').replace('{count}', String(selected.length))}</p>
          {knowledge.loading.knowledge && <p role="status" className="text-sm text-muted-foreground">{t('viewStates.loading')}</p>}
          {knowledge.errors.knowledge && <div className="space-y-2"><ErrorNotice error={knowledge.errors.knowledge} /><Button type="button" variant="outline" onClick={() => { void store.loadKnowledgeList(); }}>{t('errors.retry')}</Button></div>}
          {!knowledge.loading.knowledge && !knowledge.errors.knowledge && !knowledge.list.length && <p className="text-sm text-muted-foreground">{t('knowledgeUi.empty')}</p>}
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {knowledge.list.map(document => {
              const checked = selected.some(item => item.artifactId === document.artifactId);
              return <label key={document.artifactId} className="flex items-center gap-3 rounded-md border border-border p-3">
                <Checkbox checked={checked} disabled={busy || (!checked && selected.length >= 20)} onCheckedChange={value => setSelection(current => {
                  const documents = current.projectId === projectId ? current.documents : [];
                  return { projectId, documents: value === true ? (documents.some(item => item.artifactId === document.artifactId) || documents.length >= 20 ? documents : [...documents, document]) : documents.filter(item => item.artifactId !== document.artifactId) };
                })} />
                {isReferenceImage(document.mediaType) && <img src={store.rawDocumentUrl(projectId, document.artifactId, document.version)} alt="" loading="lazy" className="size-12 shrink-0 rounded object-contain" />}
                <span className="min-w-0 space-y-1"><span className="block text-sm [overflow-wrap:anywhere]">{readableText(document.title)}</span><span className="block text-xs text-muted-foreground">{t(`knowledgeUi.kinds.${document.kind}`)}</span></span>
              </label>;
            })}
          </div>
          {knowledge.hasMore && <Button type="button" variant="outline" disabled={busy || knowledge.loading.knowledge} onClick={() => { void store.loadKnowledgeMore(); }}>{t('knowledgeUi.more')}</Button>}
        </fieldset>
        {pending?.error && <ErrorNotice error={pending.error} />}
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t border-border px-5 py-4"><Button type="button" variant="ghost" disabled={busy} onClick={() => { setOpen(false); setErrors({}); }}>{t('ux4.cancel')}</Button>{pending?.status === 'failed' && command ? <Button type="button" variant="outline" disabled={busy || state.session !== 'authenticated'} onClick={() => { if (conflict) submit(); else void execute(command, true); }}>{t(conflict ? 'taskUi.retryNew' : 'errors.retry')}</Button> : <Button type="submit" disabled={busy || !!command || state.session !== 'authenticated'}>{t('taskUi.create')}</Button>}</CardFooter>
    </form>}
  </Card>;
}
