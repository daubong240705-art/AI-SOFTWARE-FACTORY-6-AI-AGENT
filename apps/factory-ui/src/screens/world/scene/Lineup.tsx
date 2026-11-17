import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CharacterAnimator, CharacterRig, characterCodes, characterSpecs, characterPoses, phaseForSeat, poseLabels } from '../characters';
import { retainCharacterAssets } from '../characters/build';
import { characterResources, glyphMesh } from '../characters/resources';
import { useWorldPreferences } from '../preferences';
import type { WorldQuality } from './quality';

const spacingX = 1.72; const spacingZ = 1.85; const yaw = Math.PI / 4;
export const lineupDimensions = { width: 18, depth: 15, targetHeight: 0.5 } as const;
function Label({ text, position, width = 1.4 }: { text: string; position: [number, number, number]; width?: number }) {
  const invalidate = useThree(state => state.invalidate);
  const label = useMemo(() => glyphMesh(text, width, 0.48), [text, width]);
  useEffect(() => retainCharacterAssets(invalidate), [invalidate, label]);
  // Labels lie on the floor, with text oriented toward the same camera quadrant as the faces.
  return <group position={position} rotation={[-Math.PI / 2, 0, 0]} dispose={null}><primitive object={label} dispose={null} /></group>;
}
function ReviewGrid({ origin, quality, locale }: { origin: [number, number]; quality: WorldQuality; locale: 'vi' | 'en' }) {
  const [ox, oz] = origin;
  const floor = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(lineupDimensions.width, lineupDimensions.depth);
    const color = new THREE.Color('#F9F4E9');
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: 4 }, () => color.toArray()).flat(), 3));
    return geometry;
  }, []);
  useEffect(() => () => floor.dispose(), [floor]);
  // Rotate the whole rectangular grid around Y so columns remain horizontal in the default camera view.
  return <group position={[ox, 0.23, oz]} rotation={[0, yaw, 0]} name="character-lineup" dispose={null}>
    <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} geometry={floor} material={characterResources().toon} />
    {characterCodes.map((code, column) => {
      const x = (column - 4) * spacingX;
      return <group key={code}>
        <Label text={code} position={[x, 0.006, 6.9]} />
        {characterPoses.map((pose, row) => <CharacterRig key={pose} spec={characterSpecs[code]} pose={pose}
          position={[x, 0, (row - 3) * spacingZ]} yaw={0} phase={phaseForSeat(`${code}:${pose}`)} quality={quality} />)}
      </group>;
    })}
    {characterPoses.map((pose, row) => <Label key={pose} text={poseLabels[pose][locale]} position={[-8.05, 0.006, (row - 3) * spacingZ + 0.5]} width={1.55} />)}
  </group>;
}
/** Self-contained review scene inside Ticker. Origin is the grid centre in world x/z. Camera focus stays with CameraRig. */
export function Lineup({ origin, quality, still, locale = 'vi' }: {
  origin: [number, number]; quality?: WorldQuality; still?: boolean; locale?: 'vi' | 'en';
}) {
  const [preferences] = useWorldPreferences();
  return <CharacterAnimator still={still ?? preferences.still}>
    <ReviewGrid origin={origin} quality={quality ?? (preferences.quality === 'low' ? 'low' : 'high')} locale={locale} />
  </CharacterAnimator>;
}
export default Lineup;
