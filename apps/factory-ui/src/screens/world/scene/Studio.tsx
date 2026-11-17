import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { WorldEvent } from '../data/events';
import type { Bug, Endpoint, GalleryItem, Handoff, WorldInputs, WorldModel } from '../data/types';
import { anchors, displayFrames, ownerDesk } from '../layout/zones';
import { deskForAgent } from '../agentPresentation';
import { i18n, useT } from '@/i18n';
import type { SceneDebug } from '../debugHook';
import { TaskBoard } from './workflow/TaskBoard';
import { Handoffs, type TableArrival } from './workflow/Handoffs';
import { CollabTable } from './workflow/CollabTable';
import { workflowStats } from './workflow/support';
import { TestingLab } from './lab/TestingLab';
import { BugMonsters, labStats } from './lab/BugMonsters';
import { Gallery, galleryStats } from './gallery/Gallery';
import type { AgentPositions } from './Agents';
import type { WorldLocations } from './CameraRig';

export type Courier = MutableRefObject<((handoff: Handoff) => void) | null>;
export type StudioProps = {
  model: WorldModel; events: readonly WorldEvent[]; reports: WorldInputs['reports']; baseline: boolean;
  quality: 'high' | 'low'; still: boolean; hidden: boolean; scopeKey: number;
  positions: AgentPositions; locations: WorldLocations; debug: MutableRefObject<SceneDebug>; courier: Courier;
  consumeEvents: (ids: readonly string[]) => void;
  onTask: (projectId: string, taskId: string) => void;
  onBug: (bug: Bug) => void; onRelease: (release: GalleryItem) => void;
  onCelebrate: (release: GalleryItem) => void;
};
/** Keep every event consumer mounted and acknowledge only after their effects run. */
export function Studio(props: StudioProps) {
  useT();
  const { model, quality, events, reports, scopeKey } = props;
  const still = props.still || props.hidden;
  const [arrivals, setArrivals] = useState<TableArrival[]>([]);
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
  const arrival = useCallback((entry: TableArrival) => setArrivals(old => [...old.filter(row => row.passedAt > Date.now() - 120000 && row.handoff.id !== entry.handoff.id), entry].slice(-10)), []);
  useEffect(() => {
    if (!arrivals.length) return;
    const timer = setTimeout(() => setArrivals(old => old.filter(row => row.passedAt > Date.now() - 120000)), Math.max(1, arrivals[0]!.passedAt + 120001 - Date.now()));
    return () => clearTimeout(timer);
  }, [arrivals]);
  useEffect(() => {
    const ids = events.map(event => event.id).filter(id => !acknowledged.current.has(id));
    ids.forEach(id => acknowledged.current.add(id));
    if (ids.length) props.consumeEvents(ids);
  }, [events, props.consumeEvents]);
  useFrame(() => {
    const workflow = workflowStats(), lab = labStats(), gallery = galleryStats();
    props.debug.current.integration = {
      cards: workflow.cards, handoffsActive: workflow.handoffsActive, handoffsSeen: workflow.handoffsSeen,
      bugs: lab.bugs, galleryFrames: gallery.frames,
      bugsDefeated: lab.defeated, releasesCelebrated: gallery.celebrated, celebrating: gallery.celebrating,
    };
    const releases = new Set(model.gallery.slice(0, displayFrames.length).map(item => `frame:${item.releaseId}`));
    for (const key of props.locations.current.keys()) if (key.startsWith('frame:') && !releases.has(key)) props.locations.current.delete(key);
    model.gallery.slice(0, displayFrames.length).forEach((item, index) => {
      const anchor = displayFrames[index]!;
      props.locations.current.set(`frame:${item.releaseId}`, [anchor.position[0] + Math.sin(anchor.yaw) * 0.27, 1.43, anchor.position[1] + Math.cos(anchor.yaw) * 0.27]);
    });
  });
  return <group visible={!props.hidden}>
    <TaskBoard projectId={model.focusProjectId} columns={model.tasks.columns} overflow={model.tasks.overflow} quality={quality} still={still} locale={i18n.locale} onOpenTask={props.onTask} locations={props.locations} />
    <Handoffs events={events} positionOf={positionOf} quality={quality} still={still} senderIdle={senderIdle} courier={courier} onTablePass={arrival} />
    <CollabTable stages={model.stages} handoffs={arrivals} quality={quality} still={still} locale={i18n.locale} />
    <TestingLab games={model.hotProjects} reports={reports} quality={quality} still={still} locale={i18n.locale} />
    <BugMonsters bugs={model.bugs} bugOverflow={model.bugOverflow} events={events} games={model.hotProjects} scopeKey={String(scopeKey)} quality={quality} still={still} locale={i18n.locale} onSelectBug={props.onBug} locations={props.locations} />
    <Gallery items={model.gallery} events={events} baselineReady={props.baseline} quality={quality} still={still} locale={i18n.locale} onSelectRelease={props.onRelease} onCelebrate={props.onCelebrate} />
  </group>;
}
