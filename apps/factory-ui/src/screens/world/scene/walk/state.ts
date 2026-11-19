export type WalkTarget = { kind: 'agent' | 'owner' | 'task' | 'bug' | 'release' | 'stage' | 'cat'; id: string; name?: string; projectId?: string; distance?: number };
export type WalkState = {
  position: [number, number, number]; yaw: number; pitch: number; firstPerson: boolean;
  /** Third-person boom distance, adjusted by the mouse wheel in Walk mode. */
  cameraDistance: number;
  target: WalkTarget | null; visited: boolean; looked: boolean; speech: string; speechAt: number;
};
export const initialWalk = (): WalkState => ({ position: [0, 0, -1], yaw: 0, pitch: -0.12, firstPerson: false, cameraDistance: 3.8, target: null, visited: false, looked: false, speech: '', speechAt: 0 });
