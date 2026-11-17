import { useEffect, useRef } from 'react';
import type { CameraState } from './cameraContext';
import type { WorldAgent } from './data/types';
import type { WorldSource } from './data/controller';
import type { layout } from './layout/waypoints';

export type FallbackReason = 'narrow' | 'webgl' | 'reduced-motion' | 'error' | 'preference';
export type RenderStats = Readonly<{ calls: number; triangles: number; geometries: number; textures: number; fps: number }>;
export type AgentDebug = Pick<WorldAgent, 'seatId' | 'name' | 'status' | 'pose' | 'podKey'> & { deskId: string | null; walking: boolean; wandering: boolean };
export type IntegrationStats = { cards: Record<'todo' | 'doing' | 'review' | 'failed' | 'done', number>; handoffsActive: number; handoffsSeen: number; bugs: number; galleryFrames: number; bugsDefeated: number; releasesCelebrated: number; celebrating: number };
export const emptyIntegration = (): IntegrationStats => ({ cards: { todo: 0, doing: 0, review: 0, failed: 0, done: 0 }, handoffsActive: 0, handoffsSeen: 0, bugs: 0, galleryFrames: 0, bugsDefeated: 0, releasesCelebrated: 0, celebrating: 0 });
export type SceneDebug = { integration: IntegrationStats; agents: AgentDebug[]; characters: { built: number; drawCallsPerCharacter: number; sharedMaterials: number }; director: { transitions: number } };
export const emptyScene = (): SceneDebug => ({ integration: emptyIntegration(), agents: [], characters: { built: 0, drawCallsPerCharacter: 0, sharedMaterials: 0 }, director: { transitions: 0 } });
export type WorldDebugSnapshot = Readonly<{
  version: 1; mode: 'loading' | '3d' | 'fallback'; fallbackReason: FallbackReason | null;
  camera: CameraState; layout: typeof layout; locate: (kind: 'agent' | 'owner' | 'zone' | 'card' | 'bug' | 'frame', id?: string) => { x: number; y: number } | null;
  counts: { agents: number; drawnAgents: number; overflow: number } & Pick<IntegrationStats, 'cards' | 'handoffsActive' | 'handoffsSeen' | 'bugs' | 'galleryFrames'>;
  table: { focusProjectId: string | null; stages: import('./data/types').TableStage[] }; events: { bugsDefeated: number; releasesCelebrated: number }; celebrating: number; agents: AgentDebug[];
  characters: SceneDebug['characters']; director: SceneDebug['director']; sources: Record<string, WorldSource>; baseline: boolean; selected: string | null;
  ready: boolean; quality: 'high' | 'low'; still: boolean; render: RenderStats;
}>;
export const emptyRender: RenderStats = Object.freeze({ calls: 0, triangles: 0, geometries: 0, textures: 0, fps: 0 });
declare global { interface Window { readonly __factoryWorld?: WorldDebugSnapshot } }
export function useWorldDebug(source: () => WorldDebugSnapshot) {
  const latest = useRef(source);
  latest.current = source;
  useEffect(() => {
    let cached: WorldDebugSnapshot | undefined;
    let sampledAt = -Infinity;
    const getter = () => {
      const now = performance.now();
      if (!cached || now - sampledAt >= 250) {
        const value = latest.current();
        cached = Object.freeze({
          ...value, counts: Object.freeze({ ...value.counts, cards: Object.freeze({ ...value.counts.cards }) }), table: Object.freeze({ ...value.table, stages: Object.freeze(value.table.stages.map(stage => Object.freeze({ ...stage }))) as unknown as typeof value.table.stages }), events: Object.freeze({ ...value.events }), agents: Object.freeze(value.agents.map(agent => Object.freeze({ ...agent }))) as unknown as AgentDebug[], characters: Object.freeze({ ...value.characters }), director: Object.freeze({ ...value.director }), sources: Object.freeze(Object.fromEntries(Object.entries(value.sources).map(([key, source]) => [key, Object.freeze({ ...source })]))), render: Object.freeze({ ...value.render }),
          camera: Object.freeze({ ...value.camera, target: Object.freeze([...value.camera.target]) as readonly [number, number] }),
        });
        sampledAt = now;
      }
      return cached;
    };
    Object.defineProperty(window, '__factoryWorld', { configurable: true, get: getter });
    return () => {
      if (Object.getOwnPropertyDescriptor(window, '__factoryWorld')?.get === getter) Reflect.deleteProperty(window, '__factoryWorld');
    };
  }, []);
}
