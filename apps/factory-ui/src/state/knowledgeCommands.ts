import type { Command } from '@factory/contracts';

export type KnowledgeCommand = Extract<Command, { type: 'artifacts.share' | 'artifacts.clear-stale' }>;
export function knowledgePendingKey(artifactId: string, version: number) {
  return `knowledge-write:${artifactId}:${version}`;
}
