import { anchors, desks, displayFrames, furnitureFootprints, loungeSpots, meetingSpots, portalPath, walkwayLanes, laneJunctions, navigationBounds, type Footprint, type Point } from './zones';
export type Waypoint = { readonly id: string; readonly position: Point };
export type Edge = readonly [string, string];
const clearance = 0.3;
// Segment vs oriented rectangle, in the furniture's local coordinates (Liang–Barsky).
export function intersectsFootprint(a: Point, b: Point, footprint: Footprint): boolean {
  if (footprint.radius !== undefined) {
    const dx = b[0] - a[0], dz = b[1] - a[1]; const length2 = dx * dx + dz * dz;
    const t = length2 ? Math.max(0, Math.min(1, ((footprint.position[0] - a[0]) * dx + (footprint.position[1] - a[1]) * dz) / length2)) : 0;
    return Math.hypot(a[0] + t * dx - footprint.position[0], a[1] + t * dz - footprint.position[1]) <= footprint.radius + clearance;
  }
  const c = Math.cos(footprint.yaw), s = Math.sin(footprint.yaw);
  const local = (p: Point): Point => { const x = p[0] - footprint.position[0], z = p[1] - footprint.position[1]; return [x * c - z * s, x * s + z * c]; };
  const p = local(a), q = local(b); let low = 0, high = 1;
  for (const axis of [0, 1] as const) {
    const half = footprint.half[axis] + clearance, delta = q[axis] - p[axis];
    if (Math.abs(delta) < 1e-9) { if (Math.abs(p[axis]) > half) return false; }
    else { const t1 = (-half - p[axis]) / delta, t2 = (half - p[axis]) / delta; low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2)); if (low > high) return false; }
  }
  return high >= 0 && low <= 1;
}
const clear = (a: Point, b: Point) => !furnitureFootprints.some(f => intersectsFootprint(a, b, f));
const round = (n: number) => Math.round(n * 10000) / 10000;
export const navigationAnchors: Record<string, Point> = Object.fromEntries(Object.entries({
  ...Object.fromEntries(desks.map(d => [d.id, d.stand])),
  ...Object.fromEntries(loungeSpots.map((p, i) => [`rest-${i}`, p])),
  ...Object.fromEntries(meetingSpots.map((p, i) => [`table-${i}`, p])),
  ...Object.fromEntries(displayFrames.map(f => [f.id, [f.position[0] + Math.sin(f.yaw) * 1, f.position[1] + Math.cos(f.yaw) * 1] as Point])),
  counter: [16.5, 10.6],
  'lab-bench': [anchors.labBench[0], anchors.labBench[1] + 1],
}).map(([id, p]) => [id, [round(p[0]!), round(p[1]!)] as Point]));
// Build an orthogonal visibility grid only during layout construction, then retain
// the lane intersections and short anchor stubs used by actual routes.
const margin = 0.035;
const xs = new Set(walkwayLanes.flatMap(lane => lane.map(p => p[0])));
const zs = new Set(walkwayLanes.flatMap(lane => lane.map(p => p[1])));
for (const p of Object.values(navigationAnchors)) { xs.add(p[0]); zs.add(p[1]); }
for (const f of furnitureFootprints) {
  const hx = Math.abs(Math.cos(f.yaw)) * (f.half[0] + clearance) + Math.abs(Math.sin(f.yaw)) * (f.half[1] + clearance) + margin;
  const hz = Math.abs(Math.sin(f.yaw)) * (f.half[0] + clearance) + Math.abs(Math.cos(f.yaw)) * (f.half[1] + clearance) + margin;
  for (const x of [f.position[0] - hx, f.position[0] + hx]) if (x > navigationBounds.x[0] && x < navigationBounds.x[1]) xs.add(round(x));
  for (const z of [f.position[1] - hz, f.position[1] + hz]) if (z > navigationBounds.z[0] && z < navigationBounds.z[1]) zs.add(round(z));
}
const xValues = [...xs].sort((a, b) => a - b), zValues = [...zs].sort((a, b) => a - b);
const width = xValues.length;
const point = (index: number): Point => [xValues[index % width]!, zValues[Math.floor(index / width)]!];
const indexOf = (p: Point) => zValues.indexOf(p[1]) * width + xValues.indexOf(p[0]);
const adjacency = new Map<number, { to: number; weight: number }[]>();
const connectGrid = (a: number, b: number) => { const p = point(a), q = point(b); if (!clear(p, q)) return; const weight = Math.hypot(p[0] - q[0], p[1] - q[1]); adjacency.set(a, [...(adjacency.get(a) ?? []), { to: b, weight }]); adjacency.set(b, [...(adjacency.get(b) ?? []), { to: a, weight }]); };
for (let z = 0; z < zValues.length; z++) for (let x = 0; x < width; x++) { const index = z * width + x; if (x + 1 < width) connectGrid(index, index + 1); if (z + 1 < zValues.length) connectGrid(index, index + width); }
// Multi-source Dijkstra routes each anchor to the nearest connected lane.
const distances = new Map<number, number>(); const previous = new Map<number, number>();
const heap: { node: number; cost: number }[] = [];
function push(item: { node: number; cost: number }) { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = Math.floor((i - 1) / 2); if (heap[p]!.cost <= item.cost) break; heap[i] = heap[p]!; i = p; } heap[i] = item; }
function pop() { const first = heap[0]!, last = heap.pop()!; if (heap.length) { let i = 0; while (true) { let child = i * 2 + 1; if (child >= heap.length) break; if (child + 1 < heap.length && heap[child + 1]!.cost < heap[child]!.cost) child++; if (heap[child]!.cost >= last.cost) break; heap[i] = heap[child]!; i = child; } heap[i] = last; } return first; }
for (let i = 0; i < width * zValues.length; i++) {
  const p = point(i); const onLane = walkwayLanes.some(([a, b]) => a[0] === b[0] ? p[0] === a[0] && p[1] >= a[1] && p[1] <= b[1] : p[1] === a[1] && p[0] >= a[0] && p[0] <= b[0]);
  if (onLane && adjacency.has(i)) { distances.set(i, 0); push({ node: i, cost: 0 }); }
}
while (heap.length) { const current = pop(); if (current.cost !== distances.get(current.node)) continue; for (const next of adjacency.get(current.node) ?? []) { const cost = current.cost + next.weight; if (cost < (distances.get(next.to) ?? Infinity)) { distances.set(next.to, cost); previous.set(next.to, current.node); push({ node: next.to, cost }); } } }
const nodes: Waypoint[] = []; const edges: Edge[] = []; const at = new Map<string, string>(); const edgeKeys = new Set<string>();
function add(p: Point, name?: string) { const key = `${p[0]},${p[1]}`; const existing = at.get(key); if (existing) return existing; const id = name ?? `lane-${nodes.length}`; nodes.push({ id, position: p }); at.set(key, id); return id; }
function join(a: string, b: string) { const key = [a, b].sort().join(':'); if (a !== b && !edgeKeys.has(key)) { edges.push([a, b]); edgeKeys.add(key); } }
const used = new Map<number, Set<number>>();
function useEdge(a: number, b: number) { used.set(a, (used.get(a) ?? new Set()).add(b)); used.set(b, (used.get(b) ?? new Set()).add(a)); }
const anchorIndices = new Set(Object.values(navigationAnchors).map(indexOf));
for (const [id, p] of Object.entries(navigationAnchors)) {
  const start = indexOf(p); add(p, id);
  if (!distances.has(start)) throw new Error(`Unreachable world anchor: ${id}`);
  let cursor = start; let direction: 'x' | 'z' | null = null;
  while (distances.get(cursor)! > 1e-8) {
    const here = point(cursor);
    const options = (adjacency.get(cursor) ?? []).filter(e => distances.get(e.to)! < distances.get(cursor)! - 1e-8 && Math.abs(distances.get(cursor)! - distances.get(e.to)! - e.weight) < 1e-7);
    const next = options.find(e => direction === (point(e.to)[0] !== here[0] ? 'x' : 'z'))?.to ?? options[0]?.to ?? previous.get(cursor)!;
    direction = point(next)[0] !== here[0] ? 'x' : 'z'; useEdge(cursor, next); cursor = next;
  }
}
// Keep branch points and corners; merge collinear temporary grid vertices.
const retained = new Set<number>([...anchorIndices]);
for (const [i, neighbours] of used) {
  const list = [...neighbours]; if (list.length !== 2) retained.add(i);
  else { const a = point(list[0]!), b = point(list[1]!); if (a[0] !== b[0] && a[1] !== b[1]) retained.add(i); }
}
for (const i of retained) {
  const a = add(point(i));
  for (const first of used.get(i) ?? []) { let before = i, cursor = first; while (!retained.has(cursor)) { const next = [...used.get(cursor)!].find(n => n !== before)!; before = cursor; cursor = next; } join(a, add(point(cursor))); }
}
for (const p of laneJunctions) add(p);
// Explicit centreline links preserve the intended main north/south and inner lanes.
for (const [a, b] of walkwayLanes) {
  const crossings = nodes.filter(n => a[0] === b[0] ? n.position[0] === a[0] && n.position[1] >= a[1] && n.position[1] <= b[1] : n.position[1] === a[1] && n.position[0] >= a[0] && n.position[0] <= b[0]);
  const line = [a, ...crossings.map(n => n.position), b].sort((p, q) => a[0] === b[0] ? p[1] - q[1] : p[0] - q[0]);
  for (let i = 1; i < line.length; i++) if (clear(line[i - 1]!, line[i]!)) join(add(line[i - 1]!), add(line[i]!));
}
const portalEntry = add(walkwayLanes[0]![1]); let tail = portalEntry;
for (let i = 0; i < portalPath.length; i++) { const next = add(portalPath[i]!, i === portalPath.length - 1 ? 'portal' : undefined); join(tail, next); tail = next; }
// Bound the first perpendicular step at every destination even when the next
// retained lane intersection is farther away.
for (let i = edges.length - 1; i >= 0; i--) {
  const [a, b] = edges[i]!; const p = nodes.find(n => n.id === a)!.position, q = nodes.find(n => n.id === b)!.position;
  const length = Math.hypot(p[0] - q[0], p[1] - q[1]); if (length <= 2) continue;
  const atStart = a in navigationAnchors, atEnd = b in navigationAnchors; if (!atStart && !atEnd) continue;
  edges.splice(i, 1); let tail = a;
  if (atStart) { const t = Math.min(1.5 / length, 0.5); const stub = add([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); join(tail, stub); tail = stub; }
  if (atEnd) { const t = Math.max(1 - 1.5 / length, 0.5); const stub = add([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); join(tail, stub); tail = stub; }
  join(tail, b);
}
const byId = new Map(nodes.map(n => [n.id, n]));
export function findBlockedEdges(candidateEdges: readonly Edge[] = edges): Edge[] { return candidateEdges.filter(([a, b]) => !clear(byId.get(a)!.position, byId.get(b)!.position)); }
const blockedEdges = findBlockedEdges();
if (import.meta.env.DEV) console.assert(blockedEdges.length === 0, 'World walkway edges intersect furniture', blockedEdges);
export const layout = Object.freeze({
  nodes: Object.freeze(nodes.map(n => Object.freeze({ ...n, position: Object.freeze([...n.position]) as Point }))),
  edges: Object.freeze(edges.map(e => Object.freeze([...e]) as Edge)),
  blockedEdges: blockedEdges.length,
});
const cache = new Map<string, Point[]>();
export function pathBetween(fromAnchor: string, toAnchor: string): [number, number][] {
  const key = `${fromAnchor}:${toAnchor}`; const hit = cache.get(key); if (hit) return hit.map(p => [p[0], p[1]]);
  if (!byId.has(fromAnchor) || !byId.has(toAnchor)) return [];
  const costs = new Map<string, number>([[fromAnchor, 0]]), prev = new Map<string, string>(); const pending = new Set(nodes.map(n => n.id));
  while (pending.size) {
    let current: string | undefined; let best = Infinity; for (const id of pending) { const cost = costs.get(id) ?? Infinity; if (cost < best) { best = cost; current = id; } }
    if (!current) break; pending.delete(current); if (current === toAnchor) break;
    for (const [a, b] of edges) { const next = a === current ? b : b === current ? a : null; if (!next || !pending.has(next)) continue; const p = byId.get(current)!.position, q = byId.get(next)!.position; const cost = best + Math.hypot(p[0] - q[0], p[1] - q[1]); if (cost < (costs.get(next) ?? Infinity)) { costs.set(next, cost); prev.set(next, current); } }
  }
  if (!costs.has(toAnchor)) return [];
  const result: Point[] = []; let cursor: string | undefined = toAnchor; while (cursor) { result.unshift(byId.get(cursor)!.position); cursor = prev.get(cursor); }
  cache.set(key, result); return result.map(p => [p[0], p[1]]);
}
