import type { Node } from '@xyflow/react';
import type { WorkflowGraph, WorkflowStage } from '@/api/m5Models';
import type { LiveRuns } from './useLiveRuns';

export type StageDefinition = WorkflowGraph['stages'][number];
export type GateDefinition = WorkflowGraph['gates'][number];
export type StageData = { definition: StageDefinition; stage: WorkflowStage; phaseIndex: number; maxLoops: number | null; liveRuns?: LiveRuns; editable?: boolean };
export type GateData = { gate: GateDefinition; waiting: boolean };
export type BandData = { label: string; policy?: string; quorum?: number | null };
export type WorkflowNode = Node<StageData, 'stage'> | Node<GateData, 'gate'> | Node<BandData, 'band' | 'parallel'>;
export type WorkflowGraphProps = {
  graph: WorkflowGraph; stages?: WorkflowStage[]; phases?: string[];
  liveRuns?: LiveRuns;
  editMode?: boolean;
  selectedStage?: string | null; onSelectStage?: (key: string | null) => void; preview?: boolean;
};
export const phaseBorders = ['border-l-project-1', 'border-l-project-2', 'border-l-project-3', 'border-l-project-4'];
export function stageState(key: string, stages: WorkflowStage[]): WorkflowStage {
  return stages.find(stage => stage.key === key) ?? { key, phase: '', state: 'pending', tasks: [] };
}
