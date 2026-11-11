import { useEffect, useMemo, useRef } from 'react';
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
  const flow = useRef<{ getZoom: () => number; setCenter: (x: number, y: number, options?: { zoom?: number; duration?: number }) => unknown } | null>(null);
  // The stage drawer covers the right side of the canvas: bring the selected stage into the part that stays visible.
  useEffect(() => {
    const instance = flow.current; const node = selectedStage ? layout.nodes.find(item => item.id === selectedStage && item.type === 'stage') : undefined;
    if (!instance || !node || preview) return;
    const zoom = instance.getZoom();
    void instance.setCenter(node.position.x + (node.width ?? 204) / 2 + 184 / zoom, node.position.y + (node.height ?? 88) / 2, { zoom, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 });
  }, [selectedStage, layout.nodes, preview]);
  const nodes = useMemo(() => layout.nodes.map(node => ({ ...node, selected: node.type === 'stage' && node.id === selectedStage,
    ...(node.type === 'stage' ? { ariaLabel: `${node.data.definition.title || node.id}, ${t(`m5Ui.states.${node.data.stage.state}`)}` } : {}),
  })), [layout.nodes, selectedStage, t]);
  const edges = layout.edges.map(edge => {
    const data = edge.data;
    const kind = data?.type;
    const label = kind === 'rework' ? t('workflowGraph.rework').replace('{count}', String(data?.maxLoops ?? '?'))
      : undefined;
    return { ...edge, ...(label === undefined ? {} : { label }), labelStyle: { fill: 'var(--muted)', fontSize: 11 }, labelBgStyle: { fill: 'var(--surface)' },
      ...(kind === 'informs' ? {} : { markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--muted)' } }),
      animated: !!data?.active && kind !== 'rework',
      className: cn(typeof edge.className === 'string' ? edge.className : undefined, '[&_.react-flow__edge-path]:!stroke-muted-foreground', data?.active === true && 'motion-reduce:[&_.react-flow__edge-path]:animate-none'),
    };
  });
  return <ReactFlow onInit={instance => { flow.current = instance; }} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
    aria-label={t(preview ? 'workflowGraph.preview' : 'workflowGraph.diagram')} nodesDraggable={false} nodesConnectable={false} elementsSelectable={!preview}
    nodesFocusable={!preview} edgesFocusable={false} panOnScroll={!preview} panOnDrag={!preview} zoomOnScroll={!preview} zoomOnPinch={!preview} zoomOnDoubleClick={false}
    minZoom={preview ? 0.05 : 0.4} maxZoom={1.6} fitView fitViewOptions={{ padding: 0.06, minZoom: preview ? 0.05 : 0.55, maxZoom: 1 }}
    onNodeClick={(_, node) => { if (node.type === 'stage') onSelectStage?.(node.id); }}
    onPaneClick={() => onSelectStage?.(null)} proOptions={{ hideAttribution: true }}
    className="[--xy-background-color:var(--bg)] [--xy-controls-button-background-color:var(--surface)] [--xy-controls-button-background-color-hover:var(--raised)] [--xy-controls-button-color:var(--text)] [--xy-controls-button-border-color:var(--line)] [--xy-minimap-background-color:var(--surface)] [--xy-minimap-mask-background-color:var(--bg)] [&_.react-flow__node-band]:pointer-events-none [&_.react-flow__node-parallel]:pointer-events-none">
    <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--line)" />
    {!preview && <><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={node => {
      const state = node.data.stage as { state?: string } | undefined;
      return state?.state === 'active' ? 'var(--run)' : state?.state === 'done' ? 'var(--ok)' : ['failed', 'blocked'].includes(state?.state ?? '') ? 'var(--info)' : node.type === 'stage' ? 'var(--muted)' : 'var(--raised)';
    }} /></>}
  </ReactFlow>;
}
