import { useId, useRef, type FormEvent } from 'react';
import { useT } from '../i18n';
import type { Store } from '../state/store';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { ErrorNotice } from '../components/ErrorNotice';

export function SignIn({ store }: { store: Store }) {
  const t = useT();
  const state = store.useStoreSelector((value) => value);
  const explanation = useId();
  const submitting = useRef(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem('token');
    if (!(input instanceof HTMLInputElement)) return;
    const token = input.value;
    input.value = '';
    if (submitting.current || state.loading.session) return;
    submitting.current = true;
    void store.signIn(token).finally(() => { submitting.current = false; });
  }
  return <main className="signin"><Card>
    <h1>{t('shell.product')}</h1>
    <h2>{t('auth.signIn')}</h2>
    <p id={explanation} className="muted">{t('auth.explanation')}</p>
    <form className="stack" onSubmit={submit}>
      <Field label={t('auth.token')} name="token" type="password" autoComplete="off" spellCheck={false} aria-describedby={explanation} disabled={!!state.loading.session} />
      <Button variant="primary" type="submit" disabled={!!state.loading.session}>{t('auth.signIn')}</Button>
    </form>
    {state.errors.session && <ErrorNotice error={state.errors.session} />}
  </Card></main>;
}
