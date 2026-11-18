import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldAgent } from '../../data/types';
import { deskForAgent } from '../../agentPresentation';
import { monitorFaceOffset, monitorYaw } from '../../layout/zones';
import { useWorldMotion } from '../Ticker';
import { daylight } from './state';
const lampColor = { working: '#E0A458', waiting: '#F2B8A9', problem: '#F05252', done: '#82BF91', queued: '#4A3B2F', idle: '#4A3B2F' };
function feedback(count: number) {
  const plane = new THREE.PlaneGeometry(1, 1), sphere = new THREE.SphereGeometry(0.13, 8, 6);
  const material = new THREE.MeshBasicMaterial({ color: 'white' });
  const group = new THREE.Group(), object = new THREE.Object3D();
  const screens = new THREE.InstancedMesh(plane, material, count * 2), lamps = new THREE.InstancedMesh(sphere, material, count);
  const tracks = new THREE.InstancedMesh(plane, material, count), bars = new THREE.InstancedMesh(plane, material, count);
  group.add(screens, lamps, tracks, bars); group.traverse(o => { o.raycast = () => {}; });
  const put = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, w: number, h: number, color: string, yaw: number) => {
    object.position.set(x, y, z); object.scale.set(w, h, 1); object.rotation.set(0, yaw, 0); object.updateMatrix(); mesh.setMatrixAt(i, object.matrix); mesh.setColorAt(i, new THREE.Color(color));
  };
  function paint(agents: readonly WorldAgent[], t: number) {
    let visible = 0; const night = daylight(new Date()) === 'night';
    agents.forEach((agent, i) => {
      const desk = deskForAgent(agent); if (!desk) return;
      const working = agent.status === 'working';
      [desk.monitor, desk.sideMonitor].forEach((p, index) => put(screens, i * 2 + index, p[0] + Math.sin(monitorYaw) * (monitorFaceOffset + 0.03), index ? 1.07 : 1.08, p[1] + Math.cos(monitorYaw) * (monitorFaceOffset + 0.03), index ? 0.56 : 0.7, index ? 0.28 : 0.32, working && index === 0 ? '#BDE3D2' : '#425555', monitorYaw));
      put(lamps, i, desk.position[0] + 0.65, 1.26, desk.position[1] + 0.18, night ? 1.1 : 1, night ? 1.1 : 1, night && agent.status === 'idle' ? '#E0C18B' : lampColor[agent.status], 0);
      const percent = agent.runs[0]?.progress?.percent;
      if (!working && percent == null) return;
      const amount = percent == null ? 0.3 : Math.max(0, Math.min(100, percent)) / 100;
      put(tracks, visible, desk.position[0], 1.65, desk.position[1], 1.3, 0.1, '#4A3B2F', Math.PI / 4);
      const offset = percent == null ? Math.sin(t / 0.65) * 0.4 : (amount - 1) * 0.62;
      put(bars, visible++, desk.position[0] + Math.cos(Math.PI / 4) * offset + 0.005, 1.65, desk.position[1] - Math.sin(Math.PI / 4) * offset + 0.005, Math.max(0.001, amount * 1.24), 0.065, '#BDE3D2', Math.PI / 4);
    });
    screens.count = agents.length * 2; lamps.count = agents.length; tracks.count = bars.count = visible;
    for (const mesh of [screens, lamps, tracks, bars]) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.computeBoundingSphere(); }
  }
  return { group, paint, dispose() { plane.dispose(); sphere.dispose(); material.dispose(); for (const mesh of [screens, lamps, tracks, bars]) mesh.dispose(); } };
}
/** Four draws for the entire team, including both monitors and progress bars. */
export function DeskFeedback({ agents, still }: { agents: readonly WorldAgent[]; still: boolean }) {
  const [resource, setResource] = useState<ReturnType<typeof feedback> | null>(null);
  const latest = useRef(agents); latest.current = agents;
  const motion = useWorldMotion(), invalidate = useThree(s => s.invalidate);
  const sweep = agents.some(a => a.status === 'working' && a.runs[0]?.progress?.percent == null);
  useEffect(() => { const value = feedback(agents.length); setResource(value); return value.dispose; }, [agents.length]);
  useEffect(() => { resource?.paint(agents, 0); invalidate(); }, [resource, agents, still, invalidate]);
  useEffect(() => { if (sweep && !still) return motion.request('ambient'); }, [sweep, still, motion]);
  useFrame(() => { if (resource && sweep && !still) resource.paint(latest.current, performance.now() / 1000); });
  return resource ? <primitive object={resource.group} /> : null;
}
