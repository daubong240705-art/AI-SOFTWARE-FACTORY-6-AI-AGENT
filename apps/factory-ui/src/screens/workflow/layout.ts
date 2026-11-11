import dagre from '@dagrejs/dagre';
import type { Edge } from '@xyflow/react';
import type { WorkflowGraph, WorkflowStage } from '@/api/m5Models';
import { stageState, type WorkflowNode } from './graphTypes';

export function layoutWorkflow(graph: WorkflowGraph, stages: WorkflowStage[] = [], phases: string[] = []) {
  const layout = new dagre.graphlib.Graph({ multigraph: true }).setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 52 }).setDefaultEdgeLabel(() => ({}));
  const definitions = [...new Map(graph.stages.map(stage => [stage.key, stage])).values()];
  const keys = new Set(definitions.map(stage => stage.key));
  const phaseKeys = [...new Set([...phases, ...definitions.map(stage => stage.phase)])];
  const nodes: WorkflowNode[] = definitions.map(definition => ({
    id: definition.key, type: 'stage', position: { x: 0, y: 0 }, width: 204, height: 88,
    data: { definition, stage: stageState(definition.key, stages), phaseIndex: phaseKeys.indexOf(definition.phase),
      maxLoops: Math.max(0, ...graph.edges.filter(edge => edge.type === 'rework' && edge.to === definition.key).map(edge => edge.maxLoops ?? 0)) || null },
  }));
  const gates = new Map<string, string[]>();
  graph.gates.forEach((gate, index) => {
    if (!keys.has(gate.before)) return;
    const id = `gate:${index}`; const ids = gates.get(gate.before) ?? []; ids.push(id); gates.set(gate.before, ids);
    const stage = stageState(gate.before, stages);
    const waiting = stage.tasks.some(task => task.state === 'awaiting-go' || (gate.kind === 'review' && task.state === 'in-review'));
    nodes.push({ id, type: 'gate', position: { x: 0, y: 0 }, width: 44, height: 44, data: { gate, waiting } });
  });
  nodes.forEach(node => layout.setNode(node.id, { width: node.width, height: node.height }));
  const edges: Edge[] = [];
  graph.edges.forEach((edge, index) => {
    if (!keys.has(edge.from) || !keys.has(edge.to)) return;
    const target = gates.get(edge.to)?.[0] ?? edge.to;
    const id = `edge:${index}`;
    if (edge.type !== 'rework') layout.setEdge(edge.from, target, {}, id);
    edges.push({ id, source: edge.from, target, type: edge.type === 'rework' ? 'rework' : 'default',
      data: { ...edge, active: stageState(edge.to, stages).state === 'active' },
      className: edge.type === 'informs' ? '[&_.react-flow__edge-path]:stroke-[2_5]' : edge.type === 'rework' ? '[&_.react-flow__edge-path]:stroke-[6_5]' : '',
    });
  });
  gates.forEach((ids, stageKey) => ids.forEach((source, index) => {
    const target = ids[index + 1] ?? stageKey; const id = `gate-edge:${source}`;
    layout.setEdge(source, target, {}, id);
    edges.push({ id, source, target, data: { type: 'finish-to-start', active: stageState(stageKey, stages).state === 'active' } });
  }));
  // Dagre ranks by dependency only. Invisible anchors between consecutive phases force every stage of a phase to sit
  // after every stage of the previous one, so phase bands are contiguous columns and never overlap their neighbours.
  const phased = phaseKeys.filter(phase => definitions.some(stage => stage.phase === phase));
  phased.forEach((phase, index) => {
    const before = definitions.filter(stage => stage.phase === phased[index - 1]); const after = definitions.filter(stage => stage.phase === phase);
    if (index === 0 || !before.length || !after.length) return;
    const id = `anchor:${index}`; layout.setNode(id, { width: 2, height: 2 });
    before.forEach(stage => layout.setEdge(stage.key, id, { weight: 0 }, `phase-in:${index}:${stage.key}`));
    after.forEach(stage => layout.setEdge(id, stage.key, { weight: 0 }, `phase-out:${index}:${stage.key}`));
  });
  dagre.layout(layout);
  nodes.forEach(node => { const at = layout.node(node.id); node.position = { x: at.x - (node.width ?? 0) / 2, y: at.y - (node.height ?? 0) / 2 }; });
  const stageNodes = nodes.filter(node => node.type === 'stage');
  const top = Math.min(0, ...nodes.map(node => node.position.y)) - 80;
  const bottom = Math.max(92, ...nodes.map(node => node.position.y + (node.height ?? 92))) + 64;
  const backgrounds: WorkflowNode[] = [];
  const W = 204; const H = 88; const edge = 20;
  const spans = phaseKeys.map(phase => { const members = nodes.filter(node => node.type === 'stage' ? node.data.definition.phase === phase : false);
    return members.length ? { phase, left: Math.min(...members.map(node => node.position.x)), right: Math.max(...members.map(node => node.position.x + W)) } : null; })
    .filter((span): span is { phase: string; left: number; right: number } => span !== null).sort((a, b) => a.left - b.left);
  spans.forEach((span, index) => {
    const previous = spans[index - 1]; const next = spans[index + 1];
    // Bands meet halfway through the gap between two phases (gates sit in that gap), so they never overlap.
    const left = previous ? (previous.right + span.left) / 2 + 3 : span.left - edge;
    const right = next ? (span.right + next.left) / 2 - 3 : span.right + edge;
    backgrounds.push({ id: `phase:${index}`, type: 'band', position: { x: left, y: top }, width: right - left, height: bottom - top,
      style: { width: right - left, height: bottom - top }, data: { label: span.phase }, zIndex: -2, selectable: false, focusable: false, draggable: false });
  });
  const groups = [...new Set(definitions.map(stage => stage.parallelGroup).filter(group => group !== null))];
  groups.forEach(group => {
    const members = stageNodes.filter(node => node.data.definition.parallelGroup === group);
    // A group that spans two phases would draw a frame across the phase boundary: leave it unframed.
    if (new Set(members.map(node => node.data.definition.phase)).size > 1) return;
    const x = Math.min(...members.map(node => node.position.x)) - 12;
    const y = Math.min(...members.map(node => node.position.y)) - 36;
    const width = Math.max(...members.map(node => node.position.x + W)) - x + 12;
    const height = Math.max(...members.map(node => node.position.y + H)) - y + 16;
    const join = graph.joins.find(item => item.group === group);
    backgrounds.push({ id: `parallel:${group}`, type: 'parallel', position: { x, y }, width, height, style: { width, height },
      data: { label: group, policy: join?.policy ?? 'unknown', quorum: join?.n ?? null }, zIndex: -1, selectable: false, focusable: false, draggable: false });
  });
  return { nodes: [...backgrounds, ...nodes], edges };
}
