export type WalkTarget = { kind: 'agent' | 'owner' | 'task' | 'bug' | 'release' | 'stage' | 'cat'; id: string; name?: string; projectId?: string; distance?: number };
export type WalkState = { position: [number, number, number]; yaw: number; pitch: number; firstPerson: boolean; target: WalkTarget | null };
export const initialWalk = (): WalkState => ({ position: [0, 0, -1], yaw: 0, pitch: -0.12, firstPerson: false, target: null });
