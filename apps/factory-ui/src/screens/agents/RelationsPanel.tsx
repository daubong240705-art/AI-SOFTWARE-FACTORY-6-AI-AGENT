import { Choice, ChoiceOption } from '@/components/ui/choice';
import { AgentChoiceLabel } from '@/components/mascot/AgentMascot';
import { useEffect, useMemo, useState } from 'react';
import dagre from '@dagrejs/dagre';
import { Background, Controls, MarkerType, Position, ReactFlow, useReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { agentRelationKindSchema, agentRelationSchema, relationsSetPayloadSchema, type AgentRelation, type AgentSummary } from '@factory/contracts';
import type { AgentProjectResponse } from '@/api/agentModels';
import { relationsSet } from '@/api/commands';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useT } from '@/i18n';
import { ErrorText, useAgentLabels, useWriteFeedback, type Submit } from './shared';

type Draft = { revision: number; rows: { key: string; relation: AgentRelation }[] };
const width = 158, height = 44;

export function RelationsPanel({ projectId, data, submit, refreshing }: { projectId: string; data: AgentProjectResponse; submit: Submit; refreshing: boolean }) {
  const t = useAgentLabels();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [invalid, setInvalid] = useState(false);
  const writer = useWriteFeedback(submit);
  const rows = draft?.rows ?? data.relations.map((relation, index) => ({ key: `saved:${index}`, relation }));
  const stale = !!draft && draft.revision !== data.relationsRevision;
  const blocked = refreshing || writer.busy || stale;
  const agentIds = new Set(data.agents.map(agent => agent.id));
  const valid = (relation: AgentRelation) => agentIds.has(relation.from) && agentIds.has(relation.to) && agentRelationSchema.safeParse(relation).success;
  function change(next: Draft['rows']) {
    setDraft({ revision: draft?.revision ?? data.relationsRevision, rows: next });
    setInvalid(false);
  }
  function update(index: number, patch: Partial<AgentRelation>) {
    change(rows.map((row, position) => position === index ? { ...row, relation: { ...row.relation, ...patch } } : row));
  }
  function save() {
    if (!draft || blocked) return;
    const payload = { expectedRevision: draft.revision, relations: rows.map(row => row.relation) };
    const parsed = relationsSetPayloadSchema.safeParse(payload);
    if (!parsed.success || payload.relations.some(relation => !valid(relation))) { setInvalid(true); return; }
    void writer.run(() => relationsSet({ projectId, ...parsed.data }), () => { setDraft(null); setInvalid(false); });
  }
  return <section data-testid="relation-panel" className="space-y-4 rounded-xl border border-border bg-card/60 p-4">
    <div><h3 className="font-semibold">{t('relations.title')}</h3><p className="text-sm text-muted-foreground">{t('relations.help')}</p></div>
    <ErrorText error={writer.error} />
    {stale && <div className="flex flex-wrap items-center gap-2 text-sm" role="status">{t('relations.changed')}<Button type="button" size="sm" variant="outline" onClick={() => { setDraft(null); setInvalid(false); writer.setError(null); }}>{t('reload')}</Button></div>}
    {invalid && <p role="alert" className="text-sm text-destructive">{t('invalidForm')}</p>}
    {rows.length ? <Table aria-label={t('relations.title')}>
      <TableHeader className="sr-only sm:not-sr-only"><TableRow>{['from', 'kind', 'to'].map(key => <TableHead key={key}>{t(`relations.${key}`)}</TableHead>)}<TableHead><span className="sr-only">{t('remove')}</span></TableHead></TableRow></TableHeader>
      <TableBody>{rows.map(({ key, relation }, index) => <TableRow data-testid="relation-row" key={key} className="grid grid-cols-2 gap-1 py-2 sm:table-row sm:py-0">
        <TableCell className="col-span-2 min-w-0"><AgentChoice agents={data.agents} selected={relation.from} label={`${t('relations.from')} ${index + 1}`} disabled={writer.busy} invalid={invalid && !valid(relation)} change={from => update(index, { from })} /></TableCell>
        <TableCell className="col-span-2 min-w-0"><Choice data-testid="relation-kind" aria-label={`${t('relations.kind')} ${index + 1}`} disabled={writer.busy} value={relation.kind} onValueChange={selectedValue => update(index, { kind: agentRelationKindSchema.parse(selectedValue) })}>{agentRelationKindSchema.options.map(kind => <ChoiceOption key={kind} value={kind}>{t(`relations.kinds.${kind}`)}</ChoiceOption>)}</Choice></TableCell>
        <TableCell className="col-span-2 min-w-0"><AgentChoice agents={data.agents} selected={relation.to} label={`${t('relations.to')} ${index + 1}`} disabled={writer.busy} invalid={invalid && !valid(relation)} change={to => update(index, { to })} /></TableCell>
        <TableCell><Button data-testid="relation-delete" type="button" size="sm" variant="ghost" disabled={writer.busy} aria-label={`${t('remove')} ${index + 1}`} onClick={() => change(rows.filter((_, position) => position !== index))}>{t('remove')}</Button></TableCell>
      </TableRow>)}</TableBody>
    </Table> : <p className="text-sm text-muted-foreground">{t('relations.empty')}</p>}
    <div className="flex flex-wrap gap-2"><Button data-testid="relation-create" type="button" variant="outline" disabled={writer.busy || data.agents.length < 2 || rows.length >= 2000} onClick={() => change([...rows, { key: crypto.randomUUID(), relation: { from: '', to: '', kind: 'collaborates' } }])}>{t('relations.add')}</Button><Button data-testid="relation-save" type="button" disabled={blocked || !draft} onClick={save}>{writer.busy ? t('loading') : t('save')}</Button></div>
    {!!data.relations.length && <RelationGraph agents={data.agents} relations={data.relations} />}
  </section>;
}

