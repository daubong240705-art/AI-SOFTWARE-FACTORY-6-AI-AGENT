import { useReducer, useRef, useState } from 'react';
import { credentialsCreatePayloadSchema, credentialsReplacePayloadSchema, type Credential, type GroupSummary } from '@factory/contracts';
import { credentialsCreate, credentialsDelete, credentialsReplace } from '@/api/commands';
import type { ApiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AdminDialog, DialogButtons, Field, useRead } from '../agents/shared';
import { IntegrationError, NameConfirmation, RetryRead, ScopeChoice, scopeName, timestamp, useIntegrationLabels, useIntegrationWrite } from './shared';

type Dialog = { kind: 'create' } | { kind: 'replace' | 'delete'; item: Credential };

function CredentialDialog({ dialog, api, groups, items, close, refresh }: { dialog: Dialog; api: ApiClient; groups: readonly GroupSummary[]; items: readonly Credential[]; close: () => void; refresh: () => void }) {
  const t = useIntegrationLabels();
  const write = useIntegrationWrite();
  const password = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);
  const [valueError, setValueError] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const initial = dialog.kind === 'create' ? undefined : dialog.item;
  const [revision, setRevision] = useState(initial?.revision);
  const current = items.find(item => item.id === initial?.id);
  const removing = dialog.kind === 'delete';
  const title = removing ? t('deleteCredential') : dialog.kind === 'create' ? t('createCredential') : t('replaceNamed', { name: dialog.item.name });
  function submit() {
    if (dialog.kind === 'delete') {
      if (confirmation !== dialog.item.name || revision === undefined) return;
      const item = dialog.item;
      void write.run(() => api.sendIntegrationCommand(credentialsDelete({ id: item.id, expectedRevision: revision })), () => { refresh(); close(); }, 'deleted');
      return;
    }
    const value = password.current?.value ?? '';
    const validValue = credentialsCreatePayloadSchema.shape.value.safeParse(value).success;
    const validName = dialog.kind !== 'create' || credentialsCreatePayloadSchema.shape.name.safeParse(name.trim()).success;
    setNameError(!validName);
    setValueError(!validValue);
    if (password.current) password.current.value = '';
    if (!validName || !validValue) { setValueError(true); return; }
    if (dialog.kind === 'replace') {
      const parsed = credentialsReplacePayloadSchema.safeParse({ id: dialog.item.id, expectedRevision: revision, value });
      if (!parsed.success) return;
      void write.run(() => api.sendIntegrationCommand(credentialsReplace(parsed.data)), () => { refresh(); close(); });
    } else {
      void write.run(() => api.sendIntegrationCommand(credentialsCreate({ name: name.trim(), scopeGroupId: scope, value })), () => { refresh(); close(); });
    }
  }
  return <AdminDialog title={title} description={removing ? t('deleteCredentialHelp', { name: dialog.item.name }) : t('secretHelp')} close={close} busy={write.busy} onSubmit={submit}
    footer={<DialogButtons close={close} label={removing ? t('delete') : t('save')} busy={write.busy} destructive={removing} disabled={(removing && confirmation !== dialog.item.name) || !!initial && (write.conflict || !current)} />}>
    {dialog.kind === 'create' && <>
      <Field label={t('name')} invalid={nameError ? t('invalid.field') : undefined}>{props => <Input {...props} value={name} onChange={event => setName(event.target.value)} maxLength={160} required />}</Field>
      <ScopeChoice groups={groups} value={scope} set={setScope} />
    </>}
    {removing ? <NameConfirmation name={dialog.item.name} value={confirmation} set={setConfirmation} />
      : <Field label={t('secretValue')} invalid={valueError ? t('secretRequired') : undefined}>{props => <Input {...props} ref={password} type="password" autoComplete="new-password" spellCheck={false} maxLength={8192} required />}</Field>}
    <IntegrationError error={write.error} />
    {initial && write.conflict && <Button type="button" variant="outline" disabled={write.busy} onClick={() => {
      void write.run(async () => {
        const result = await api.listCredentials();
        const latest = result.credentials.find(item => item.id === initial.id);
        setRevision(latest?.revision);
      }, () => { refresh(); setConfirmation(''); }, 'reloaded');
    }}>{t('reloadRevision')}</Button>}
    {initial && !current && <p role="status" className="text-sm text-muted-foreground">{t('notFound')}</p>}
  </AdminDialog>;
}

export function Credentials({ api, groups }: { api: ApiClient; groups: readonly GroupSummary[] }) {
  const t = useIntegrationLabels();
  const [attempt, refresh] = useReducer((value: number) => value + 1, 0);
  const read = useRead(api.listCredentials, attempt);
  const items = read.data?.credentials ?? [];
  const [dialog, setDialog] = useState<Dialog | null>(null);
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t('credentials')}</h2>
      <Button type="button" onClick={() => setDialog({ kind: 'create' })}>{t('createCredential')}</Button></div>
    <RetryRead error={read.error} loading={read.loading} retry={refresh} />
    {read.data && items.length === 0 && <p className="text-sm text-muted-foreground">{t('noCredentials')}</p>}
    <ul className="grid gap-2">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card/60 p-3">
      <div className="min-w-0"><p className="break-words font-medium">{item.name}</p><p className="break-words text-sm text-muted-foreground">{scopeName(groups, item.scopeGroupId, t)} · <span className="font-mono">{'\u2022\u2022\u2022\u2022'}{item.last4}</span> · {t('updated')} <time dateTime={item.updatedAt}>{timestamp(item.updatedAt)}</time></p></div>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setDialog({ kind: 'replace', item })}>{t('replaceCredential')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setDialog({ kind: 'delete', item })}>{t('delete')}</Button></div>
    </li>)}</ul>
    {dialog && <CredentialDialog dialog={dialog} api={api} groups={groups} items={items} close={() => setDialog(null)} refresh={refresh} />}
  </section>;
}
