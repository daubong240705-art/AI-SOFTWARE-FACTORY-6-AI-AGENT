import { worldCopy, type WorkflowLocale } from '../../copy';
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { meetingTable } from '../../layout/zones';
import type { TableStage } from '../../data/types';
import { useWorldMotion } from '../Ticker';
import { createWorkflowAtlas, createWorkflowToon, type AtlasEntry } from './TaskBoard';
import { workflowDebug, workflowColors, handoffColors } from './support';
import type { TableArrival } from './Handoffs';

export type CollabTableProps = {
  stages: readonly TableStage[];
  /** Actual table arrivals from Handoffs.onTablePass, never interaction history. */
  handoffs?: readonly TableArrival[];
  locale?: WorkflowLocale;
  quality?: 'high' | 'low';
  still?: boolean;
};
const noHandoffs: readonly TableArrival[] = [];
const isActive = (state: string) => state === 'active';
function stageColor(state: string) {
  return workflowColors[state as keyof typeof workflowColors] ?? workflowColors.pending;
}
function labelFor(key: string) {
  return ({ design: 'Design', rules: 'Rules', art: 'Art', client: 'Client', qa: 'QA' } as Record<string, string>)[key] ?? key;
}
type TableResources = { group: THREE.Group; sample: (now: number, wallNow: number) => boolean; dispose: () => void };

export function CollabTable({ stages, handoffs = noHandoffs, locale = 'vi', quality = 'high', still = false }: CollabTableProps) {
  const invalidate = useThree(state => state.invalidate), motion = useWorldMotion();
  const [resource, setResource] = useState<TableResources | null>(null);
  const current = useRef<TableResources | null>(null), release = useRef<(() => void) | null>(null), debugKey = useRef({});
  useEffect(() => {
    const group = new THREE.Group(); group.name = 'collaboration-table';
    const entries: AtlasEntry[] = stages.flatMap((stage, index) => [
      { key: `stage:${index}`, text: labelFor(stage.key) },
      ...(stage.loopCount > 0 ? [{ key: `loop:${index}`, text: `${worldCopy[locale].workflow.loop} ${stage.loopCount}` }] : []),
    ]);
    const unique = new Map(handoffs.map(arrival => [arrival.handoff.id, arrival]));
    const arrivals = [...unique.values()].filter(arrival => {
      const age = Date.now() - arrival.passedAt;
      return arrival.handoff.from.kind === 'seat' && arrival.handoff.to.kind === 'seat' && Number.isFinite(age) && age >= 0 && age < 120000;
    }).sort((a, b) => b.passedAt - a.passedAt).slice(0, 10);
    arrivals.forEach(arrival => entries.push({ key: `handoff:${arrival.handoff.id}`, text: arrival.handoff.code ?? '✉', color: handoffColors[arrival.handoff.kind] ?? '#AFCFE6' }));
    const atlas = createWorkflowAtlas(entries, invalidate), toon = createWorkflowToon();
    const geometry = new THREE.CylinderGeometry(0.38, 0.42, 0.12, quality === 'low' ? 12 : 20);
    const body = new THREE.InstancedMesh(geometry, toon.material, Math.max(1, stages.length)); body.count = stages.length; body.frustumCulled = false; group.add(body);
    const puckPositions = stages.map((stage, index) => {
      const angle = index / Math.max(1, stages.length) * Math.PI * 2 - Math.PI / 2;
      const point = new THREE.Vector3(meetingTable.position[0] + Math.cos(angle) * 1.24, 0.99, meetingTable.position[1] + Math.sin(angle) * 1.24);
      body.setColorAt(index, new THREE.Color(stageColor(stage.state)));
      const label = atlas.mesh(`stage:${index}`, 0.75, 0.21); label.rotation.x = -Math.PI / 2; label.position.copy(point); label.position.y = 1.057; group.add(label);
      if (stage.loopCount > 0) {
        const loop = atlas.mesh(`loop:${index}`, 0.52, 0.14); loop.rotation.x = -Math.PI / 2;
        loop.position.copy(point); loop.position.y = 1.059; loop.position.z += 0.21; group.add(loop);
      }
      return point;
    });
    const resting = arrivals.map((arrival, index) => {
      const face = atlas.mesh(`handoff:${arrival.handoff.id}`, 0.5, 0.27);
      const material = (face.material as THREE.MeshBasicMaterial).clone(); face.material = material;
      face.rotation.x = -Math.PI / 2; face.rotation.z = index * 0.45;
      const angle = index * 2.4;
      face.position.set(meetingTable.position[0] + Math.cos(angle) * 0.38, 1.075 + index * 0.003, meetingTable.position[1] + Math.sin(angle) * 0.38);
      group.add(face); return { face, material, passedAt: arrival.passedAt };
    });
    const dummy = new THREE.Object3D();
    const sample = (now: number, wallNow: number) => {
      stages.forEach((stage, index) => {
        dummy.position.copy(puckPositions[index]!);
        const pulse = !still && isActive(stage.state) ? 1 + Math.sin(now / 1300 + index * 0.4) * 0.045 : 1;
        dummy.scale.set(pulse, 1, pulse); dummy.updateMatrix(); body.setMatrixAt(index, dummy.matrix);
      });
      body.instanceMatrix.needsUpdate = true;
      if (body.instanceColor) body.instanceColor.needsUpdate = true;
      let fading = false;
      resting.forEach(card => {
        const age = wallNow - card.passedAt;
        card.face.visible = age < 120000;
        card.material.opacity = THREE.MathUtils.clamp(1 - age / 120000, 0, 1);
        if (card.face.visible) fading = true;
      });
      return !still && (fading || stages.some(stage => isActive(stage.state)));
    };
    const created: TableResources = { group, sample, dispose() {
      atlas.dispose(); geometry.dispose(); toon.dispose(); body.dispose(); resting.forEach(card => card.material.dispose());
    } };
    current.current = created; setResource(created); workflowDebug.tables.set(debugKey.current, stages.length);
    if (sample(performance.now(), Date.now())) release.current = motion.request('ambient');
    invalidate();
    return () => {
      release.current?.(); release.current = null; workflowDebug.tables.delete(debugKey.current);
      current.current = null; created.dispose();
    };
  }, [stages, handoffs, locale, quality, still, motion, invalidate]);
  useFrame(() => {
    if (!still && release.current && current.current && !current.current.sample(performance.now(), Date.now())) { release.current(); release.current = null; }
  });
  return resource ? <primitive object={resource.group} dispose={null} /> : null;
}
