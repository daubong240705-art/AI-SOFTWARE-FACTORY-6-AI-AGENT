import type { AgentSelector, FlowNode } from '@factory/contracts';
import { Bot, Braces, CircleCheck, Clock, GitBranch, GitMerge, Layers, ListTree, Repeat, ShieldCheck, Workflow, Zap } from 'lucide-react';

export const nodeIcons = {
  trigger: Zap, agent: Bot, action: Braces, condition: GitBranch, parallel: Layers, join: GitMerge,
  approval: ShieldCheck, loop: Repeat, wait: Clock, subflow: Workflow, orchestrate: ListTree, output: CircleCheck,
} satisfies Record<FlowNode['type'], typeof Bot>;
export const nodeKinds = Object.keys(nodeIcons) as FlowNode['type'][];
export type ActionNode = Extract<FlowNode, { type: 'action' }>;
export const actionKinds = ['notify.send', 'artifact.save', 'http.request', 'bundle.publish', 'git.push-branch', 'knowledge.publish'] as const satisfies readonly ActionNode['action'][];
export const unsupportedAction = (action: ActionNode['action']) => action === 'git.push-branch' || action === 'knowledge.publish';
export const bundleDefaults = { dir: 'dist', ref: 'integration', scripts: ['ci', 'build'] } satisfies ActionNode['params'];
export const actionLabel = (action: ActionNode['action']) => action === 'bundle.publish' ? 'Publish bundle' : action;
export const unsupported = (node: FlowNode) => node.type === 'parallel' || (node.type === 'action' && unsupportedAction(node.action));

export function newNode(type: FlowNode['type'], title: string, existing: FlowNode[], agent: AgentSelector, acceptance: string): FlowNode {
  let id: string = type;
  for (let suffix = 2; existing.some(node => node.id === id); suffix++) id = `${type}-${suffix}`;
  const common = { id, title, onError: 'fail' as const };
  switch (type) {
    case 'trigger': return { ...common, type, trigger: { kind: 'manual' } };
    case 'agent': return { ...common, type, agent, task: { title, instructions: '', acceptance: [acceptance], inputs: [] }, review: 'none' };
    case 'action': return { ...common, type, action: 'notify.send', params: {} };
    case 'condition': return { ...common, type, rules: [{ when: { path: 'inputs', op: 'eq', value: '' }, port: 'match' }] };
    case 'parallel': return { ...common, type, forEach: 'inputs', maxConcurrency: 1 };
    case 'join': return { ...common, type, policy: 'all', merge: 'object' };
    case 'approval': return { ...common, type, approver: 'operator', prompt: '' };
    case 'loop': return { ...common, type, maxIterations: 1 };
    case 'wait': return { ...common, type, wait: { for: 1 } };
    case 'subflow': return { ...common, type, workflow: 'subflow', version: 'published', inputs: {} };
    case 'orchestrate': return { ...common, type, lead: agent, goal: '', allowed: [agent], maxTasks: 1, maxDepth: 1 };
    case 'output': return { ...common, type, target: 'deliver', from: ['trigger.input'] };
  }
}
