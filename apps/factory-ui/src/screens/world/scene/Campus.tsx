import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Color, Object3D, type InstancedMesh } from 'three';
import { useT } from '@/i18n';
import type { WorldModel } from '../data/types';
import { podCenter, type WorldPod } from '../data/scope';
import { deskFloorNorth, roomDesk, studioBoard, studioMeeting } from '../layout/campus';
import { anchors, monitorYaw, palette } from '../layout/zones';
import { createScreenTexture, type ScreenTexture } from './screenTexture';
import type { WalkTarget } from './walk/state';

type Vector = [number, number, number];
const ignore = () => {};
function Box({ at, size, color }: { at: Vector; size: Vector; color: string }) {
  return <mesh position={at} raycast={ignore}><boxGeometry args={size} /><meshStandardMaterial color={color} /></mesh>;
}

function Sign({ at, width, height = .65, text, target, onOpen, tint = palette.milk }: {
  at: Vector; width: number; height?: number; text: string; target?: WalkTarget; onOpen: (target: WalkTarget) => void; tint?: string;
}) {
  const invalidate = useThree(state => state.invalidate);
  const [screen, setScreen] = useState<ScreenTexture | null>(null);
  useEffect(() => {
    const resource = createScreenTexture(512, Math.max(64, Math.round(512 * height / width)), invalidate);
    setScreen(resource); return () => resource.dispose();
  }, [width, height, invalidate]);
  useEffect(() => {
    screen?.draw(ctx => {
      const { width, height } = ctx.canvas;
      const rows = text.split('\n');
      ctx.fillStyle = tint; ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = palette.darkWood; ctx.lineWidth = 4; ctx.strokeRect(2, 2, width - 4, height - 4);
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = palette.ink;
      rows.forEach((row, index) => {
        const size = Math.min(index === 0 ? 48 : 34, height / (rows.length * 1.32));
        ctx.font = `${index === 0 ? 700 : 500} ${size}px sans-serif`;
        ctx.fillText(row, width / 2, (index + .5) * height / rows.length, width - 25);
      });
    });
  }, [screen, text, tint]);
  return <mesh position={at} userData={target ? { walkTarget: target } : {}} onClick={event => { if (target) { event.stopPropagation(); onOpen(target); } }}>
    <planeGeometry args={[width, height]} /><meshBasicMaterial map={screen?.texture ?? null} color={screen ? '#ffffff' : palette.milk} toneMapped={false} />
  </mesh>;
}

function Desks({ agents, pods, highlight }: { agents: WorldModel['agents']; pods: readonly WorldPod[]; highlight: string | null }) {
  const ref = useRef<InstancedMesh>(null);
  const capacity = agents.reduce((count, agent) => count + (agent.compact ? 1 : 8), 0) + pods.filter(pod => pod.collapsed).length * 2;
  const invalidate = useThree(state => state.invalidate);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const transform = new Object3D(), color = new Color();
    let index = 0;
    const box = (x: number, y: number, z: number, width: number, height: number, depth: number, tint: string, yaw = 0) => {
      transform.position.set(x, y, z); transform.scale.set(width, height, depth); transform.rotation.y = yaw; transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix); mesh.setColorAt(index++, color.set(tint));
    };
    for (const pod of pods) if (pod.collapsed) {
      const { x, z, width } = podCenter(pod);
      box(x, .28, z, width - .15, .56, .68, palette.wood);
      box(x, .59, z, width, .12, .88, pod.color);
    }
    for (const agent of agents) {
      const { position: [x, z], seat, monitor, sideMonitor } = roomDesk(agent);
      box(seat[0], .25, seat[1], .72, .5, .68, palette.lavender);
      if (agent.compact) continue;
      const emphasized = highlight === agent.projectId;
      box(x, .28, z, 1.53, .56, .68, palette.wood);
      box(x, .59, z, 1.75, .12, .88, emphasized ? agent.projectColor : palette.rug);
      box(monitor[0], 1.08, monitor[1], .77, .4, .11, palette.ink, monitorYaw);
      box(sideMonitor[0], 1.07, sideMonitor[1], .62, .35, .11, palette.ink, monitorYaw);
      box(monitor[0], .78, monitor[1], .09, .26, .12, palette.darkWood);
      box(sideMonitor[0], .78, sideMonitor[1], .09, .26, .12, palette.darkWood);
      box(x + .51, .68, z + .19, emphasized ? .6 : .34, .06, .21, agent.projectColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); invalidate();
  }, [agents, pods, highlight, invalidate]);
  return capacity ? <instancedMesh key={capacity} ref={ref} args={[undefined, undefined, capacity]} raycast={ignore}><boxGeometry /><meshStandardMaterial /></instancedMesh> : null;
}

