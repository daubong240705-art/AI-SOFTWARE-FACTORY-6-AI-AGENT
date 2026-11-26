import type { Position } from './campus';
import { deskWidth, type RoleOffice } from './roleOffice';
import { intersectsFootprint } from './waypoints';
import type { Point } from './zones';

function onSegment(point: Point, first: Point, last: Point) {
  return point.every((value, axis) => value >= Math.min(first[axis]!, last[axis]!) && value <= Math.max(first[axis]!, last[axis]!));
}

export function pathsConflict(path: readonly Position[], other: readonly Position[]) {
  const gap = (first: number, last: number, start: number, end: number) => Math.max(0,
    Math.min(first, last) - Math.max(start, end), Math.min(start, end) - Math.max(first, last));
  for (let index = 1; index < path.length; index++) {
    const first = path[index - 1]!, last = path[index]!;
    for (let step = 1; step < other.length; step++) {
      const start = other[step - 1]!, end = other[step]!;
      if (Math.hypot(gap(first[0], last[0], start[0], end[0]), gap(first[2], last[2], start[2], end[2])) < deskWidth) return true;
    }
  }
  return false;
}

export function studioNavigation({ walkways, furniture }: RoleOffice) {
  const points: Point[] = [], edges: number[][] = [];
  const indices = new Map<string, number>();
  const node = (point: Point) => {
    const key = point.join(',');
    const known = indices.get(key);
    if (known !== undefined) return known;
    const index = points.length;
    points.push(point); edges.push([]); indices.set(key, index);
    return index;
  };
  for (const [first, last] of walkways) {
    const axis = first[0] === last[0] ? 1 : 0;
    const crossings = [first, last];
    for (const [start, end] of walkways) {
      if (onSegment(start, first, last)) crossings.push(start);
      if (onSegment(end, first, last)) crossings.push(end);
      if (start[axis] !== end[axis]) continue;
      const crossing: Point = axis === 0 ? [start[0], first[1]] : [first[0], start[1]];
      if (onSegment(crossing, first, last) && onSegment(crossing, start, end)) crossings.push(crossing);
    }
    const line = [...new Set(crossings.sort((left, right) => left[axis] - right[axis]).map(node))];
    for (let index = 1; index < line.length; index++) {
      const from = line[index - 1]!, to = line[index]!;
      if (edges[from]!.includes(to) || furniture.some(item => intersectsFootprint(points[from]!, points[to]!, item))) continue;
      edges[from]!.push(to); edges[to]!.push(from);
    }
  }
  const route = (from: Position, to: Position): Position[] => {
    const start = indices.get(`${from[0]},${from[2]}`), end = indices.get(`${to[0]},${to[2]}`);
    if (start === undefined || end === undefined || start === end) return [];
    const queue = [start];
    const previous = new Map([[start, -1]]);
    for (let step = 0; step < queue.length; step++) {
      const index = queue[step]!;
      if (index === end) {
        const path = [to];
        for (let tile = previous.get(index)!; tile !== start; tile = previous.get(tile)!) path.push([points[tile]![0], .04, points[tile]![1]]);
        return [from, ...path.reverse()];
      }
      for (const next of edges[index]!) if (!previous.has(next)) { previous.set(next, index); queue.push(next); }
    }
    return [];
  };
  return Object.assign(route, { points, edges });
}
