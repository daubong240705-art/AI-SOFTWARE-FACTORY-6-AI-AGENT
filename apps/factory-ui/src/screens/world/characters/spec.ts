import type { ArtCode } from '../../../components/mascot/OriginalMascot';

export type CharacterSpec = {
  code: ArtCode | 'OPERATOR';
  colors: { body: string; belly: string; accent: string; inner: string; dark: string; cheek: string; outline: string };
  ears: 'none' | 'pointed' | 'round' | 'long' | 'crest';
  face: { eyes: 'oval'; brows?: 'angry'; mask?: string; beak?: string; whiskers?: string; cheeks: boolean };
  accessories: Array<'boss-cap' | 'crown' | 'headset' | 'glasses' | 'brush' | 'laptop' | 'gear' | 'magnifier'>;
  model?: { kind: 'glb'; url: string };
};

export type Pose = 'idle' | 'thinking' | 'working' | 'attention' | 'success' | 'error' | 'resting';
