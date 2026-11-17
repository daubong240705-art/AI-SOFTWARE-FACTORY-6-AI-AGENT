import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { GameReport, GameSummary } from '@factory/contracts';
import { anchors, palette } from '../../layout/zones';
import { useWorldMotion } from '../Ticker';
import { labels, type LabLocale } from './labels';

export type LabGame = Pick<GameSummary, 'projectId' | 'name'>;
type Reports = Readonly<Record<string, GameReport | undefined>>;
type Verdict = GameReport['qaRounds'][number]['verdict'];
export type TestingLabProps = {
  /** Pass WorldModel.hotProjects. No project/store selection is changed. */
  games: readonly LabGame[];
  /** Validated WorldInputs.reports; WorldModel currently omits QA rounds. */
  reports: Reports;
  scannerProjectId?: string;
  quality?: 'high' | 'low';
  still?: boolean;
  locale?: LabLocale;
};

export function deriveLabRows(games: readonly LabGame[], reports: Reports) {
  return games.slice(0, 3).map(game => {
    const round = reports[game.projectId]?.qaRounds.reduce<GameReport['qaRounds'][number] | undefined>(
      (latest, candidate) => !latest || candidate.iteration >= latest.iteration ? candidate : latest, undefined);
    return {
      projectId: game.projectId, name: game.name, verdict: round?.verdict ?? null,
      iteration: round?.iteration ?? null,
      passed: round ? round.criteria.filter(c => c.passed === true).length : null,
      failed: round ? round.criteria.filter(c => c.passed === false).length : null,
    };
  });
}

export const labScreenOrigin: readonly [number, number, number] = [anchors.labBench[0] - 0.3, 1.3, anchors.labBench[1] + 0.068];

/** Same three-step toon ramp as Environment; shared by every monster batch material. */
export function makeLabGradient() {
  const gradient = new THREE.DataTexture(new Uint8Array([115, 195, 255]), 3, 1, THREE.RedFormat);
  gradient.unpackAlignment = 1;
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

type CanvasLine = { text: string; color?: string; size?: number };
/** Canvas text only; shared by QA, overflow and hover labels. Allocated after commit. */
export function LabCanvasLabel({ lines, position, width, height, quality = 'high', background = '#293D46' }: {
  lines: readonly CanvasLine[];
  position: readonly [number, number, number];
  width: number; height: number;
  quality?: 'high' | 'low'; background?: string;
}) {
  const invalidate = useThree(s => s.invalidate);
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);
  useLayoutEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = quality === 'low' ? 768 : 1536;
    canvas.height = Math.max(128, Math.round(canvas.width * height / width));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    const created = new THREE.Mesh(geometry, material);
    created.raycast = () => {};
    let active = true;
    const draw = () => {
      ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const rowHeight = canvas.height / Math.max(1, lines.length);
      lines.forEach((line, index) => {
        ctx.fillStyle = line.color ?? palette.cream;
        ctx.font = `600 ${Math.min(rowHeight * 0.7, canvas.width * (line.size ?? 0.032))}px "Inter Variable"`;
        ctx.fillText(line.text, canvas.width * 0.025, rowHeight * (index + 0.5), canvas.width * 0.95);
      });
      texture.needsUpdate = true; invalidate();
    };
    draw(); setMesh(created);
    void document.fonts?.load('600 32px "Inter Variable"').then(() => { if (active) draw(); }).catch(() => {});
    return () => { active = false; geometry.dispose(); material.dispose(); texture.dispose(); };
  }, [lines, width, height, quality, background, invalidate]);
  return mesh ? <primitive object={mesh} position={position} dispose={null} /> : null;
}

const verdictColors: Record<Verdict, string> = { passed: palette.mint, 'changes-requested': palette.rose, running: palette.apricot };

export function TestingLab({ games, reports, scannerProjectId, quality = 'high', still = false, locale = 'vi' }: TestingLabProps) {
  const rows = useMemo(() => deriveLabRows(games, reports), [games, reports]);
  const copy = labels[locale];
  const lines = useMemo<CanvasLine[]>(() => {
    if (!rows.length) return [{ text: copy.testingLab }, { text: copy.noRound }];
    return rows.flatMap(row => [
      { text: row.name },
      { text: row.verdict ? `${({ passed: copy.passed, 'changes-requested': copy.changes, running: copy.running })[row.verdict]} · ${row.passed} ${copy.passedCount} / ${row.failed} ${copy.failedCount}` : copy.noRound,
        color: row.verdict ? verdictColors[row.verdict] : palette.cream },
    ]);
  }, [rows, copy]);
  const scanner = scannerProjectId ? rows.find(row => row.projectId === scannerProjectId) : rows.find(row => row.verdict !== null);
  const verdict = scanner?.verdict ?? null;
  const strips = useRef<THREE.Group>(null);
  const motion = useWorldMotion();
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => { invalidate(); if (!still && verdict === 'running') return motion.request('ambient'); }, [verdict, still, motion, invalidate]);
  useFrame(({ clock }) => {
    const opacity = !still && verdict === 'running' ? 0.84 + Math.sin(clock.elapsedTime * 2) * 0.1 : 1;
    strips.current?.children.forEach(child => { ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = opacity; });
  });
  const color = verdict ? verdictColors[verdict] : '#40545C';
  return <>
    <LabCanvasLabel lines={lines} position={labScreenOrigin} width={1.25} height={0.48} quality={quality} />
    <group ref={strips} position={[anchors.scanner[0], 0, anchors.scanner[1] + 0.211]}>
      {[-0.85, 0.85].map(dx => <mesh key={dx} position={[dx, 0.95, 0]}>
        <boxGeometry args={[0.075, 1.51, 0.012]} /><meshBasicMaterial color={color} transparent toneMapped={false} />
      </mesh>)}
      <mesh position={[0, 1.85, 0]}><boxGeometry args={[1.66, 0.065, 0.012]} /><meshBasicMaterial color={color} transparent toneMapped={false} /></mesh>
    </group>
  </>;
}