function AgentChoice({ agents, selected, label, disabled, invalid, change }: { agents: AgentSummary[]; selected: string; label: string; disabled: boolean; invalid: boolean; change: (id: string) => void }) {
  const t = useT();
  return <Choice data-testid="relation-agent" aria-label={label} aria-invalid={invalid} disabled={disabled} value={selected} onValueChange={selectedValue => change(selectedValue)}>
    <ChoiceOption value="">—</ChoiceOption>{selected && !agents.some(agent => agent.id === selected) && <ChoiceOption value={selected}>{t('flowsUi.missingAgent')}</ChoiceOption>}{agents.map(agent => <ChoiceOption key={agent.id} value={agent.id} textValue={agent.name}><AgentChoiceLabel agent={agent} /></ChoiceOption>)}
  </Choice>;
}

function RelationGraph({ agents, relations }: { agents: AgentSummary[]; relations: AgentRelation[] }) {
  const t = useAgentLabels();
  const label = useT();
  const { nodes, links } = useMemo(() => {
    const graph = new dagre.graphlib.Graph({ multigraph: true }).setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 118 }).setDefaultEdgeLabel(() => ({}));
    const linked = new Set(relations.flatMap(({ from, to }) => [from, to]));
    const members = agents.filter(agent => linked.has(agent.id));
    members.forEach(agent => graph.setNode(agent.id, { width, height }));
    const links = relations.flatMap((relation, index) => {
      if (!graph.hasNode(relation.from) || !graph.hasNode(relation.to)) return [];
      const id = `relation:${index}`;
      graph.setEdge(relation.from, relation.to, {}, id);
      return [{ relation, id }];
    });
    dagre.layout(graph);
    const nodes: Node[] = members.map(agent => {
      const { x, y } = graph.node(agent.id);
      return { id: agent.id, position: { x: x - width / 2, y: y - height / 2 }, data: { label: <span className="flex min-w-0 justify-center" title={agent.name}><AgentChoiceLabel agent={agent} /></span> }, width, height, sourcePosition: Position.Right, targetPosition: Position.Left, style: { borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-card)', color: 'var(--color-foreground)', padding: 10 } };
    });
    return { nodes, links };
  }, [agents, relations]);
  const edges: Edge[] = links.map(({ relation, id }) => ({ id, source: relation.from, target: relation.to, type: 'smoothstep', label: t(`relations.kinds.${relation.kind}`), markerEnd: { type: MarkerType.ArrowClosed }, labelStyle: { fill: 'var(--color-foreground)' }, labelBgStyle: { fill: 'var(--color-card)' } }));
  if (!nodes.length) return null;
  return <div className="space-y-2"><h4 className="text-sm font-medium">{t('relations.graph')}</h4>
    <div className="h-72 overflow-hidden rounded-lg border border-border" role="region" aria-label={t('relations.graph')}><ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.05} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} deleteKeyCode={null} zoomOnScroll={false} edgesFocusable={false} nodesFocusable={false} disableKeyboardA11y proOptions={{ hideAttribution: true }}
      ariaLabelConfig={{ 'node.a11yDescription.default': label('flowsUi.canvasNodeKeys'), 'node.a11yDescription.keyboardDisabled': t('relations.graph'), 'edge.a11yDescription.default': t('relations.graph'), 'controls.ariaLabel': label('flowsUi.canvasControls'), 'controls.zoomIn.ariaLabel': label('flowsUi.zoomIn'), 'controls.zoomOut.ariaLabel': label('flowsUi.zoomOut'), 'controls.fitView.ariaLabel': label('flowsUi.fit') }}>
      <Background /><Controls showInteractive={false} /><FitRelations nodes={nodes} />
    </ReactFlow></div>
  </div>;
}

function FitRelations({ nodes }: { nodes: Node[] }) {
  const { fitView } = useReactFlow();
  useEffect(() => { const frame = requestAnimationFrame(() => { void fitView({ padding: 0.2 }); }); return () => cancelAnimationFrame(frame); }, [nodes, fitView]);
  return null;
}
