import type { WorldAgent, WorldModel } from '../data/types';
import type { DeskAnchor, Footprint, Point } from './zones';

export type Room = { id: string; name: string; x: number; z: number; depth: number; building: string; sign: boolean };
export const roomWidth = 26;
export const roomDepth = 24;
export const campusEntrance: Point = [18, -1];
export function campusRooms(buildings: WorldModel['buildings'], slotsByProject = new Map<string, number>()): Room[] {
  let nextNorth = -1 - roomDepth / 2;
  return buildings.flatMap(building => {
    return Array.from({ length: Math.ceil(building.rooms.length / 4) }, (_, row) => {
      const projects = building.rooms.slice(row * 4, row * 4 + 4);
      const depth = roomDepth + Math.max(0, ...projects.map(project => Math.floor((slotsByProject.get(project.id) ?? 0) / 6) - 3)) * 2.4;
      const z = nextNorth + depth - roomDepth / 2;
      nextNorth += depth;
      return projects.map((project, index) => ({ id: project.id, name: project.name, x: 34 + index * roomWidth,
        z, depth, building: building.name ?? '', sign: row === 0 && index === 0 }));
    }).flat();
  });
}

export const roomNorth = (room: Room) => room.z + roomDepth / 2 - room.depth;
export const roomCenterZ = (room: Room) => roomNorth(room) + room.depth / 2;
export function roomDesk(room: Room, agent: WorldAgent): DeskAnchor {
  const index = agent.slotIndex;
  const x = room.x - 8.5 + index % 6 * 3.4, z = room.z - 2 - Math.floor(index / 6) * 2.4;
  return { id: `desk:${agent.seatId}`, position: [x, z], yaw: 0, stand: [x, z - .82], seat: [x, z - .7], monitor: [x - .16, z + .24], sideMonitor: [x - .62, z + .02] };
}

export function roomStations(room: Room) {
  return { meeting: [room.x - 5, room.z + 6], approval: [room.x + 5, room.z + 6], board: [room.x + 8, room.z + 9], rest: [room.x, room.z + 9] } satisfies Record<string, Point>;
}

export function agentStation(agent: WorldAgent, now: number): 'desk' | 'meeting' | 'approval' | 'rest' | 'board' {
  if (agent.status === 'waiting') return 'approval';
  const sinceHandoff = agent.collaborationAt ? now - Date.parse(agent.collaborationAt) : Infinity;
  if (sinceHandoff >= -5000 && sinceHandoff < 25000) return 'meeting';
  if (agent.status === 'idle') return agent.workflowTask ? 'board' : 'rest';
  return 'desk';
}

export function roomDestination(room: Room, agent: WorldAgent, station: ReturnType<typeof agentStation>): [number, number, number] {
  if (station === 'desk') { const [x, z] = roomDesk(room, agent).seat; return [x, .48, z]; }
  const [x, z] = roomStations(room)[station];
  const slot = agent.slotIndex % 20;
  if (station === 'board') return [x - 1.5 + slot % 5 * .75, .04, z + .55 + Math.floor(slot / 5) * .45];
  if (station === 'rest') return [x - 1.5 + slot % 5 * .75, .04, z - .65 - Math.floor(slot / 5) * .55];
  const angle = slot % 12 * Math.PI / 6;
  const radius = slot < 12 ? 2.45 : 3.3;
  return [x + Math.cos(angle) * radius, .04, z + Math.sin(angle) * radius];
}

export function campusFootprints(rooms: Room[], agents: readonly WorldAgent[]): Footprint[] {
  const byRoom = new Map(rooms.map(room => [room.id, room]));
  const desks = agents.flatMap(agent => {
    const room = byRoom.get(agent.projectId);
    return room && !agent.overflow ? [{ id: agent.seatId, position: roomDesk(room, agent).position, half: [.87, .42] as Point, yaw: 0 }] : [];
  });
  return [...desks, ...rooms.flatMap(room => {
    const { meeting, approval, board } = roomStations(room);
    return [{ id: `meeting:${room.id}`, position: meeting, half: [1.3, 1.3] as Point, radius: 1.3, yaw: 0 },
      { id: `approval:${room.id}`, position: approval, half: [1.3, .6] as Point, yaw: 0 },
      { id: `board:${room.id}`, position: board, half: [2.3, .16] as Point, yaw: 0 }];
  })];
}
