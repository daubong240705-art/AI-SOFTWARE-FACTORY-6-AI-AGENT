import { CharacterRig } from '../../characters/CharacterRig';
import { operatorSpec } from '../../characters/specs';
const ignore = () => {};
/** Same readable cap and Factory backpack in Walk mode and at the return marker. */
export function OperatorAvatar({ quality }: { quality: 'high' | 'low' }) {
  return <>
    <CharacterRig spec={operatorSpec} pose="idle" position={[0, 0, 0]} yaw={0} phase={0} quality={quality} />
    <group position={[0, 0.43, -0.39]}>
      <mesh raycast={ignore}><boxGeometry args={[0.42, 0.45, 0.22]} /><meshToonMaterial color="#527C86" /></mesh>
      <mesh position={[0, -0.1, -0.12]} raycast={ignore}><boxGeometry args={[0.32, 0.16, 0.07]} /><meshToonMaterial color="#3D5B64" /></mesh>
      {[-1, 1].map(side => <mesh key={side} position={[side * 0.17, 0.08, 0.08]} raycast={ignore}><boxGeometry args={[0.055, 0.42, 0.11]} /><meshToonMaterial color="#E0A458" /></mesh>)}
      <group rotation={[0, Math.PI, 0]} position={[0, 0.07, -0.12]}>
        {[[-0.05, 0, 0.025, 0.17], [0, 0.075, 0.12, 0.025], [-0.01, 0.005, 0.1, 0.025]].map(([x, y, w, h], i) => <mesh key={i} position={[x!, y!, 0]} raycast={ignore}><boxGeometry args={[w!, h!, 0.018]} /><meshBasicMaterial color="#FFF8E7" /></mesh>)}
      </group>
    </group>
  </>;
}
