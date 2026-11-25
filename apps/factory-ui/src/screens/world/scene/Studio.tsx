import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { WorldEvent } from '../data/events';
import type { Endpoint, Handoff, WorldModel } from '../data/types';
import { anchors, ownerDesk } from '../layout/zones';
import { deskForAgent } from '../agentPresentation';
import { i18n, useT } from '@/i18n';
import type { SceneDebug } from '../debugHook';
import { TaskBoard } from './workflow/TaskBoard';
import { Handoffs } from './workflow/Handoffs';
import { workflowStats } from './workflow/support';
import type { AgentPositions } from './Agents';
import type { WorldLocations } from './CameraRig';
import { FunProps } from './props/FunProps';
import { ChairmanOffice } from './ChairmanOffice';
import type { ChairmanTab } from '../panels/chairmanTabs';

export type Courier = MutableRefObject<((handoff: Handoff) => void) | null>;
export type StudioProps = {
  effects: import('./effects/Aura').EffectsLevel; model: WorldModel; events: readonly WorldEvent[];
  quality: 'high' | 'low'; still: boolean; hidden: boolean;
  positions: AgentPositions; locations: WorldLocations; debug: MutableRefObject<SceneDebug>; courier: Courier;
  consumeEvents: (ids: readonly string[]) => void;
  onTask: (projectId: string, taskId: string) => void;
  onOfficeOpen?: (tab: ChairmanTab | 'chair') => void; approvalPulse?: number; phonePulse?: number; attention?: number;
};
/** Keep every event consumer mounted and acknowledge only after their effects run. */
export function Studio(props: StudioProps) {
  useT();
  const { model, quality, events } = props;
  const still = props.still || props.hidden;
  const acknowledged = useRef(new Set<string>());
  const latest = useRef(props); latest.current = props;
  const positionOf = useCallback((endpoint: Endpoint) => {
    const p = latest.current;
    if (endpoint.kind === 'owner') return ownerDesk.position;
    if (endpoint.kind === 'knowledge') return anchors.bookshelf;
    const agent = p.model.agents.find(a => a.seatId === endpoint.seatId);
    return p.positions.current.get(endpoint.seatId) ?? (agent ? deskForAgent(agent)?.seat : null) ?? null;
  }, []);
  const senderIdle = useCallback((id: string) => latest.current.model.agents.some(a => a.seatId === id && !a.overflow && ['idle', 'done'].includes(a.status)), []);
  const courier = useCallback((handoff: Handoff) => latest.current.courier.current?.(handoff), []);
  useEffect(() => {
    const ids = events.map(event => event.id).filter(id => !acknowledged.current.has(id));
    ids.forEach(id => acknowledged.current.add(id));
    if (ids.length) props.consumeEvents(ids);
  }, [events, props.consumeEvents]);
  useFrame(() => { props.debug.current.integration = workflowStats(); });
  return <group visible={!props.hidden}>
    <TaskBoard projectId={model.focusProjectId} columns={model.tasks.columns} overflow={model.tasks.overflow} quality={quality} still={still} locale={i18n.locale} onOpenTask={props.onTask} locations={props.locations} />
    <Handoffs effects={props.effects} events={events} positionOf={positionOf} quality={quality} still={still} senderIdle={senderIdle} courier={courier} onTask={props.onTask} />
    <FunProps effects={props.effects} model={model} quality={quality} still={still} hidden={props.hidden} debug={props.debug} positions={props.positions} locale={i18n.locale} />
    <ChairmanOffice model={model} attention={props.attention ?? 0} approvalPulse={props.approvalPulse ?? 0} phonePulse={props.phonePulse ?? 0} still={props.still} hidden={props.hidden} onOpen={props.onOfficeOpen ?? (() => {})} />
  </group>;
}
