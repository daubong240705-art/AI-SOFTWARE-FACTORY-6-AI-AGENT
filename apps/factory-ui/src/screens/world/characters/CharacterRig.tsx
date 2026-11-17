import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import type { WorldQuality } from '../scene/quality';
import { createCharacter, retainCharacterAssets } from './build';
import { useAnimatedCharacter } from './animator';
import type { CharacterSpec, Pose } from './spec';

export type CharacterRigProps = {
  spec: CharacterSpec; pose: Pose; position: [number, number, number]; yaw?: number; phase: number; quality: WorldQuality; visible?: boolean;
};
/** Feet rest at local y≈0.04. +Z faces forward; yaw=π/4 faces the default isometric camera quadrant. */
export function CharacterRig({ spec, pose, position, yaw = Math.PI / 4, phase, quality, visible = true }: CharacterRigProps) {
  const invalidate = useThree(state => state.invalidate);
  const character = useMemo(() => createCharacter(spec, quality), [spec, quality]);
  useAnimatedCharacter(character, pose, phase);
  useEffect(() => retainCharacterAssets(invalidate), [invalidate, character]);
  useEffect(() => { invalidate(); }, [invalidate, position, yaw, visible]);
  return <group name={`rig-${spec.code}`} position={position} rotation={[0, yaw, 0]} visible={visible} dispose={null}>
    <primitive object={character} dispose={null} />
  </group>;
}
