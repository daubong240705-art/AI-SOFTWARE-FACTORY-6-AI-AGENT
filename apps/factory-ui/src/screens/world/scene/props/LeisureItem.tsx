import * as THREE from 'three';
import type { Activity } from '../wandering';
import { colouredGeometry, type Piece } from './geometry';
const cream = '#FFF8E7', dark = '#4A3B2F';
const pieces: Record<Exclude<Activity, 'dance' | 'pet-cat'>, Piece[]> = {
  coffee: [
    { color: cream, at: [0, 0, 0], size: [0.14, 0.18, 0.14] },
    { color: dark, at: [0, 0.095, 0], size: [0.11, 0.01, 0.11] },
    { color: cream, at: [0.09, 0, 0], size: [0.07, 0.08, 0.04] },
  ],
  'ping-pong': [
    { color: '#EE6B6B', shape: 'sphere', at: [0, 0.1, 0], size: [0.23, 0.25, 0.055] },
    { color: '#A87A50', at: [0, -0.05, 0], size: [0.06, 0.2, 0.04] },
  ],
  'water-plant': [
    { color: '#79BDB6', at: [0, 0, 0], size: [0.23, 0.22, 0.17] },
    { color: '#79BDB6', at: [0.17, 0.04, 0], size: [0.25, 0.055, 0.055] },
    ...[0, 1, 2].map(i => ({ color: '#66AECD', shape: 'sphere' as const, at: [0.29 + i * 0.025, -0.1 - i * 0.1, 0] as const, size: [0.025, 0.05, 0.025] as const })),
  ],
  sofa: [
    { color: dark, at: [0, 0, 0], size: [0.36, 0.15, 0.06] },
    { color: '#AFCFE6', at: [0, 0, 0.035], size: [0.19, 0.11, 0.01] },
    ...[-1, 1].map(side => ({ color: '#E0A458', shape: 'sphere' as const, at: [side * 0.14, 0, 0.038] as const, size: [0.04, 0.04, 0.018] as const })),
  ],
};
const geometry = Object.fromEntries(Object.entries(pieces).map(([key, value]) => [key, colouredGeometry(value)]));
const material = new THREE.MeshBasicMaterial({ vertexColors: true });
/** Fixed shared hand-held assemblies: one extra draw per participating worker. */
export function LeisureItem({ activity }: { activity: Activity | null }) {
  if (!activity || activity === 'dance' || activity === 'pet-cat') return null;
  const shape = geometry[activity];
  if (!shape) return null;
  return <mesh geometry={shape} material={material} position={activity === 'sofa' ? [0, 0.6, 0.34] : [0.4, 0.65, 0.2]} rotation={[0, Math.PI / 4, activity === 'water-plant' ? -0.3 : 0]} raycast={() => {}} />;
}
