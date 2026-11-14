import { useId, useRef, useState, type FormEvent } from 'react';
import { newGameRequestSchema, type NewGameRequest } from '@factory/contracts';
import { ApiClientError } from '@/api/client';
import { Dialog } from '@/components/Dialog';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/i18n';
import type { Store } from '@/state/store';

function gameSlug(name: string) {
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug.length >= 2 ? slug : `${slug || 'game'}-game`;
}

export function NewGameDialog({ store, onClose, onCreated }: { store: Store; onClose: () => void; onCreated: (id: string) => void }) {
  const t = useT(); const id = useId();
  const [name, setName] = useState(''); const [gameId, setGameId] = useState(''); const [request, setRequest] = useState('');
  const [idEdited, setIdEdited] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof NewGameRequest, boolean>>>({});
  const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    const parsed = newGameRequestSchema.safeParse({ name: name.trim(), gameId: gameId.trim(), request: request.trim() });
    setProblem('');
    if (!parsed.success) {
      const invalid: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'name' || key === 'gameId' || key === 'request') invalid[key] = true;
      }
      setErrors(invalid); return;
    }
    setErrors({}); inFlight.current = true; setBusy(true);
    try {
      const created = await store.createGame(parsed.data);
      await store.loadProjects();
      if (store.getState().session === 'authenticated') { onClose(); onCreated(created.projectId); }
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) { setErrors({ gameId: true }); setProblem('gameUi.exists'); }
      else if (error instanceof ApiClientError && error.status === 404) setProblem('gameUi.creationDisabled');
      else if (error instanceof ApiClientError && error.code === 'validation') { setErrors({ name: true, gameId: true, request: true }); setProblem(''); }
      else setProblem('gameUi.createError');
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <Dialog labelledBy={id} onClose={() => { if (!inFlight.current) onClose(); }}>
    <DialogHeader className="gap-2 text-left"><DialogTitle id={id} className="font-display text-2xl">{t('gameUi.newGame')}</DialogTitle><DialogDescription>{t('gameUi.createDescription')}</DialogDescription></DialogHeader>
    <form onSubmit={event => { void submit(event); }} noValidate className="mt-2 space-y-6" aria-busy={busy}>
      <fieldset disabled={busy} className="grid gap-5 border-0 p-0">
        <Field><FieldLabel htmlFor={`${id}-name`}>{t('gameUi.name')}</FieldLabel>
          <Input id={`${id}-name`} value={name} minLength={2} maxLength={60} required aria-invalid={!!errors.name} aria-describedby={errors.name ? `${id}-name-error` : undefined}
            onChange={event => { setName(event.target.value); if (!idEdited) setGameId(gameSlug(event.target.value)); }} />
          {errors.name && <FieldError id={`${id}-name-error`}>{t('gameUi.nameValidation')}</FieldError>}
        </Field>
        <Field><FieldLabel htmlFor={`${id}-gameId`}>{t('gameUi.gameId')}</FieldLabel>
          <Input id={`${id}-gameId`} value={gameId} minLength={2} maxLength={40} pattern="[a-z0-9][a-z0-9-]{1,39}" required aria-invalid={!!errors.gameId}
            aria-describedby={`${id}-pattern${errors.gameId ? ` ${id}-id-error` : ''}`} onChange={event => { setGameId(event.target.value); setIdEdited(true); }} />
          <FieldDescription id={`${id}-pattern`}>{t('gameUi.idPattern')}</FieldDescription>
          {errors.gameId && <FieldError id={`${id}-id-error`}>{t(problem === 'gameUi.exists' ? 'gameUi.exists' : 'gameUi.idValidation')}</FieldError>}
        </Field>
        <Field><FieldLabel htmlFor={`${id}-request`}>{t('gameUi.request')}</FieldLabel>
          <Textarea id={`${id}-request`} value={request} minLength={1} maxLength={500} required className="min-h-28" placeholder={t('gameUi.requestPlaceholder')}
            aria-invalid={!!errors.request} aria-describedby={errors.request ? `${id}-request-error` : undefined} onChange={event => setRequest(event.target.value)} />
          {errors.request && <FieldError id={`${id}-request-error`}>{t('gameUi.requestValidation')}</FieldError>}
        </Field>
      </fieldset>
      {problem && problem !== 'gameUi.exists' && <p role="alert" className="text-sm text-destructive">{t(problem)}</p>}
      <DialogFooter className="-mx-6 border-t border-border px-6 pt-4"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t('actions.cancel')}</Button><Button type="submit" disabled={busy}>{t(busy ? 'gameUi.creating' : 'gameUi.newGame')}</Button></DialogFooter>
    </form>
  </Dialog>;
}
