import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { Connection, XYPosition } from '@xyflow/react';
import { ArrowLeft, LayoutDashboard, Play, Save, Send, Settings2, Trash2 } from 'lucide-react';
import { flowDefinitionSchema, validateFlow, type FlowDefinition, type FlowNode } from '@factory/contracts';
import { FlowCommandError, type ApiClient } from '@/api/client';
import type { FlowIssue } from '@/api/flowModels';
import { flowCommand } from '@/api/commands';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FlowCanvas, type Selection, nodeDragType } from './FlowCanvas';
import { EdgeInspector, FlowSettings, IssueList, NodeInspector } from './FlowInspector';
import { bundleDefaults, nodeIcons, nodeKinds, newNode } from './nodeTypes';
import { useT } from '@/i18n';
import { FlowInsights } from './FlowInsights';
import { FlowError, NodePicker, PendingJson, timestamp, useFlowEvents, useFlowLabels, useFlowWrite, useRead } from './shared';
import { AgentMascotProvider } from '@/components/mascot/AgentMascot';
import { RunDialog } from './RunDialog';
import { guardFlowDraft } from '../shell/navigation';
import { autoLayout, definitionToGraph, isLoopReturn, nodeWidth, resolveLayout } from './graphModel';

export function FlowEditor({ api, projectId, flowId, onBack }: { api: ApiClient; projectId: string; flowId: string; onBack: () => void }) {
  const label = useFlowLabels();
  const t = useT();
  const [insights, setInsights] = useState(false);
  const [refreshKey, refresh] = useReducer(value => value + 1, 0);
  const read = useCallback((signal: AbortSignal) => api.getFlow(projectId, flowId, signal), [api, projectId, flowId]);
  const { data, error, loading } = useRead(read, refreshKey);
  const rosterRead = useRead(useCallback((signal: AbortSignal) => api.listProjectAgents(projectId, signal), [api, projectId]));
  const roster = rosterRead.data;
  const agentNames = useMemo(() => new Map((roster?.agents ?? []).map(agent => [agent.id, agent.name])), [roster]);
  const [draft, setDraft] = useState<{ definition: FlowDefinition; revision: number } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [settings, setSettings] = useState(false);
  const [panel, setPanel] = useState('inspector');
  const [search, setSearch] = useState('');
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [runDialog, setRunDialog] = useState<'draft' | number | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [pendingJson, setPendingJson] = useState(0);
  const write = useFlowWrite(api, refresh);
  const definition = draft?.definition ?? data?.draft;
  const dirty = !!draft || pendingJson > 0;
  const schema = useMemo(() => definition ? flowDefinitionSchema.safeParse(definition) : null, [definition]);
  const localIssues = useMemo((): FlowIssue[] => {
    if (!definition) return [];
    const agentIds = roster ? new Set(roster.agents.filter(agent => agent.status === 'active').map(agent => agent.id)) : undefined;
    const issues: FlowIssue[] = validateFlow(definition, agentIds ? { agentIds } : undefined);
    if (schema && !schema.success) for (const issue of schema.error.issues) {
      const index = issue.path[1];
      issues.push({ code: 'invalid', message: `${issue.path.map(String).join('.')}: ${issue.message}`,
        node: issue.path[0] === 'nodes' && typeof index === 'number' ? definition.nodes[index]?.id : undefined,
        edge: issue.path[0] === 'edges' && typeof index === 'number' ? definition.edges[index]?.id : undefined });
    }
    return issues;
  }, [definition, roster, schema]);
  const serverIssues = write.error instanceof FlowCommandError && write.error.issues.length ? write.error.issues : draft ? [] : data?.issues ?? [];
  const issues = [...localIssues, ...serverIssues.filter(issue => !localIssues.some(item => item.code === issue.code && item.node === issue.node && item.edge === issue.edge))];
  const version = previewVersion ?? (typeof runDialog === 'number' ? runDialog : null);
  const knownVersion = version !== null && data?.flow.publishedVersion === version && !data.flow.draftChanged ? data.draft : undefined;
  const readList = useCallback((signal: AbortSignal) => api.listProjectFlows(projectId, signal), [api, projectId]);
  const versions = useRead(version !== null && !knownVersion ? readList : null, refreshKey);
  const versionRun = versions.data?.runs.find(run => !run.test && run.flowId === flowId && run.version === version);
  const readVersionRun = useCallback((signal: AbortSignal) => api.getFlowRun(projectId, versionRun!.id, signal), [api, projectId, versionRun?.id]);
  const snapshot = useRead(versionRun ? readVersionRun : null);
  const versionDefinition = knownVersion ?? (snapshot.data?.run.flowId === flowId && snapshot.data.run.version === version ? snapshot.data.definition : undefined);
  useFlowEvents(projectId, refresh, flowId);
  const confirmText = label('unsavedConfirm');
  useEffect(() => {
    if (!dirty) return;
    const unguard = guardFlowDraft(() => window.confirm(confirmText));
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => { unguard(); window.removeEventListener('beforeunload', unload); };
  }, [dirty, confirmText]);
  if (!data || !definition) return <div className="space-y-3 p-4"><Button variant="ghost" onClick={onBack}>{label('back')}</Button><FlowError error={error} missingRoute />{loading && <p role="status">{label('loading')}</p>}{error && <Button variant="outline" onClick={refresh}>{label('reload')}</Button>}</div>;

  const { flow } = data;
  const archived = flow.archived;
  const writable = !archived && !write.busy && previewVersion === null;
  const stale = !!draft && draft.revision !== flow.revision;
  const actionBusy = write.busy || loading || !!error;
  const selectedNode = selection?.kind === 'node' ? definition.nodes.find(node => node.id === selection.id) : undefined;
  const update = (change: (current: FlowDefinition) => FlowDefinition) => {
    if (!writable) return;
    write.setError(null);
    setDraft(current => ({ definition: change(current?.definition ?? data.draft), revision: current?.revision ?? flow.revision }));
  };
  const replace = (next: FlowDefinition) => update(() => next);
  const select = (next: Selection) => {
    if (pendingJson && (next?.kind !== selection?.kind || next?.id !== selection?.id)) return;
    setSelection(next); setSettings(false); setPanel('inspector');
  };
  function remove() {
    if (!selection || !writable || pendingJson) return;
    if (selection.kind === 'node') {
      if (definition!.nodes.length === 1) return;
      update(current => {
        const layout = { ...current.layout };
        delete layout[selection.id];
        return { ...current, layout, nodes: current.nodes.filter(node => node.id !== selection.id),
          edges: current.edges.filter(edge => edge.from.node !== selection.id && edge.to.node !== selection.id) };
      });
    } else update(current => ({ ...current, edges: current.edges.filter(edge => edge.id !== selection.id) }));
    select(null);
  }
  function add(type: string, position?: XYPosition) {
    const bundle = type === 'bundle.publish';
    const kind = (bundle ? 'action' : type) as FlowNode['type'];
    if (!writable || pendingJson || !nodeKinds.includes(kind) || definition!.nodes.length >= 200) return;
    const agent = roster?.agents.find(item => item.status === 'active');
    const base = newNode(kind, bundle ? t('flowBundleUi.title') : label(`node.${kind}`), definition!.nodes, agent ? { agent: agent.id } : { role: 'worker' }, label('acceptance'));
    const node: FlowNode = bundle && base.type === 'action' ? { ...base, action: 'bundle.publish', params: bundleDefaults } : base;
    const right = Math.max(0, ...definitionToGraph(definition!).nodes.map(item => item.position.x + nodeWidth));
    replace({ ...definition!, nodes: [...definition!.nodes, node], layout: { ...resolveLayout(definition!), [node.id]: position ?? { x: right + 70, y: 32 } } });
    if (!position) setFitKey(value => value + 1);
    select({ kind: 'node', id: node.id });
  }
  function connect({ source, target, sourceHandle }: Connection) {
    if (!source || !target || !sourceHandle || definition!.edges.length >= 400 || definition!.edges.some(edge => edge.from.node === source && edge.from.port === sourceHandle && edge.to.node === target)) return;
    const id = crypto.randomUUID();
    update(current => ({ ...current, edges: [...current.edges, { id, from: { node: source, port: sourceHandle }, to: { node: target }, loopBack: isLoopReturn(current, source, target) }] }));
  }
  function save() {
    if (!draft || !schema?.success || stale || pendingJson) return;
    void write.run(() => flowCommand('flows.save-draft', projectId, { flowId, expectedRevision: draft.revision, definition: schema.data }), () => setDraft(null));
  }
  function publish() {
    void write.run(() => flowCommand('flows.publish', projectId, { flowId, expectedRevision: flow.revision }));
  }
  function archive() {
    void write.run(() => flowCommand('flows.archive', projectId, { flowId, expectedRevision: flow.revision, archived: !archived }));
  }
  const pane = previewVersion === null ? definition : versionDefinition;
  return <div className="flex h-full min-h-0 flex-col bg-background">
    <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <Button variant="ghost" size="icon" aria-label={label('back')} onClick={onBack}><ArrowLeft className="size-4" /></Button>
      <div className="min-w-36 flex-1"><div className="flex items-center gap-2"><h2 className="truncate text-lg font-semibold">{definition.title}</h2>{dirty && <Badge variant="secondary">{label('unsaved')}</Badge>}</div><p className="font-mono text-xs text-muted-foreground">{definition.key} · r{flow.revision}</p></div>
      {!insights && (previewVersion !== null ? <Button variant="outline" onClick={() => { setPreviewVersion(null); setSelection(null); }}>{label('backToDraft')}</Button> : <>
        <Button data-testid="flow-save" size="sm" variant="outline" disabled={!writable || actionBusy || !draft || !schema?.success || stale || pendingJson > 0} onClick={save}><Save aria-hidden="true" />{label('save')}</Button>
        <Button data-testid="flow-publish" size="sm" variant="outline" disabled={!writable || actionBusy || dirty || localIssues.length > 0} onClick={publish}><Send aria-hidden="true" />{label('publish')}</Button>
        <Button data-testid="flow-run" size="sm" variant="outline" disabled={!writable || actionBusy || flow.publishedVersion === null} onClick={() => setRunDialog(flow.publishedVersion)}><Play aria-hidden="true" />{label('run')}</Button>
        <Button data-testid="flow-test-run" size="sm" disabled={!writable || actionBusy || dirty || issues.length > 0} onClick={() => setRunDialog('draft')}>{label('testRun')}</Button>
        <Button size="sm" variant="ghost" disabled={actionBusy || dirty} onClick={archive}>{label(archived ? 'restore' : 'archive')}</Button>
      </>)}
    </header>
    <Tabs value={insights ? 'insights' : 'editor'} onValueChange={value => { if (!pendingJson && !write.busy) setInsights(value === 'insights'); }} className="min-h-0 min-w-0 flex-1 gap-0">
      <TabsList className="mx-3 my-2 shrink-0 self-start">
        <TabsTrigger value="editor" data-testid="insights-editor-tab">{t('insightsUi.editor')}</TabsTrigger>
        <TabsTrigger value="insights" data-testid="insights-tab" disabled={pendingJson > 0 || write.busy}>{t('insightsUi.title')}</TabsTrigger>
      </TabsList>
      <TabsContent value="insights" className="min-h-0 min-w-0 overflow-auto">
        <FlowInsights api={api} projectId={projectId} flowId={flowId} definition={data.draft} revision={flow.revision} agents={roster} archived={archived} dirty={dirty} refreshFlow={refresh} />
      </TabsContent>
      <TabsContent value="editor" className="min-h-0 overflow-hidden data-[state=active]:flex">
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 overflow-auto p-2 lg:grid-cols-[11rem_minmax(0,1fr)_17rem] xl:grid-cols-[12rem_minmax(0,1fr)_19rem]">
      <aside className="space-y-2 rounded-xl border bg-card p-2 lg:overflow-auto">
        <p className="text-sm font-semibold">{label('palette')}</p>
        <Input disabled={!writable} aria-label={label('searchNodes')} placeholder={label('searchNodes')} value={search} onChange={event => setSearch(event.target.value)} />
        <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">{nodeKinds.filter(type => `${label(`node.${type}`)} ${label(`help.${type}`)}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(type => {
          const Icon = nodeIcons[type];
          return <button data-testid={`flow-add-${type}`} key={type} type="button" disabled={!writable || pendingJson > 0} draggable={writable && !pendingJson}
            onDragStart={event => { event.dataTransfer.setData(nodeDragType, type); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => add(type)}
            className="flex items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm hover:border-border hover:bg-muted/60 disabled:opacity-50">
            <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><span><span className="block font-medium">{label(`node.${type}`)}</span>
            <span className="block text-xs text-muted-foreground">{label(`help.${type}`)}</span>{type === 'parallel' && <Badge variant="outline" className="mt-1 text-[9px]">{label('unsupportedNode')}</Badge>}</span>
          </button>;
        })}</div>
        {`${t('flowBundleUi.title')} ${t('flowBundleUi.help')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
          <button type="button" data-testid="flow-bundle-add" disabled={!writable || pendingJson > 0} draggable={writable && !pendingJson}
            onDragStart={event => { event.dataTransfer.setData(nodeDragType, 'bundle.publish'); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => add('bundle.publish')}
            className="flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm hover:border-border hover:bg-muted/60 disabled:opacity-50">
            <Send className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><span><span className="block font-medium">{t('flowBundleUi.title')}</span><span className="block text-xs text-muted-foreground">{t('flowBundleUi.help')}</span></span>
          </button>}
        <Button className="w-full" size="sm" variant="outline" disabled={!writable || pendingJson > 0} onClick={() => { setSettings(true); setPanel('inspector'); setSelection(null); }}><Settings2 aria-hidden="true" />{label('settings')}</Button>
        <Button data-testid="flow-auto-layout" className="w-full" size="sm" variant="ghost" disabled={!writable} onClick={() => { update(current => ({ ...current, layout: autoLayout(current) })); setFitKey(value => value + 1); }}><LayoutDashboard aria-hidden="true" />{label('autoLayout')}</Button>
      </aside>
      <main className="flex min-h-[420px] min-w-0 flex-col gap-2 lg:min-h-0">
        {pane && <><NodePicker definition={pane} current={selection?.kind === 'node' ? selection.id : undefined} onChange={id => select(id ? { kind: 'node', id } : null)} />
          <div className="min-h-0 flex-1"><FlowCanvas key={previewVersion ?? 'draft'} agentNames={agentNames} definition={pane} selection={selection} onSelect={select} issues={previewVersion === null ? issues : []} fitKey={fitKey}
            {...(writable ? { edit: { move: (id, position) => update(current => ({ ...current, layout: { ...resolveLayout(current), [id]: position } })), connect, remove, add } } : {})} /></div></>}
        {!pane && <p role="status" className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{label(versions.loading || snapshot.loading ? 'loading' : 'versionBodyUnavailable')}</p>}
        {previewVersion !== null && <Badge variant="outline">{label('readOnlyVersion', { version: previewVersion })}</Badge>}
      </main>
      <aside className="min-w-0 space-y-2 rounded-xl border bg-card p-2 lg:overflow-auto">
        <FlowError error={write.error ?? error} />
        {stale && <div className="space-y-2 rounded-md border border-destructive/40 p-2 text-sm" role="alert">{label('staleDraft')}<Button size="sm" variant="outline" onClick={() => { if (window.confirm(confirmText)) { setDraft(null); setSelection(null); refresh(); } }}>{label('discardDraft')}</Button></div>}
        <Tabs value={panel} onValueChange={next => { if (!pendingJson) setPanel(next); }}><TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="inspector">{label('inspector')}</TabsTrigger><TabsTrigger value="issues">{label('issues')} · {issues.length}</TabsTrigger><TabsTrigger value="history">{label('history')}</TabsTrigger></TabsList>
          <TabsContent value="inspector" className="space-y-3">
            {previewVersion !== null || archived ? <p className="text-sm text-muted-foreground">{label('readOnly')}</p> : <fieldset disabled={write.busy} className="min-w-0 space-y-3">
              <PendingJson.Provider key={draft?.revision ?? flow.revision} value={setPendingJson}>
                {settings ? <FlowSettings definition={definition} setDefinition={replace} /> : selectedNode ? <AgentMascotProvider api={api} agents={roster?.agents}><NodeInspector key={selectedNode.id} api={api} projectId={projectId} node={selectedNode} definition={definition} roster={roster} setNode={node => update(current => ({ ...current, nodes: current.nodes.map(item => item.id === node.id ? node : item) }))} /></AgentMascotProvider>
                  : selection?.kind === 'edge' ? <EdgeInspector selection={selection.id} definition={definition} setDefinition={replace} /> : <p className="text-sm text-muted-foreground">{label('selectHint')}</p>}
              </PendingJson.Provider>
              {selection && <Button data-testid="flow-remove" size="sm" variant="outline" disabled={pendingJson > 0 || (selection.kind === 'node' && definition.nodes.length < 2)} onClick={remove}><Trash2 aria-hidden="true" />{label('remove')}</Button>}
              <FlowError error={rosterRead.error} />
            </fieldset>}
          </TabsContent>
          <TabsContent value="issues"><IssueList definition={definition} issues={issues} onSelect={target => {
            if (target?.kind !== 'edge') { if (target) select(target); return; }
            const edge = definition.edges.find(item => item.id === target.id);
            const node = edge && definition.nodes.find(item => item.id === edge.from.node || item.id === edge.to.node);
            select(node ? { kind: 'node', id: node.id } : target);
          }} /></TabsContent>
          <TabsContent value="history" className="space-y-2">{data.versions.length ? [...data.versions].sort((first, second) => second.version - first.version).map(item =>
            <button key={item.version} type="button" className="block w-full min-w-0 rounded-lg border p-2 text-left text-sm hover:bg-muted/60" onClick={() => { setPreviewVersion(item.version); setSelection(null); }}>
              <span className="font-semibold">{label('version', { version: item.version })}</span> · {timestamp(item.publishedAt)}<span className="block break-all font-mono text-[10px] text-muted-foreground">{item.sha256}</span>
            </button>) : <p className="text-sm text-muted-foreground">{label('noVersions')}</p>}</TabsContent>
        </Tabs>
      </aside>
    </div>
      </TabsContent>
    </Tabs>
    {runDialog !== null && <RunDialog key={runDialog} api={api} projectId={projectId} flowId={flowId} version={runDialog} definition={runDialog === 'draft' ? definition : versionDefinition}
      loadingDefinition={runDialog !== 'draft' && !knownVersion && (versions.loading || snapshot.loading)} close={() => setRunDialog(null)} />}
  </div>;
}
