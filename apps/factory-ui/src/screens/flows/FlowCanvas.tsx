import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, useUpdateNodeInternals, type Connection, type NodeProps, type ReactFlowInstance, type XYPosition } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FLOW_NODE_PORTS, type FlowDefinition, type FlowNode, type FlowNodeRun } from '@factory/contracts';
import type { FlowIssue } from '@/api/flowModels';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { definitionToGraph, type CanvasEdge, type CanvasNode } from './graphModel';
import { nodeIcons, unsupported } from './nodeTypes';
import { flowNodeTitle, PortLabel, useFlowLabels } from './shared';

export type Selection = { kind: 'node' | 'edge'; id: string } | null;
/** Agent id -> display name, so agent nodes show names instead of ids. */
const AgentNames = createContext<ReadonlyMap<string, string>>(new Map());
export const nodeDragType = 'application/x-factory-flow-node';

function summary(node: FlowNode, label: ReturnType<typeof useFlowLabels>, names: ReadonlyMap<string, string>): string {
  switch (node.type) {
    case 'trigger': return label(`option.${node.trigger.kind}`);
    case 'agent': {
      const selector = node.agent;
      return 'agent' in selector ? names.get(selector.agent) ?? label('missingAgent') : 'role' in selector ? selector.role : 'team' in selector ? label('nodeTeam') : selector.tags.join(', ');
    }
    case 'action': return node.action;
    case 'condition': return label('ruleCount', { count: node.rules.length });
    case 'parallel': return node.forEach;
    case 'join': return typeof node.policy === 'string' ? label(`option.${node.policy}`) : `${label('field.quorum')}: ${node.policy.quorum}`;
    case 'approval': return typeof node.approver === 'string' ? label(`option.${node.approver}`) : label('node.agent');
    case 'loop': return label('iterationCount', { count: node.maxIterations });
    case 'wait': return 'for' in node.wait ? label('minutes', { count: node.wait.for }) : 'until' in node.wait ? node.wait.until : node.wait.event;
    case 'subflow': return label('missingWorkflow');
    case 'orchestrate': return node.goal;
    case 'output': return label(`option.${node.target}`);
  }
}

const stateStyles = {
  pending: 'border-muted-foreground/40', ready: 'border-sky-500', running: 'border-sky-500 motion-safe:animate-pulse',
  waiting: 'border-amber-500 motion-safe:animate-pulse', succeeded: 'border-emerald-500', failed: 'border-destructive',
  skipped: 'border-dashed border-muted-foreground/50', cancelled: 'border-dashed border-destructive/60',
};

