import { useCallback, useReducer, useState } from 'react';
import { Plus, Upload, Archive, ArchiveRestore, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import type { ApiClient } from '@/api/client';
import { flowCommand } from '@/api/commands';
import { flowDefinitionSchema, flowsImportV1PayloadSchema } from '@factory/contracts';
import { useFlowLabels, useFlowEvents, useFlowWrite, FlowDialog, FlowError, RunState, duration, timestamp, useRead } from './shared';
import { Field, Choice } from './shared';
import { newNode } from './nodeTypes';
import { openFlowRoute } from '../shell/navigation';
import { SetupDialog } from '../setup/SetupDialog';
import { useT } from '@/i18n';

function blankDefinition(key: string, title: string, label: ReturnType<typeof useFlowLabels>) {
  const trigger = newNode('trigger', label('node.trigger'), [], { role: 'worker' }, '');
  const output = newNode('output', label('node.output'), [trigger], { role: 'worker' }, '');
  return flowDefinitionSchema.parse({ schema: 2, key, title, nodes: [trigger, output], edges: [{ id: 'trigger-output', from: { node: trigger.id, port: 'out' }, to: { node: output.id }, loopBack: false }] });
}

export function FlowList({ projectId, api }: { projectId: string; api: ApiClient }) {
  const label = useFlowLabels();
  const t = useT();
  const [refreshKey, refresh] = useReducer(value => value + 1, 0);
  const [archived, setArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newKey, setNewKey] = useState('new-flow');
  const [selectedPack, setSelectedPack] = useState('');
  const [selectedDefinition, setSelectedDefinition] = useState('');
  const read = useCallback((signal: AbortSignal) => api.listProjectFlows(projectId, signal), [api, projectId]);
  const readPacks = useCallback(() => api.listPacks(), [api]);
  const { data, error, loading } = useRead(read, refreshKey);
  const legacy = useRead(importOpen ? readPacks : null);
  useFlowEvents(projectId, refresh);
  const write = useFlowWrite(api, refresh);
  const packs = legacy.data?.packs.flatMap(pack => pack.workflows.map(item => ({ ...item, packKey: pack.key }))).filter(item => flowsImportV1PayloadSchema.shape.packKey.safeParse(item.packKey).success &&
    flowsImportV1PayloadSchema.shape.definitionKey.safeParse(item.key).success) ?? [];
  const visible = data?.flows.filter(flow => flow.archived === archived) ?? [];
  const definitions = packs.filter(item => !selectedPack || item.packKey === selectedPack);
  async function create() {
    const flowId = crypto.randomUUID();
    await write.run(() => flowCommand('flows.create', projectId, { flowId, definition: blankDefinition(newKey, newTitle, label) }), () => openFlowRoute(projectId, { kind: 'flows', id: flowId }));
  }
  async function importFlow() {
    const picked = packs.find(item => item.key === selectedDefinition && item.packKey === selectedPack);
    if (!picked) return;
    const flowId = crypto.randomUUID();
    await write.run(() => flowCommand('flows.import-v1', projectId, { flowId, packKey: picked.packKey, definitionKey: picked.key }), () => openFlowRoute(projectId, { kind: 'flows', id: flowId }));
  }
  if (!data) return <div className="space-y-3 p-4"><FlowError error={error} missingRoute />{loading && <p role="status">{label('loading')}</p>}{error && <Button variant="outline" onClick={refresh}>{label('reload')}</Button>}</div>;
  return <div className="mx-auto flex h-full min-h-0 max-w-[1600px] flex-col gap-4 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{label('title')}</h2><p className="text-sm text-muted-foreground">{label('subtitle')}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" data-testid="setup-new-flow" onClick={() => setSetupOpen(true)}>{t('setupProposalUi.newFlow')}</Button><Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="mr-2 size-4" aria-hidden="true" />{label('import')}</Button><Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 size-4" aria-hidden="true" />{label('create')}</Button></div></div>
    <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{label('flowsCount', { count: visible.length })}</p><Button variant="ghost" size="sm" onClick={() => setArchived(value => !value)}>{archived ? <ArchiveRestore className="mr-2 size-4" /> : <Archive className="mr-2 size-4" />}{archived ? label('showActive') : label('showArchived')}</Button></div>
    <FlowError error={error} missingRoute />
    <div className="grid min-h-0 flex-1 gap-4 overflow-auto lg:grid-cols-[minmax(0,1.4fr)_minmax(340px,.8fr)]">{visible.length === 0 ? <Empty className="min-h-64 rounded-xl border bg-card"><EmptyDescription>{label(archived ? 'emptyArchived' : 'empty')}</EmptyDescription></Empty> : <div className="grid content-start gap-3">{visible.map(flow => <Card key={flow.id} role="link" tabIndex={0} aria-label={`${label('open')}: ${flow.title}`} className="cursor-pointer transition-colors hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => openFlowRoute(projectId, { kind: 'flows', id: flow.id })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFlowRoute(projectId, { kind: 'flows', id: flow.id }); } }}><CardHeader className="flex flex-row items-start justify-between gap-3 pb-2"><div className="min-w-0"><CardTitle className="truncate text-base">{flow.title}</CardTitle><p className="font-mono text-xs text-muted-foreground">{flow.key}</p></div><Button variant="ghost" size="icon" aria-label={label('open')} onClick={event => { event.stopPropagation(); openFlowRoute(projectId, { kind: 'flows', id: flow.id }); }}><ExternalLink className="size-4" /></Button></CardHeader><CardContent className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline">{flow.publishedVersion === null ? label('draft') : label('version', { version: flow.publishedVersion })}</Badge>{flow.draftChanged && <Badge variant="secondary">{label('draftChanged')}</Badge>}<span className="text-xs text-muted-foreground">{flow.source ? label('source', { source: flow.source }) : label('sourceBlank')}</span><span className="ml-auto text-xs text-muted-foreground">{timestamp(flow.updatedAt)}</span></CardContent></Card>)}</div>}
      <Card><CardHeader><CardTitle className="text-base">{label('recentRuns')}</CardTitle></CardHeader><CardContent className="space-y-2">{data?.runs.length ? data.runs.slice(0, 20).map(run => <button key={run.id} type="button" className="block w-full rounded-lg border p-3 text-left hover:bg-muted/50" onClick={() => openFlowRoute(projectId, { kind: 'runs', id: run.id })}><div className="flex flex-wrap items-center justify-between gap-2"><span className="truncate text-sm font-medium">{run.flowTitle}</span><RunState run={run} /></div><p className="mt-1 text-xs text-muted-foreground">{timestamp(run.startedAt ?? run.createdAt)} · {duration(run.startedAt, run.endedAt)}</p></button>) : <p className="text-sm text-muted-foreground">{label('noRuns')}</p>}</CardContent></Card>
    </div>
    {setupOpen && <SetupDialog projectId={projectId} target={{ mode: 'flow' }} close={() => setSetupOpen(false)} onApplied={refresh} />}
    {createOpen && <FlowDialog title={label('create')} description={label('createHelp')} close={() => setCreateOpen(false)} busy={write.busy} submit={label('create')} onSubmit={() => void create()}><div className="grid gap-3"><Field label={label('field.title')}>{props => <input {...props} className="h-9 rounded-md border bg-background px-2 text-sm" value={newTitle} onChange={event => setNewTitle(event.target.value)} autoFocus />}</Field><Field label={label('field.key')}>{props => <input {...props} className="h-9 rounded-md border bg-background px-2 font-mono text-sm" value={newKey} onChange={event => setNewKey(event.target.value)} />}</Field><p className="text-xs text-muted-foreground">{label('blankHelp')}</p><FlowError error={write.error} /></div></FlowDialog>}
    {importOpen && <FlowDialog title={label('import')} description={label('importHelp')} close={() => setImportOpen(false)} busy={write.busy} disabled={!selectedDefinition || !selectedPack} submit={label('import')} onSubmit={() => void importFlow()}><div className="grid gap-3"><Field label={label('pack')}>{props => <Choice {...props} value={selectedPack} onChange={event => { setSelectedPack(event.target.value); setSelectedDefinition(''); }}><option value="">{label('selectPack')}</option>{[...new Set(packs.map(item => item.packKey))].map(pack => <option key={pack} value={pack}>{pack}</option>)}</Choice>}</Field><Field label={label('definition')}>{props => <Choice {...props} value={selectedDefinition} onChange={event => setSelectedDefinition(event.target.value)}><option value="">{label('selectDefinition')}</option>{definitions.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}</Choice>}</Field>{legacy.loading && <p role="status">{label('loading')}</p>}{!legacy.loading && !legacy.error && !packs.length && <p>{label('noDefinitions')}</p>}<FlowError error={legacy.error ?? write.error} /></div></FlowDialog>}
  </div>;
}