export function Campus({ model, pods, compact, highlight, hidden, onOpen }: { model: WorldModel; pods: readonly WorldPod[]; compact: boolean; highlight: string | null; hidden: boolean; onOpen: (target: WalkTarget) => void }) {
  const t = useT();
  const title = (key: string) => t(`worldUi.campus.${key}`);
  const [shelfX, shelfZ] = anchors.bookshelf;
  const length = model.floorSouth - deskFloorNorth, middle = deskFloorNorth + length / 2;
  const projectId = model.focusProjectId;
  return <group visible={!hidden}>
    <Box at={[0, -.2, middle]} size={[36, .4, length]} color="#F4E5CA" />
    <Box at={[-18, 1.8, middle]} size={[.2, 3.6, length]} color={palette.wall} />
    <Desks agents={model.agents} pods={pods} highlight={highlight} />
    {!hidden && pods.map(pod => {
      const { x, z, width } = podCenter(pod);
      const target = compact ? { kind: 'pod' as const, id: pod.projectId, name: t(pod.collapsed ? 'worldUi.scope.expandPod' : 'worldUi.scope.collapsePod').replace('{project}', pod.name) } : undefined;
      return <group key={pod.projectId}>
        <Sign at={[x, 1.57, z - .45]} width={4.4} text={pod.remaining ? `${pod.name}\n+${pod.remaining}` : pod.name} tint={pod.color} {...(target ? { target } : {})} onOpen={onOpen} />
        {pod.collapsed && target && <mesh position={[x, .66, z]} onClick={event => { event.stopPropagation(); onOpen(target); }}>
          <boxGeometry args={[width, .14, .88]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>}
      </group>;
    })}
    <Sign at={[shelfX, 2.49, shelfZ + .35]} width={2.8} text={title('library')} onOpen={onOpen} target={{ kind: 'library', id: 'library', name: title('library') }} />
    <mesh position={[shelfX, 1.05, shelfZ + .36]} userData={{ walkTarget: { kind: 'library', id: 'library', name: title('library') } }} onClick={event => { event.stopPropagation(); onOpen({ kind: 'library', id: 'library' }); }}>
      <planeGeometry args={[2.4, 1.8]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    <Sign at={[15, 1.57, -7.14]} width={2.5} text={title('approval')} onOpen={onOpen} target={{ kind: 'approval', id: 'approval', name: title('approval') }} />
    <mesh position={[studioMeeting[0], .55, studioMeeting[1]]} raycast={ignore}><cylinderGeometry args={[1.3, 1.3, .15, 16]} /><meshStandardMaterial color={palette.sky} /></mesh>
    <Box at={[studioMeeting[0], .22, studioMeeting[1]]} size={[.5, .5, .5]} color={palette.wood} />
    <Sign at={[studioMeeting[0], 1.67, studioMeeting[1]]} width={2.8} text={title('meeting')} onOpen={onOpen} />
    <Box at={[studioBoard[0], 1.6, studioBoard[1]]} size={[4.6, 3.2, .23]} color={palette.wood} />
    <Sign at={[studioBoard[0], 2.86, studioBoard[1] + .14]} width={4.4} text={title('board')} onOpen={onOpen} {...(projectId ? { target: { kind: 'board', id: projectId, name: title('board') } } : {})} />
    {model.workflows.slice(0, 6).map((item, index) => <Sign key={item.run.id} at={[studioBoard[0], 2.21 - index * .36, studioBoard[1] + .15]} width={4.4} height={.35}
      text={`${item.title}\n${t(`flowsUi.state.${item.run.state}`)}${item.progress ? ` · ${title('nodeCount').replace('{done}', String(item.progress.complete)).replace('{total}', String(item.progress.total))}${item.progress.active.length ? ` · ${item.progress.active.join(', ')}` : ''}` : ''}`}
      target={{ kind: 'run', id: item.run.id, projectId: item.run.projectId, name: item.title }} onOpen={onOpen} />)}
    {!model.workflows.length && <Sign at={[studioBoard[0], 1.8, studioBoard[1] + .15]} width={4.4} height={.7} text={model.workflowLoaded || !projectId ? t('officeUi.floorLive.noFlows') : title('loading')} onOpen={onOpen} />}
  </group>;
}
