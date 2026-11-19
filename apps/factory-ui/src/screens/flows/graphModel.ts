import dagre from '@dagrejs/dagre';
import { FLOW_NODE_PORTS, type FlowDefinition, type FlowEdge, type FlowNode, type FlowNodeRunState } from '@factory/contracts';
import type { Edge, Node, XYPosition } from '@xyflow/react';

export type CanvasNode = Node<{ node: FlowNode; invalid?: boolean; state?: FlowNodeRunState }, 'flow'>;
export type CanvasEdge = Edge<{ loopBack: boolean }>;
export const nodeWidth = 212;
export const nodeHeight = (node: FlowNode) => 86 + FLOW_NODE_PORTS(node).length * 20;

function fallback(index: number): XYPosition {
  return { x: (index % 3) * 290, y: Math.floor(index / 3) * 340 };
}

export function definitionToGraph(definition: FlowDefinition) {
  const { nodes, edges, ...metadata } = definition;
  return {
    metadata,
    nodes: nodes.map((node, index): CanvasNode => ({ id: node.id, type: 'flow', width: nodeWidth, height: nodeHeight(node),
      position: { ...(definition.layout[node.id] ?? fallback(index)) }, data: { node } })),
    edges: edges.map((edge): CanvasEdge => ({ id: edge.id, source: edge.from.node, sourceHandle: edge.from.port,
      target: edge.to.node, targetHandle: 'in', data: { loopBack: edge.loopBack } })),
  };
}

export function graphToDefinition({ metadata, nodes, edges }: ReturnType<typeof definitionToGraph>): FlowDefinition {
  const layout = { ...metadata.layout };
  nodes.forEach(({ id, position }, index) => {
    const initial = fallback(index);
    if (Object.hasOwn(layout, id) || initial.x !== position.x || initial.y !== position.y) layout[id] = { ...position };
  });
  return { ...metadata, layout, nodes: nodes.map(({ id, data }) => ({ ...data.node, id })),
    edges: edges.map(({ id, source, sourceHandle, target, data }) => ({ id, from: { node: source, port: sourceHandle ?? '' },
      to: { node: target }, loopBack: data?.loopBack ?? false })) };
}

export function isLoopReturn(definition: FlowDefinition, source: string, target: string): boolean {
  if (source === target || !definition.nodes.some(node => node.id === target && node.type === 'loop')) return false;
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of definition.edges) {
    if (edge.loopBack) continue;
    const list = outgoing.get(edge.from.node) ?? [];
    list.push(edge);
    outgoing.set(edge.from.node, list);
  }
  const queue = (outgoing.get(target) ?? []).filter(edge => edge.from.port === 'body').map(edge => edge.to.node);
  const visited = new Set([target]);
  while (queue.length) {
    const next = queue.pop()!;
    if (visited.has(next)) continue;
    if (next === source) return true;
    visited.add(next);
    for (const edge of outgoing.get(next) ?? []) queue.push(edge.to.node);
  }
  return false;
}

export function autoLayout(definition: FlowDefinition): FlowDefinition['layout'] {
  const graph = new dagre.graphlib.Graph({ multigraph: true }).setGraph({ rankdir: 'LR', ranksep: 100, nodesep: 48, marginx: 32, marginy: 32 }).setDefaultEdgeLabel(() => ({}));
  for (const node of definition.nodes) graph.setNode(node.id, { width: nodeWidth, height: nodeHeight(node) });
  for (const edge of definition.edges) if (!edge.loopBack && graph.hasNode(edge.from.node) && graph.hasNode(edge.to.node))
    graph.setEdge(edge.from.node, edge.to.node, {}, edge.id);
  dagre.layout(graph);
  return Object.fromEntries(definition.nodes.map(node => {
    const { x, y } = graph.node(node.id);
    return [node.id, { x: x - nodeWidth / 2, y: y - nodeHeight(node) / 2 }];
  }));
}
