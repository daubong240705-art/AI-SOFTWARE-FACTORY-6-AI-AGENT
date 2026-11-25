import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { useT } from '@/i18n';
import type { WorldModel } from '../data/types';
import { roomCenterZ, roomDesk, roomNorth, roomStations, roomWidth } from '../layout/campus';
import { anchors, palette } from '../layout/zones';
import { createScreenTexture, type ScreenTexture } from './screenTexture';
import type { WalkTarget } from './walk/state';

type Vector = [number, number, number];
function Box({ at, size, color }: { at: Vector; size: Vector; color: string }) {
  return <mesh position={at} raycast={() => {}}><boxGeometry args={size} /><meshStandardMaterial color={color} /></mesh>;
}

function Sign({ at, width, height = .65, lines, target, onOpen, paper = palette.milk }: {
  at: Vector; width: number; height?: number; lines: readonly string[]; target?: WalkTarget; onOpen: (target: WalkTarget) => void; paper?: string;
}) {
  const invalidate = useThree(state => state.invalidate);
  const [screen, setScreen] = useState<ScreenTexture | null>(null);
  const text = lines.join('\n');
  useEffect(() => {
    const resource = createScreenTexture(512, Math.max(64, Math.round(512 * height / width)), invalidate);
    setScreen(resource); return () => resource.dispose();
  }, [width, height, invalidate]);
  useEffect(() => {
    screen?.draw(ctx => {
      const { width: w, height: h } = ctx.canvas;
      const rows = text.split('\n');
      ctx.fillStyle = paper; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = palette.darkWood; ctx.lineWidth = 4; ctx.strokeRect(2, 2, w - 4, h - 4);
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = palette.ink;
      rows.forEach((row, index) => {
        const size = Math.min(index === 0 ? 48 : 34, h / (rows.length * 1.32));
        ctx.font = `${index === 0 ? 700 : 500} ${size}px sans-serif`;
        ctx.fillText(row, w / 2, (index + .5) * h / rows.length, w - 25);
      });
    });
  }, [screen, text, paper]);
  return <mesh position={at} userData={target ? { walkTarget: target } : {}} onClick={event => { if (!target) return; event.stopPropagation(); onOpen(target); }}>
    <planeGeometry args={[width, height]} /><meshBasicMaterial map={screen?.texture ?? null} color={screen ? '#ffffff' : paper} toneMapped={false} />
  </mesh>;
}

