import type { WorldAgent } from '../data/types';
import { palette, type DeskAnchor, type Footprint, type Point } from './zones';

export const deskFloorNorth = 14;
const columns = 12;
const rowPitch = 3.2;
const rowOffset = (row: number) => row * rowPitch + Math.floor(row / 2) * .85;
export const deskFloorSouth = (count: number) => 24 + rowOffset(Math.max(0, Math.ceil(count / columns) - 1)) + rowPitch;
export const studioMeeting: Point = [-8, 18];
export const studioBoard: Point = [8, 16];

export function roomDesk(agent: Pick<WorldAgent, 'slotIndex' | 'seatId'>): DeskAnchor {
  const column = agent.slotIndex % columns;
  const x = -14.9 + column * 2.48 + Math.floor(column / 3) * .85;
  const z = 24 + rowOffset(Math.floor(agent.slotIndex / columns));
  return { id: `desk:${agent.seatId}`, position: [x, z], yaw: 0, stand: [x, z - 1.8], seat: [x, z - .94], monitor: [x - .16, z + .24], sideMonitor: [x - .62, z + .02] };
}

const projectColors = [palette.sky, palette.rose, palette.sage, palette.butter, palette.lavender, palette.mint, palette.apricot, '#F2C5DB', '#C6DDD7', '#D5CB9D', '#B9C7EB', '#DFCFED'];
export const projectColor = (index: number) => projectColors[index % projectColors.length] ?? palette.sky;

export function agentStation(agent: WorldAgent, now: number): 'desk' | 'meeting' | 'board' {
  if (agent.status !== 'working') return 'desk';
  const sinceHandoff = agent.collaborationAt ? now - Date.parse(agent.collaborationAt) : Infinity;
  if (sinceHandoff >= -5000 && sinceHandoff < 25000) return 'meeting';
  return agent.workflowTask ? 'board' : 'desk';
}

export type Position = [number, number, number];
export function roomDestination(agent: WorldAgent, station: ReturnType<typeof agentStation>): Position {
  if (station === 'desk') { const [x, z] = roomDesk(agent).seat; return [x, .48, z]; }
  const slot = agent.slotIndex % 20;
  if (station === 'board') return [studioBoard[0] - 2 + slot % 5, .04, studioBoard[1] + 1 + Math.floor(slot / 5) * .85];
  const angle = slot % 10 * Math.PI / 5;
  const radius = slot < 10 ? 2.35 : 3.35;
  return [studioMeeting[0] + Math.cos(angle) * radius, .04, studioMeeting[1] + Math.sin(angle) * radius];
}

export function campusFootprints(count: number): Footprint[] {
  return [{ id: 'studio-meeting', position: studioMeeting, half: [1.3, 1.3], radius: 1.3, yaw: 0 },
    { id: 'studio-board', position: studioBoard, half: [2.3, .16], yaw: 0 },
    ...Array.from({ length: count }, (_, slotIndex) => {
      const desk = roomDesk({ slotIndex, seatId: String(slotIndex) });
      return { id: desk.id, position: desk.position, half: [.87, .44] as Point, yaw: 0 };
    })];
}

export const clampStudioX = (x: number) => Math.max(-17.5, Math.min(17.5, x));
export const clampDeskZ = (z: number, south: number) => Math.max(deskFloorNorth + .35, Math.min(south - .35, z));
