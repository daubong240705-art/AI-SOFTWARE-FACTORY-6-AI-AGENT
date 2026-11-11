import dagre from '@dagrejs/dagre';
import type { Edge } from '@xyflow/react';
import type { WorkflowGraph, WorkflowStage } from '@/api/m5Models';
import { stageState, type WorkflowNode } from './graphTypes';

export const STAGE_WIDTH = 204;
export const STAGE_HEIGHT = 108;

export function layoutWorkflow(graph: WorkflowGraph, stages: WorkflowStage[] = [], phases: string[] = []) {
  const layout = new dagre.graphlib.Graph({ multigraph: true }).setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 52 }).setDefaultEdgeLabel(() => ({}));
  const definitions = [...new Map(graph.stages.map(stage => [stage.key, stage])).values()];
  const keys = new Set(definitions.map(stage => stage.key));
  const phaseKeys = [...new Set([...phases, ...definitions.map(stage => stage.phase)])];
  const nodes: WorkflowNode[] = definitions.map(definition => ({
    id: definition.key, type: 'stage', position: { x: 0, y: 0 }, width: STAGE_WIDTH, height: STAGE_HEIGHT,
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
      data: { ...edge, active: stageState(edge.to, stages).state === 'active',
        workingPath: stageState(edge.from, stages).state === 'done' && stageState(edge.to, stages).state === 'active' },
      className: edge.type === 'informs' ? '[&_.react-flow__edge-path]:stroke-[2_5]' : edge.type === 'rework' ? '[&_.react-flow__edge-path]:stroke-[6_5]' : '',
    });
  });
  gates.forEach((ids, stageKey) => ids.forEach((source, index) => {
    const target = ids[index + 1] ?? stageKey; const id = `gate-edge:${source}`;
    const workingPath = stageState(stageKey, stages).state === 'active' && graph.edges.some(edge => edge.to === stageKey && stageState(edge.from, stages).state === 'done');
    layout.setEdge(source, target, {}, id);
    edges.push({ id, source, target, data: { type: 'finish-to-start', active: stageState(stageKey, stages).state === 'active', workingPath } });
  }));
  dagre.layout(layout);
  nodes.forEach(node => { const at = layout.node(node.id); node.position = { x: at.x - (node.width ?? 0) / 2, y: at.y - (node.height ?? 0) / 2 }; });
  const stageNodes = nodes.filter(node => node.type === 'stage');
  const top = Math.min(0, ...nodes.map(node => node.position.y)) - 80;
  const bottom = Math.max(92, ...nodes.map(node => node.position.y + (node.height ?? 92))) + 64;
  const backgrounds: WorkflowNode[] = [];
  const W = STAGE_WIDTH; const H = STAGE_HEIGHT; const edge = 20;
  const spans = phaseKeys.map(phase => { const members = nodes.filter(node => node.type === 'stage' ? node.data.definition.phase === phase : false);
    return members.length ? { phase, left: Math.min(...members.map(node => node.position.x)), right: Math.max(...members.map(node => node.position.x + W)) } : null; })
    .filter((span): span is { phase: string; left: number; right: number } => span !== null).sort((a, b) => a.left - b.left);
  // Phases follow the dependencies, so a stage of a later phase can share a column with one of an earlier phase (parallel work across
  // phases): then bands would overlap, and a colour legend names the phases instead.
  const overlap = spans.some((span, index) => index > 0 && spans[index - 1]!.right > span.left);
  if (!overlap) spans.forEach((span, index) => {
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
    // With phase bands, a group spanning two phases would draw a frame across the boundary: leave it unframed.
    if (!overlap && new Set(members.map(node => node.data.definition.phase)).size > 1) return;
    const x = Math.min(...members.map(node => node.position.x)) - 12;
    const y = Math.min(...members.map(node => node.position.y)) - 36;
    const width = Math.max(...members.map(node => node.position.x + W)) - x + 12;
    const height = Math.max(...members.map(node => node.position.y + H)) - y + 16;
    const join = graph.joins.find(item => item.group === group);
    backgrounds.push({ id: `parallel:${group}`, type: 'parallel', position: { x, y }, width, height, style: { width, height },
      data: { label: group, policy: join?.policy ?? 'unknown', quorum: join?.n ?? null }, zIndex: -1, selectable: false, focusable: false, draggable: false });
  });
  const legend = overlap ? spans.map(span => ({ phase: span.phase, index: phaseKeys.indexOf(span.phase) })).sort((a, b) => a.index - b.index) : [];
  return { nodes: [...backgrounds, ...nodes], edges, legend };
}
