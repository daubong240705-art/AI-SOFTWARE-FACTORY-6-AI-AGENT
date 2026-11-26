import type { WorldAgent } from '../data/types';
import { palette, type DeskAnchor } from './zones';
import type { OfficeStation } from './roleOffice';

export const deskFloorNorth = 14;
const desksPerRow = 12;
const rowPitch = 3.2;
const rowOffset = (row: number) => row * rowPitch + Math.floor(row / 2) * .85;
export const deskFloorSouth = (count: number) => 24 + rowOffset(Math.max(0, Math.ceil(count / desksPerRow) - 1)) + rowPitch;
export const officeMonitorYaw = .45;

export function roomDesk(agent: Pick<WorldAgent, 'slotIndex' | 'seatId' | 'officePosition'>): DeskAnchor {
  if (agent.officePosition) {
    const [x, z] = agent.officePosition;
    return { id: `desk:${agent.seatId}`, position: [x, z], yaw: 0, stand: [x, z + 3], seat: [x, z + 1.5], monitor: [x + .12, z - .22], sideMonitor: [x - .53, z - .09] };
  }
  const column = agent.slotIndex % desksPerRow;
  const x = -14.9 + column * 2.48 + Math.floor(column / 3) * .85;
  const z = 24 + rowOffset(Math.floor(agent.slotIndex / desksPerRow));
  return { id: `desk:${agent.seatId}`, position: [x, z], yaw: 0, stand: [x, z - 1.8], seat: [x, z - .94], monitor: [x - .16, z + .24], sideMonitor: [x - .62, z + .02] };
}

const projectColors = [palette.sky, palette.rose, palette.sage, palette.butter, palette.lavender, palette.mint, palette.apricot, '#F2C5DB', '#C6DDD7', '#D5CB9D', '#B9C7EB', '#DFCFED'];
export const projectColor = (index: number) => projectColors[index % projectColors.length] ?? palette.sky;

export function agentStation(agent: WorldAgent, now: number): 'desk' | OfficeStation {
  if (agent.compact || agent.paused) return 'desk';
  if (agent.reviewTask) return 'bench';
  if (agent.status !== 'working') return 'desk';
  const sinceHandoff = agent.collaborationAt ? now - Date.parse(agent.collaborationAt) : Infinity;
  if (sinceHandoff >= -5000 && sinceHandoff < 25000) return 'meeting';
  return agent.workflowTask ? 'board' : 'desk';
}

export type Position = [number, number, number];
export function deskDestination(agent: WorldAgent): Position {
  const [x, z] = roomDesk(agent).seat;
  return [x, .48, z];
}
