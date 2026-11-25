import { clampDeskZ, clampStudioX, deskFloorNorth, type Position } from './campus';
import { intersectsFootprint } from './waypoints';
import type { Footprint, Point } from './zones';

export function studioNavigation(south: number, furniture: readonly Footprint[]) {
  const width = 36;
  const points: Point[] = [];
  const edges: number[][] = [];
  const clear = (from: Point, to: Point) => !furniture.some(item => intersectsFootprint(from, to, item));
  for (let z = deskFloorNorth + .5; z <= south - .35; z++) {
    for (let x = -17.5; x <= 17.5; x++) {
      const point: Point = [x, z];
      const index = points.push(point) - 1;
      edges.push([]);
      if (!clear(point, point)) continue;
      for (const neighbor of [x === -17.5 ? -1 : index - 1, index - width]) {
        if (neighbor < 0 || !clear(point, points[neighbor]!)) continue;
        edges[index]!.push(neighbor);
        edges[neighbor]!.push(index);
      }
    }
  }
  const nearby = (point: Point) => points.flatMap((tile, index) => {
    const distance = Math.hypot(tile[0] - point[0], tile[1] - point[1]);
    return distance <= 1.5 && edges[index]!.length && clear(point, tile) ? [{ index, distance }] : [];
  }).sort((left, right) => left.distance - right.distance).map(tile => tile.index);
  const route = (from: Position, to: Position): Position[] => {
    const start: Point = [clampStudioX(from[0]), clampDeskZ(from[2], south)];
    const end: Point = [clampStudioX(to[0]), clampDeskZ(to[2], south)];
    const targets = new Set(nearby(end));
    const queue = nearby(start);
    const previous = new Map(queue.map(index => [index, -1]));
    for (let step = 0; step < queue.length; step++) {
      const index = queue[step]!;
      if (targets.has(index)) {
        const path: Position[] = [[end[0], to[1], end[1]]];
        for (let tile = index; tile !== -1; tile = previous.get(tile)!) path.push([points[tile]![0], .04, points[tile]![1]]);
        path.push([start[0], from[1], start[1]]);
        return path.reverse();
      }
      for (const next of edges[index]!) if (!previous.has(next)) { previous.set(next, index); queue.push(next); }
    }
    return [];
  };
  return Object.assign(route, { points, edges });
}
