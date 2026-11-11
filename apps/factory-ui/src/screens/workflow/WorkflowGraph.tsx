import { useMemo } from 'react';
import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { layoutWorkflow } from './layout';
import { BandNode, GateNode, StageNode } from './WorkflowNodes';
import { ReworkEdge } from './ReworkEdge';
import type { WorkflowGraphProps } from './graphTypes';

const nodeTypes = { stage: StageNode, gate: GateNode, band: BandNode, parallel: BandNode };
const edgeTypes = { rework: ReworkEdge };
const noStages: NonNullable<WorkflowGraphProps['stages']> = [];
const noPhases: string[] = [];
export default function WorkflowGraph({ graph, stages = noStages, phases = noPhases, selectedStage, onSelectStage, preview = false }: WorkflowGraphProps) {
  const t = useT();
  const layout = useMemo(() => layoutWorkflow(graph, stages, phases), [graph, stages, phases]);
  const nodes = useMemo(() => layout.nodes.map(node => ({ ...node, selected: node.type === 'stage' && node.id === selectedStage,
    ...(node.type === 'stage' ? { ariaLabel: `${node.data.definition.title || node.id}, ${t(`m5Ui.states.${node.data.stage.state}`)}` } : {}),
  })), [layout.nodes, selectedStage, t]);
  const edges = layout.edges.map(edge => {
    const data = edge.data;
    const kind = data?.type;
    const label = kind === 'rework' ? t('workflowGraph.rework').replace('{count}', String(data?.maxLoops ?? '?'))
      : kind === 'artifact-approved' && typeof data?.artifact === 'string' ? t('workflowGraph.approvedArtifact').replace('{kind}', t(`knowledgeUi.kinds.${data.artifact}`)) : undefined;
    return { ...edge, ...(label === undefined ? {} : { label }), labelStyle: { fill: 'var(--muted)', fontSize: 11 }, labelBgStyle: { fill: 'var(--surface)' },
      ...(kind === 'informs' ? {} : { markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--muted)' } }),
      animated: !!data?.active && kind !== 'rework',
      className: cn(typeof edge.className === 'string' ? edge.className : undefined, '[&_.react-flow__edge-path]:!stroke-muted-foreground', data?.active === true && 'motion-reduce:[&_.react-flow__edge-path]:animate-none'),
    };
  });
  return <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
    aria-label={t(preview ? 'workflowGraph.preview' : 'workflowGraph.diagram')} nodesDraggable={false} nodesConnectable={false} elementsSelectable={!preview}
    nodesFocusable={!preview} edgesFocusable={false} panOnScroll={!preview} panOnDrag={!preview} zoomOnScroll={!preview} zoomOnPinch={!preview} zoomOnDoubleClick={false}
    minZoom={preview ? 0.05 : 0.4} maxZoom={1.6} fitView fitViewOptions={{ padding: 0.06, minZoom: preview ? 0.05 : 0.72, maxZoom: 1 }}
    onNodeClick={(_, node) => { if (node.type === 'stage') onSelectStage?.(node.id); }}
    onSelectionChange={({ nodes: selected }) => { const stage = selected.find(node => node.type === 'stage'); if (stage) onSelectStage?.(stage.id); }}
    onPaneClick={() => onSelectStage?.(null)} proOptions={{ hideAttribution: true }}
    className="[--xy-background-color:var(--bg)] [--xy-controls-button-background-color:var(--surface)] [--xy-controls-button-background-color-hover:var(--raised)] [--xy-controls-button-color:var(--text)] [--xy-controls-button-border-color:var(--line)] [--xy-minimap-background-color:var(--surface)] [--xy-minimap-mask-background-color:var(--bg)] [&_.react-flow__node-band]:pointer-events-none [&_.react-flow__node-parallel]:pointer-events-none">
    <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--line)" />
    {!preview && <><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={node => {
      const state = node.data.stage as { state?: string } | undefined;
      return state?.state === 'active' ? 'var(--run)' : state?.state === 'done' ? 'var(--ok)' : ['failed', 'blocked'].includes(state?.state ?? '') ? 'var(--info)' : node.type === 'stage' ? 'var(--muted)' : 'var(--raised)';
    }} /></>}
  </ReactFlow>;
}
