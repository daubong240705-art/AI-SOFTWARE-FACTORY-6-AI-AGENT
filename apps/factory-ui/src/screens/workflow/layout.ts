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
  dagre.layout(layout);
  nodes.forEach(node => { const at = layout.node(node.id); node.position = { x: at.x - (node.width ?? 0) / 2, y: at.y - (node.height ?? 0) / 2 }; });
  const stageNodes = nodes.filter(node => node.type === 'stage');
  const top = Math.min(0, ...nodes.map(node => node.position.y)) - 80;
  const bottom = Math.max(92, ...nodes.map(node => node.position.y + (node.height ?? 92))) + 64;
  const backgrounds: WorkflowNode[] = [];
  phaseKeys.forEach((phase, index) => {
    const members = stageNodes.filter(node => node.data.definition.phase === phase);
    if (!members.length) return;
    const x = Math.min(...members.map(node => node.position.x)) - 20;
    const right = Math.max(...members.map(node => node.position.x + 220)) + 20;
    backgrounds.push({ id: `phase:${index}`, type: 'band', position: { x, y: top }, width: right - x, height: bottom - top,
      style: { width: right - x, height: bottom - top }, data: { label: phase }, zIndex: -2, selectable: false, focusable: false, draggable: false });
  });
  const groups = [...new Set(definitions.map(stage => stage.parallelGroup).filter(group => group !== null))];
  groups.forEach(group => {
    const members = stageNodes.filter(node => node.data.definition.parallelGroup === group);
    const x = Math.min(...members.map(node => node.position.x)) - 12;
    const y = Math.min(...members.map(node => node.position.y)) - 36;
    const width = Math.max(...members.map(node => node.position.x + 220)) - x + 12;
    const height = Math.max(...members.map(node => node.position.y + 92)) - y + 16;
    const join = graph.joins.find(item => item.group === group);
    backgrounds.push({ id: `parallel:${group}`, type: 'parallel', position: { x, y }, width, height, style: { width, height },
      data: { label: group, policy: join?.policy ?? 'unknown', quorum: join?.n ?? null }, zIndex: -1, selectable: false, focusable: false, draggable: false });
  });
  return { nodes: [...backgrounds, ...nodes], edges };
}
