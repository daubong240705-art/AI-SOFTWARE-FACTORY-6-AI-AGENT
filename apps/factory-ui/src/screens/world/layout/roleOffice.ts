import type { WorldAgent } from '../data/types';
import { deskFloorNorth, roomDesk } from './campus';
import { palette, type Footprint, type Point } from './zones';

export const roleZones = {
  lead: { label: 'Phòng Lead / họp', tint: palette.butter },
  design: { label: 'Studio thiết kế', tint: palette.rose },
  engineering: { label: 'Khu kỹ thuật', tint: palette.sky },
  qa: { label: 'Phòng QA / review', tint: palette.mint },
  release: { label: 'Bàn phát hành', tint: palette.apricot },
  common: { label: 'Khu chung', tint: palette.sage },
};
export type RoleZone = keyof typeof roleZones;
export type OfficeStation = 'board' | 'meeting' | 'bench';
export type Walkway = readonly [Point, Point];
export const deskWidth = 1.75;
export const deskDepth = .88;
const columnPitch = 3;
const rowPitch = 4.5;
const fixturePitch = 6;
const laneEdges = [-16.5, -5.5, 5.5, 16.5];
const stationRows: Partial<Record<RoleZone, OfficeStation[]>> = { lead: ['board', 'meeting'], qa: ['bench'] };

export function zoneForRole(role: string, isLead = false): RoleZone {
  const text = role.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replaceAll('đ', 'd').replace(/[^a-z0-9]+/g, ' ');
  if (isLead) return 'lead';
  if (/\b(release|phat hanh)\b/.test(text)) return 'release';
  if (/\b(qa|qe|quality (assurance|engineer)|review(er)?|test(er|ing| automation)?|kiem thu)\b/.test(text)) return 'qa';
  if (/\b(lead|truong nhom)\b/.test(text)) return 'lead';
  if (/\b(design(er)?|art(ist)?|illustrat(or|ion)|ux|ui designer|thiet ke|hoa si)\b/.test(text)) return 'design';
  if (/\b(engineer(ing)?|developer|programmer|rules?|client|back ?end|front ?end|full ?stack|dev ?ops|sre|ky thuat|lap trinh)\b/.test(text)) return 'engineering';
  return 'common';
}

export type OfficeZone = { role: RoleZone; x: number; north: number; south: number; count: number };
export type Station = { id: OfficeStation; position: Point; spots: Point[] };
export type RoleOffice = {
  zones: OfficeZone[]; stations: Station[]; walkways: Walkway[]; furniture: Footprint[]; floorSouth: number;
};

export function layoutRoleOffice(seats: readonly WorldAgent[], occupants: readonly WorldAgent[] = seats) {
  const byRole = new Map<RoleZone, WorldAgent[]>();
  const counts = new Map<RoleZone, number>();
  for (const seat of occupants) {
    const role = zoneForRole(seat.role, seat.isLead);
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  for (const seat of seats) {
    const role = zoneForRole(seat.role, seat.isLead);
    const members = byRole.get(role) ?? [];
    members.push(seat); byRole.set(role, members);
  }
  const zones: OfficeZone[] = [], stations: Station[] = [], walkways: Walkway[] = [], furniture: Footprint[] = [];
  const agents: WorldAgent[] = [];
  const roles = (['lead', 'design', 'engineering', 'qa', 'common'] as const).filter(role => counts.has(role));
  const bands: (RoleZone | null)[][] = counts.has('release')
    ? [[roles[0] ?? null, roles[1] ?? null, 'release'], roles.slice(2)] : [roles.slice(0, 3), roles.slice(3)];
  let north = deskFloorNorth + 2;
  for (const band of bands) {
    if (!band.length) continue;
    let bandSouth = north;
    walkways.push([[laneEdges[0]!, north - 1], [laneEdges[3]!, north - 1]]);
    band.forEach((role, lane) => {
      if (!role) return;
      const left = laneEdges[lane]!, right = laneEdges[lane + 1]!, x = (left + right) / 2;
      const members = byRole.get(role) ?? [];
      const fixtures = stationRows[role] ?? [];
      const firstDesk = north + 2 + fixtures.length * fixturePitch;
      const rows = Math.max(1, Math.ceil(members.length / 3));
      const south = firstDesk + (rows - 1) * rowPitch + 3.5;
      zones.push({ role, x, north, south, count: counts.get(role)! });
      bandSouth = Math.max(bandSouth, south);
      const aisle = (z: number) => walkways.push([[left, z], [right, z]]);
      fixtures.forEach((id, index) => {
        const z = north + 2 + index * fixturePitch;
        const spots = [-columnPitch, 0, columnPitch].map(offset => [x + offset, z + 2.1] as Point);
        stations.push({ id, position: [x, z], spots });
        furniture.push({ id, position: [x, z], half: id === 'meeting' ? [1.3, 1.3] : [2.25, id === 'board' ? .16 : .45], yaw: 0, ...(id === 'meeting' ? { radius: 1.3 } : {}) });
        aisle(z + 4);
        for (const spot of spots) walkways.push([spot, [spot[0], z + 4]]);
      });
      for (let row = 0; row < rows; row++) aisle(firstDesk + row * rowPitch + 3.35);
      members.forEach((member, index) => {
        const row = Math.floor(index / 3), column = row % 2 ? 2 - index % 3 : index % 3;
        const agent = { ...member, slotIndex: agents.length, officePosition: [x + (column - 1) * columnPitch, firstDesk + row * rowPitch] as Point };
        agents.push(agent);
        const { id, seat, position } = roomDesk(agent);
        furniture.push({ id, position, half: [deskWidth / 2, deskDepth / 2], yaw: 0 });
        walkways.push([seat, [seat[0], position[1] + 3.35]]);
      });
    });
    north = bandSouth + 3;
  }
  const floorSouth = Math.max(deskFloorNorth + 5, north);
  for (const edge of laneEdges) walkways.push([[edge, deskFloorNorth + 1], [edge, floorSouth - 1]]);
  return { agents, office: { zones, stations, walkways, furniture, floorSouth } satisfies RoleOffice };
}
