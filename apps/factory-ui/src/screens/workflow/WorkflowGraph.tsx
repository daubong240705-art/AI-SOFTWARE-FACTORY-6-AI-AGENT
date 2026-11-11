import { useEffect, useMemo, useRef } from 'react';
import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, Panel, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { layoutWorkflow, STAGE_HEIGHT, STAGE_WIDTH } from './layout';
import { BandNode, GateNode, StageNode } from './WorkflowNodes';
import { ReworkEdge } from './ReworkEdge';
import type { WorkflowGraphProps } from './graphTypes';
import { noLiveRuns } from './useLiveRuns';

const nodeTypes = { stage: StageNode, gate: GateNode, band: BandNode, parallel: BandNode };
const edgeTypes = { rework: ReworkEdge };
const noStages: NonNullable<WorkflowGraphProps['stages']> = [];
const noPhases: string[] = [];
export default function WorkflowGraph({ graph, stages = noStages, phases = noPhases, liveRuns = noLiveRuns, selectedStage, onSelectStage, preview = false }: WorkflowGraphProps) {
  const t = useT();
  const layout = useMemo(() => layoutWorkflow(graph, stages, phases), [graph, stages, phases]);
  const flow = useRef<{ getZoom: () => number; setCenter: (x: number, y: number, options?: { zoom?: number; duration?: number }) => unknown } | null>(null);
  // The stage drawer covers the right side of the canvas: bring the selected stage into the part that stays visible.
  useEffect(() => {
    const instance = flow.current; const node = selectedStage ? layout.nodes.find(item => item.id === selectedStage && item.type === 'stage') : undefined;
    if (!instance || !node || preview) return;
    const zoom = instance.getZoom();
    void instance.setCenter(node.position.x + (node.width ?? STAGE_WIDTH) / 2 + 184 / zoom, node.position.y + (node.height ?? STAGE_HEIGHT) / 2, { zoom, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 });
  }, [selectedStage, layout.nodes, preview]);
  const nodes = useMemo(() => layout.nodes.map(node => {
    if (node.type !== 'stage') return { ...node, selected: false };
    return { ...node, selected: node.id === selectedStage, data: { ...node.data, liveRuns },
      ariaLabel: `${node.data.definition.title || node.id}, ${t(`m5Ui.states.${node.data.stage.state}`)}` };
  }), [layout.nodes, selectedStage, liveRuns, t]);
  const edges = layout.edges.map(edge => {
    const data = edge.data;
    const kind = data?.type;
    const label = kind === 'rework' ? t('workflowGraph.rework').replace('{count}', String(data?.maxLoops ?? '?'))
      : undefined;
    return { ...edge, ...(label === undefined ? {} : { label }), labelStyle: { fill: 'var(--muted)', fontSize: 11 }, labelBgStyle: { fill: 'var(--surface)' },
      ...(kind === 'informs' ? {} : { markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--muted)' } }),
      animated: !!data?.active && kind !== 'rework',
      className: cn(typeof edge.className === 'string' ? edge.className : undefined,
        data?.workingPath === true ? '[&_.react-flow__edge-path]:!stroke-run' : '[&_.react-flow__edge-path]:!stroke-muted-foreground',
        data?.active === true && 'motion-reduce:[&_.react-flow__edge-path]:animate-none'),
    };
  });
  return <ReactFlow onInit={instance => { flow.current = instance; }} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
    aria-label={t(preview ? 'workflowGraph.preview' : 'workflowGraph.diagram')} nodesDraggable={false} nodesConnectable={false} elementsSelectable={!preview}
    nodesFocusable={!preview} edgesFocusable={false} panOnScroll={!preview} panOnDrag={!preview} zoomOnScroll={!preview} zoomOnPinch={!preview} zoomOnDoubleClick={false}
    minZoom={preview ? 0.05 : 0.4} maxZoom={1.6} fitView fitViewOptions={{ padding: 0.06, minZoom: preview ? 0.05 : 0.55, maxZoom: 1 }}
    onNodeClick={(_, node) => { if (node.type === 'stage') onSelectStage?.(node.id); }}
    onPaneClick={() => onSelectStage?.(null)} proOptions={{ hideAttribution: true }}
    className="[--xy-background-color:var(--bg)] [--xy-controls-button-background-color:var(--surface)] [--xy-controls-button-background-color-hover:var(--raised)] [--xy-controls-button-color:var(--text)] [--xy-controls-button-border-color:var(--line)] [--xy-minimap-background-color:var(--surface)] [--xy-minimap-mask-background-color:var(--bg)] [&_.react-flow__node-band]:pointer-events-none [&_.react-flow__node-parallel]:pointer-events-none">
    {layout.legend.length > 0 && <Panel position="top-left" className="flex max-w-[60%] flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-card/90 px-3 py-2 text-[11px] tracking-wide text-muted-foreground uppercase"><span className="sr-only">{t('workflowGraph.phase')}</span>{layout.legend.map(item => <span key={item.phase} className="flex items-center gap-1.5"><span aria-hidden className={['bg-project-1', 'bg-project-2', 'bg-project-3', 'bg-project-4'][item.index % 4]! + ' size-2 rounded-sm'} />{item.phase}</span>)}</Panel>}
    <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--line)" />
    {!preview && <><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={node => {
      const state = node.data.stage as { state?: string } | undefined;
      return state?.state === 'active' ? 'var(--run)' : state?.state === 'done' ? 'var(--ok)' : ['failed', 'blocked'].includes(state?.state ?? '') ? 'var(--info)' : node.type === 'stage' ? 'var(--muted)' : 'var(--raised)';
    }} /></>}
  </ReactFlow>;
}