function FlowTile({ id, data, selected, isConnectable }: NodeProps<CanvasNode>) {
  const label = useFlowLabels();
  const { node, invalid, state } = data;
  const Icon = nodeIcons[node.type];
  const ports = FLOW_NODE_PORTS(node);
  const handles = ports.join(',');
  const update = useUpdateNodeInternals();
  useLayoutEffect(() => update(id), [handles, id, update]);
  const detail = summary(node, label, useContext(AgentNames));
  return <div className={cn('relative h-full w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-card-foreground shadow-sm', state && stateStyles[state], selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background', invalid && 'border-destructive')}>
    {node.type !== 'trigger' && <Handle data-testid={`flow-handle-${id}-in`} id="in" type="target" position={Position.Left} isConnectable={isConnectable} className="!size-3 !bg-primary" />}
    <div className="flex min-w-0 items-center gap-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><Icon className="size-4" aria-hidden="true" /></span>
      <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label(`node.${node.type}`)}</p><p className="truncate text-sm font-semibold" title={flowNodeTitle(node, label)}>{flowNodeTitle(node, label)}</p></div>
    </div>
    <p className="mt-1 truncate text-xs text-muted-foreground" title={detail}>{detail}</p>
    {state ? <Badge variant="outline" className="mt-1 text-[10px]">{label(`state.${state}`)}</Badge> : unsupported(node) && <Badge variant="destructive" className="mt-1 text-[10px]">{label('unsupportedNode')}</Badge>}
    {ports.map((port, index) => <div key={port}>
      <PortLabel port={port} className="absolute right-3 font-mono text-[10px] text-muted-foreground" style={{ top: 79 + index * 20 }} />
      <Handle data-testid={`flow-handle-${id}-${port}`} id={port} type="source" position={Position.Right} isConnectable={isConnectable} className="!size-3 !bg-primary" style={{ top: 87 + index * 20 }} />
    </div>)}
  </div>;
}

const nodeTypes = { flow: FlowTile };
const noIssues: FlowIssue[] = [];
const noRuns: FlowNodeRun[] = [];

export function FlowCanvas({ definition, selection, onSelect, issues = noIssues, runs, fitKey = 0, edit, agentNames }: {
  definition: FlowDefinition; selection: Selection; onSelect: (selection: Selection) => void;
  issues?: FlowIssue[]; runs?: FlowNodeRun[]; fitKey?: number; agentNames?: ReadonlyMap<string, string>;
  edit?: { move: (id: string, position: XYPosition) => void; connect: (connection: Connection) => void; remove: () => void; add: (type: string, at: XYPosition) => void };
}) {
  const label = useFlowLabels();
  const attempts = runs ?? noRuns;
  const instance = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  const graph = useMemo(() => definitionToGraph(definition), [definition]);
  const { latest, takenPorts } = useMemo(() => {
    const byNode = new Map<string, FlowNodeRun>();
    const ports = new Set<string>();
    for (const run of attempts) {
      const previous = byNode.get(run.nodeId);
      if (!previous || run.iteration > previous.iteration || (run.iteration === previous.iteration && run.attemptNo > previous.attemptNo)) byNode.set(run.nodeId, run);
      if (run.port !== null) ports.add(`${run.nodeId}/${run.port}`);
    }
    return { latest: byNode, takenPorts: ports };
  }, [attempts]);
  const { invalidNodes, invalidEdges } = useMemo(() => {
    const nodes = new Set(issues.flatMap(issue => issue.node ? [issue.node] : []));
    const edges = new Set(issues.flatMap(issue => issue.edge ? [issue.edge] : []));
    for (const edge of graph.edges) if (edges.has(edge.id)) { nodes.add(edge.source); nodes.add(edge.target); }
    return { invalidNodes: nodes, invalidEdges: edges };
  }, [graph.edges, issues]);
  useEffect(() => {
    if (!fitKey) return;
    const frame = requestAnimationFrame(() => { void instance.current?.fitView({ padding: 0.15, maxZoom: 1 }); });
    return () => cancelAnimationFrame(frame);
  }, [fitKey]);
  const names = useMemo(() => agentNames ?? new Map<string, string>(), [agentNames]);
  const titles = useMemo(() => new Map(definition.nodes.map(node => [node.id, flowNodeTitle(node, label)])), [definition.nodes, label]);
  return <AgentNames.Provider value={names}><div className="h-full min-h-[390px] min-w-0 overflow-hidden rounded-xl border border-border bg-muted/35" role="region" aria-label={label('canvas')}
    onDragOver={event => { if (edit && event.dataTransfer.types.includes(nodeDragType)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDrop={event => { if (!edit || !instance.current) return; const type = event.dataTransfer.getData(nodeDragType); if (!type) return; event.preventDefault();
      edit.add(type, instance.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })); }}
    onKeyDown={event => { if (edit && (event.key === 'Delete' || event.key === 'Backspace') && (event.target as HTMLElement).closest('.react-flow__node, .react-flow__edge, .react-flow__pane')) { event.preventDefault(); edit.remove(); } }}>
    <ReactFlow<CanvasNode, CanvasEdge> nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} minZoom={0.2} maxZoom={2}
      className="[--xy-controls-button-background-color:var(--color-card)] [--xy-controls-button-background-color-hover:var(--color-accent)] [--xy-controls-button-border-color:var(--color-border)] [--xy-controls-button-color:var(--color-foreground)]"
      nodes={graph.nodes.map(node => {
        const state = runs ? latest.get(node.id)?.state ?? 'pending' : undefined;
        const description = [titles.get(node.id), label(`node.${node.data.node.type}`), state ? label(`state.${state}`) : ''].filter(Boolean).join(' · ');
        return { ...node, selected: selection?.kind === 'node' && selection.id === node.id, data: { ...node.data,
          invalid: invalidNodes.has(node.id), ...(state ? { state } : {}) }, ariaLabel: description };
      })}
      edges={graph.edges.map(edge => {
        const active = takenPorts.has(`${edge.source}/${edge.sourceHandle}`);
        const invalid = invalidEdges.has(edge.id);
        const stroke = invalid ? 'var(--color-destructive)' : active ? 'var(--color-primary)' : 'var(--color-muted-foreground)';
        return { ...edge, selected: selection?.kind === 'edge' && selection.id === edge.id, ariaLabel: `${titles.get(edge.source) ?? label('missingNode')} → ${titles.get(edge.target) ?? label('missingNode')}`,
          domAttributes: { 'data-edge': `${edge.source}:${edge.sourceHandle ?? 'out'}>${edge.target}` } as Record<string, string>,
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke }, style: { stroke, strokeWidth: active ? 3 : 1.5, ...(edge.data?.loopBack ? { strokeDasharray: '6 4' } : {}) } };
      })}
      nodesDraggable={!!edit} nodesConnectable={!!edit} deleteKeyCode={null} multiSelectionKeyCode={null}
      onInit={value => { instance.current = value; }} onPaneClick={() => onSelect(null)}
      onNodeClick={(_event, node) => onSelect({ kind: 'node', id: node.id })} onEdgeClick={(_event, edge) => onSelect({ kind: 'edge', id: edge.id })}
      onNodesChange={changes => { for (const change of changes) {
        if (change.type === 'position' && change.position) edit?.move(change.id, change.position);
        if (change.type === 'select' && change.selected) onSelect({ kind: 'node', id: change.id });
      } }}
      onEdgesChange={changes => { for (const change of changes) if (change.type === 'select' && change.selected) onSelect({ kind: 'edge', id: change.id }); }}
      onConnect={connection => edit?.connect(connection)}
      ariaLabelConfig={{ 'node.a11yDescription.default': label('canvasNodeKeys'), 'node.a11yDescription.keyboardDisabled': label('canvasNodeKeys'),
        'edge.a11yDescription.default': label('canvasEdgeKeys'), 'controls.ariaLabel': label('canvasControls'),
        'controls.zoomIn.ariaLabel': label('zoomIn'), 'controls.zoomOut.ariaLabel': label('zoomOut'), 'controls.fitView.ariaLabel': label('fit'), 'controls.interactive.ariaLabel': label('canvasControls') }}>
      <Background gap={20} size={1.3} color="var(--color-muted-foreground)" className="opacity-25" />
      <Controls showInteractive={false} />
    </ReactFlow>
  </div></AgentNames.Provider>;
}
