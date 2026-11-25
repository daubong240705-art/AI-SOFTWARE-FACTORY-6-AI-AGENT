import { useCallback, useEffect, useReducer, useState } from 'react';
import { Plug } from 'lucide-react';
import type { Integration } from '@factory/contracts';
import { integrationsDelete, integrationsTest } from '@/api/commands';
import { Page } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGroups } from '../groups/GroupsContext';
import { AdminDialog, DialogButtons, useRead } from '../agents/shared';
import { IntegrationEditor } from './IntegrationEditor';
import { Credentials } from './Credentials';
import { IntegrationError, NameConfirmation, RetryRead, scopeName, timestamp, useIntegrationLabels, useIntegrationWrite } from './shared';

type Dialog = { kind: 'create' } | { kind: 'edit' | 'delete'; item: Integration };

function DeleteDialog({ item, current, close, refresh }: { item: Integration; current?: Integration | undefined; close: () => void; refresh: () => void }) {
  const { api } = useGroups();
  const t = useIntegrationLabels();
  const write = useIntegrationWrite();
  const [name, setName] = useState('');
  const [revision, setRevision] = useState(item.revision);
  const renamed = current && current.name !== item.name;
  const stale = !current || !!renamed || current.revision !== revision || write.conflict;
  return <AdminDialog title={t('deleteIntegration')} description={t('deleteIntegrationHelp', { name: item.name })} close={close} busy={write.busy}
    onSubmit={() => { if (!stale && name === item.name) void write.run(() => api.sendIntegrationCommand(integrationsDelete({ id: item.id, expectedRevision: revision })), () => { refresh(); close(); }, 'deleted'); }}
    footer={<DialogButtons close={close} label={t('delete')} busy={write.busy} disabled={stale || name !== item.name} destructive />}>
    <NameConfirmation name={item.name} value={name} set={setName} />
    <IntegrationError error={write.error} />
    {renamed && <p role="alert" className="text-sm text-destructive">{t('renamed')}</p>}
    {stale && !renamed && <Button type="button" variant="outline" disabled={write.busy} onClick={() => {
      void write.run(() => api.getIntegration(item.id).then(result => setRevision(result.integration.revision)), () => { refresh(); setName(''); }, 'reloaded');
    }}>{t('reloadRevision')}</Button>}
  </AdminDialog>;
}

function ConnectionRow({ item, edit, remove, refresh }: { item: Integration; edit: () => void; remove: () => void; refresh: () => void }) {
  const { api, list } = useGroups();
  const t = useIntegrationLabels();
  const write = useIntegrationWrite();
  const [showTools, setShowTools] = useState(false);
  return <li className="grid gap-2 rounded-lg border bg-card/60 p-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="flex flex-wrap items-center gap-2 break-all font-semibold">{item.name} <Badge variant="outline">{t(item.kind)}</Badge></h3>
        <p className="break-words text-sm text-muted-foreground">{scopeName(list.data?.groups ?? [], item.scopeGroupId, t)}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={write.busy || item.status === 'checking'} onClick={() => {
          void write.run(() => api.sendIntegrationCommand(integrationsTest({ id: item.id, expectedRevision: item.revision })), () => setShowTools(true), 'checkStarted').then(refresh);
        }}>{t('test')}</Button>
        <Button type="button" size="sm" variant="outline" disabled={write.busy} onClick={edit}>{t('edit')}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={write.busy} onClick={remove}>{t('delete')}</Button>
      </div>
    </div>
    <p role="status" className="text-sm"><Badge variant={item.status === 'error' ? 'destructive' : 'secondary'}>{t(item.status)}</Badge>
      {item.lastCheck && <> · {t(item.lastCheck.ok ? 'checkOk' : 'checkFailed')}</>}
      {item.lastCheckAt && <> · <time dateTime={item.lastCheckAt}>{timestamp(item.lastCheckAt)}</time></>}
    </p>
    <details open={showTools} onToggle={event => setShowTools(event.currentTarget.open)}><summary className="cursor-pointer text-sm text-muted-foreground">{t('toolCount', { count: String(item.tools.length) })}</summary>
      {item.tools.length ? <ul className="ml-4 list-disc text-sm">{item.tools.map(tool => <li key={tool.name}><code>{tool.name}</code></li>)}</ul> : <p className="text-sm text-muted-foreground">{t('noTools')}</p>}
    </details>
    <IntegrationError error={write.error} />
  </li>;
}

export function Connections({ groupId }: { groupId?: string }) {
  const { api, list, refresh: refreshGroups } = useGroups();
  const t = useIntegrationLabels();
  const [attempt, refresh] = useReducer((value: number) => value + 1, 0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const read = useCallback(async (signal: AbortSignal) => {
    const result = await api.listIntegrations(groupId, signal);
    return groupId ? result.integrations.filter(item => item.scopeGroupId === groupId) : result.integrations;
  }, [api, groupId]);
  const result = useRead(read, attempt);
  const editing = dialog?.kind === 'create' || dialog?.kind === 'edit';
  const credentials = useRead(editing ? api.listCredentials : null, attempt);
  const checking = result.data?.some(item => item.status === 'checking');
  useEffect(() => {
    if (!checking || result.loading || result.error) return;
    const timer = setTimeout(refresh, 1200);
    return () => clearTimeout(timer);
  }, [checking, result.loading, result.error, attempt]);
  const close = () => setDialog(null);
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t('connections')}</h2>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" onClick={refresh}>{t('refresh')}</Button>
        <Button type="button" onClick={() => setDialog({ kind: 'create' })}>{t('createIntegration')}</Button></div></div>
    <RetryRead error={result.error ?? list.error} loading={result.loading && !result.data} retry={() => { refresh(); if (list.error) refreshGroups(); }} />
    {result.data?.length === 0 && <p className="text-sm text-muted-foreground">{t('noConnections')}</p>}
    <ul className="grid gap-2">{result.data?.map(item => <ConnectionRow key={item.id} item={item} refresh={refresh} edit={() => setDialog({ kind: 'edit', item })} remove={() => setDialog({ kind: 'delete', item })} />)}</ul>
    {editing && <IntegrationEditor api={api} item={dialog.kind === 'edit' ? dialog.item : undefined} groupId={groupId} groups={list.data?.groups ?? []}
      credentials={credentials.data?.credentials ?? []} credentialError={credentials.error} loadingCredentials={credentials.loading && !credentials.data} close={close} refresh={refresh} />}
    {dialog?.kind === 'delete' && <DeleteDialog item={dialog.item} current={result.data?.find(item => item.id === dialog.item.id)} close={close} refresh={refresh} />}
  </section>;
}

export default function IntegrationsPage() {
  const { api, list, refresh } = useGroups();
  const t = useIntegrationLabels();
  return <Page className="space-y-5 px-4 py-5 sm:px-8">
    <header className="space-y-1"><h1 className="flex items-center gap-2 text-xl font-semibold"><Plug className="size-5 text-muted-foreground" aria-hidden="true" />{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('help')}</p></header>
    <Tabs defaultValue="connections">
      <TabsList aria-label={t('title')}><TabsTrigger value="connections">{t('connections')}</TabsTrigger><TabsTrigger value="credentials">{t('credentials')}</TabsTrigger></TabsList>
      <TabsContent value="connections"><Connections /></TabsContent>
      <TabsContent value="credentials"><RetryRead error={list.error} loading={list.loading && !list.data} retry={refresh} /><Credentials api={api} groups={list.data?.groups ?? []} /></TabsContent>
    </Tabs>
  </Page>;
}