export function Campus({ model, hidden, onOpen }: { model: WorldModel; hidden: boolean; onOpen: (target: WalkTarget) => void }) {
  const t = useT();
  const rooms = model.rooms;
  const agentsByProject = new Map<string, WorldModel['agents']>();
  for (const agent of model.agents) if (!agent.overflow) {
    const list = agentsByProject.get(agent.projectId) ?? []; list.push(agent); agentsByProject.set(agent.projectId, list);
  }
  const title = (key: string) => t(`worldUi.campus.${key}`);
  const [shelfX, shelfZ] = anchors.bookshelf;
  return <group visible={!hidden}>
    <Box at={[21, -.12, -1]} size={[8, .23, 4]} color={palette.rug} />
    <Sign at={[shelfX, 2.49, shelfZ + .35]} width={2.8} lines={[title('library')]} onOpen={onOpen} target={{ kind: 'library', id: 'library', name: title('library') }} />
    <mesh position={[shelfX, 1.05, shelfZ + .36]} userData={{ walkTarget: { kind: 'library', id: 'library', name: title('library') } }} onClick={event => { event.stopPropagation(); onOpen({ kind: 'library', id: 'library' }); }}>
      <planeGeometry args={[2.4, 1.8]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    <Sign at={[15, 1.57, -7.14]} width={2.5} lines={[title('approval')]} onOpen={onOpen} target={{ kind: 'approval', id: 'approval', name: title('approval') }} />
    <Sign at={[0, 1.86, 6]} width={2.5} lines={[title('meeting')]} onOpen={onOpen} />
    {rooms.map(room => {
      const focused = room.id === model.focusProjectId;
      const { meeting, approval, board, rest } = roomStations(room);
      const select: WalkTarget = { kind: 'project', id: room.id, name: room.name };
      const station = model.stations[room.id];
      const pending = station?.approvalCount !== undefined ? ` · ${station.approvalCount}` : '';
      return <group key={room.id}>
        <Box at={[room.x, -.18, roomCenterZ(room)]} size={[roomWidth, .32, room.depth]} color={focused ? palette.apricot : palette.rug} />
        <Box at={[room.x, -.018, roomCenterZ(room)]} size={[roomWidth - 1.25, .072, room.depth - 1.35]} color={palette.milk} />
        <Box at={[room.x, .38, roomNorth(room) + .5]} size={[roomWidth - 1.25, .8, .2]} color={palette.wood} />
        <Box at={[room.x + roomWidth / 2 - .6, .38, room.z - 3]} size={[.2, .8, 13]} color={palette.wood} />
        {room.sign && <Sign at={[room.x, 3.75, room.z - 10.4]} width={9.8} height={1.1} paper={palette.apricot} lines={[room.building || title('shared')]} onOpen={onOpen} />}
        <Sign at={[room.x, 2.17, room.z - 10.25]} width={8.8} height={.95} paper={focused ? palette.sage : palette.cream} lines={[room.name]} target={select} onOpen={onOpen} />
        <Sign at={[room.x - 10.4, 1.08, room.z + .3]} width={3.5} lines={[room.name]} target={select} onOpen={onOpen} />
        {agentsByProject.get(room.id)?.map(agent => {
          const [x, z] = roomDesk(room, agent).position;
          return <group key={agent.seatId}><Box at={[x, .28, z]} size={[1.53, .56, .68]} color={palette.wood} /><Box at={[x, .59, z]} size={[1.75, .12, .84]} color={agent.isLead ? palette.apricot : palette.rug} />
            <Box at={[x - .33, .87, z + .13]} size={[.64, .42, .11]} color={palette.ink} /><Box at={[x - .33, .9, z + .195]} size={[.52, .29, .02]} color={agent.status === 'working' ? palette.mint : palette.cream} /></group>;
        })}
        <mesh position={[meeting[0], .55, meeting[1]]} raycast={() => {}}><cylinderGeometry args={[1.3, 1.3, .15, 16]} /><meshStandardMaterial color={palette.sky} /></mesh>
        <Box at={[meeting[0], .22, meeting[1]]} size={[.5, .5, .5]} color={palette.wood} />
        <Sign at={[meeting[0], 1.67, meeting[1]]} width={2.8} lines={[title('meeting')]} onOpen={onOpen} />
        <Box at={[rest[0], .32, rest[1]]} size={[3.7, .55, .77]} color={palette.rose} />
        <Sign at={[rest[0], 1.48, rest[1]]} width={2.3} lines={[title('rest')]} onOpen={onOpen} />
        <Box at={[approval[0], .39, approval[1]]} size={[2.6, .78, 1.2]} color={palette.apricot} />
        <Sign at={[approval[0], 1.51, approval[1] + .66]} width={2.75} lines={[title('approval') + pending]} onOpen={onOpen} target={{ kind: 'approval', id: room.id, name: title('approval') }} />
        <Box at={[board[0], 1.6, board[1]]} size={[4.6, 3.2, .23]} color={palette.wood} />
        <Sign at={[board[0], 2.86, board[1] + .14]} width={4.4} lines={[title('board')]} onOpen={onOpen} target={{ kind: 'board', id: room.id, name: title('board') }} />
        {station?.workflows?.length ? station.workflows.slice(0, 6).map((item, index) => <Sign key={item.run.id} at={[board[0], 2.21 - index * .36, board[1] + .15]} width={4.4} height={.35}
          lines={[item.title, `${t(`flowsUi.state.${item.run.state}`)}${item.progress ? ` · ${title('nodeCount').replace('{done}', String(item.progress.complete)).replace('{total}', String(item.progress.total))}${item.progress.active.length ? ` · ${item.progress.active.join(', ')}` : ''}` : ''}`]}
          target={{ kind: 'run', id: item.run.id, projectId: room.id, name: item.title }} onOpen={onOpen} />) : <Sign at={[board[0], 1.8, board[1] + .15]} width={4.4} height={.7} lines={[station?.workflows ? t('officeUi.floorLive.noFlows') : title('loading')]} onOpen={onOpen} />}
      </group>;
    })}
  </group>;
}
