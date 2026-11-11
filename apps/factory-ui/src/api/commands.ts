import { API_VERSION, commandSchema, type Command } from '@factory/contracts';

type Of<T extends Command['type']> = Extract<Command, { type: T }>;
function build<T extends Command['type']>(type: T, projectId: string, payload: Of<T>['payload']): Of<T> {
  return commandSchema.parse({ apiVersion: API_VERSION, commandId: crypto.randomUUID(), projectId, type, payload }) as Of<T>;
}

export function projectsCreate({ name, root, kind = 'directory' }: { name: string; root: string; kind?: 'directory' | 'git' }) {
  return build('projects.create', crypto.randomUUID(), { name, workspace: { kind, root } });
}
export function conversationsCreate({ projectId, seatId, title }: { projectId: string; seatId: string; title: string }) {
  return build('conversations.create', projectId, { conversationId: crypto.randomUUID(), agentId: seatId, title, workItemId: null });
}
export function chatSend({ projectId, conversationId, conversationRevision, text, intent }: {
  projectId: string; conversationId: string; conversationRevision: number; text: string; intent: 'discuss' | 'delegate';
}) {
  return build('chat.send', projectId, { conversationId, expectedRevision: conversationRevision, messageId: crypto.randomUUID(), text, intent, attachmentIds: [], context: [], draftRevision: null });
}
export function tasksTransition({ projectId, ...payload }: Of<'tasks.transition'>['payload'] & { projectId: string }) {
  return build('tasks.transition', projectId, payload);
}
export function tasksRelease({ projectId, ...payload }: Of<'tasks.release'>['payload'] & { projectId: string }) {
  return build('tasks.release', projectId, payload);
}
export function runsCancel({ projectId, attemptId, expectedRevision }: { projectId: string; attemptId: string; expectedRevision: number }) {
  return build('runs.cancel', projectId, { runId: attemptId, expectedRevision });
}
export function tasksRetry({ projectId, taskId, expectedRevision }: { projectId: string; taskId: string; expectedRevision: number }) {
  return tasksTransition({ projectId, taskId, expectedRevision, to: 'active' });
}
export function approvalsDecide({ projectId, ...payload }: Of<'approvals.decide'>['payload'] & { projectId: string }) {
  return build('approvals.decide', projectId, payload);
}
export function workflowsDecidePatch({ projectId, ...payload }: Of<'workflows.decide-patch'>['payload'] & { projectId: string }) {
  return build('workflows.decide-patch', projectId, payload);
}
export function workflowsCreate({ projectId, ...payload }: Of<'workflows.create'>['payload'] & { projectId: string }) { return build('workflows.create', projectId, payload); }
export function workflowsStart({ projectId, ...payload }: Of<'workflows.start'>['payload'] & { projectId: string }) { return build('workflows.start', projectId, payload); }
export function workflowsPause({ projectId, ...payload }: Of<'workflows.pause'>['payload'] & { projectId: string }) { return build('workflows.pause', projectId, payload); }
export function workflowsResume({ projectId, ...payload }: Of<'workflows.resume'>['payload'] & { projectId: string }) { return build('workflows.resume', projectId, payload); }
export function workflowsCancel({ projectId, ...payload }: Of<'workflows.cancel'>['payload'] & { projectId: string }) { return build('workflows.cancel', projectId, payload); }
export function workflowsAssignStage({ projectId, ...payload }: Of<'workflows.assign-stage'>['payload'] & { projectId: string }) { return build('workflows.assign-stage', projectId, payload); }
export function tasksCreate({ projectId, code, title, goal, brief = goal, acceptance, requiredCapabilities = [] }: {
  projectId: string; code: string; title: string; goal: string; brief?: string;
  acceptance: string[]; requiredCapabilities?: string[];
}) {
  return build('tasks.create', projectId, { taskId: crypto.randomUUID(), code, title, goal, brief,
    parentTaskId: null, engagementId: null, ownerSeatId: null, inputs: [], dependsOn: [],
    acceptance, requiredCapabilities, placement: 'node-bound', sideEffect: 'external-irreversible',
    reviewPolicy: 'human-final', requiresGo: true });
}

export function nextTaskCode(tasks: readonly { code: string }[], prefix = 'TSK'): string {
  let largest = 0;
  for (const { code } of tasks) {
    if (!code.startsWith(`${prefix}-`)) continue;
    const suffix = code.slice(prefix.length + 1);
    if (/^\d+$/.test(suffix)) largest = Math.max(largest, Number(suffix));
  }
  return `${prefix}-${String(largest + 1).padStart(3, '0')}`;
}
export function budgetsSet({ projectId, ...payload }: Of<'budgets.set'>['payload'] & { projectId: string }) {
  return build('budgets.set', projectId, payload);
}

export function teamsCreateFromPack({ projectId, ...payload }: Of<'teams.create-from-pack'>['payload'] & { projectId: string }) { return build('teams.create-from-pack', projectId, payload); }

export function teamsSetLifecycle({ projectId, ...payload }: Of<'teams.set-lifecycle'>['payload'] & { projectId: string }) { return build('teams.set-lifecycle', projectId, payload); }

export function engagementsCreate({ projectId, ...payload }: Of<'engagements.create'>['payload'] & { projectId: string }) { return build('engagements.create', projectId, payload); }

export function engagementsUpdate({ projectId, ...payload }: Of<'engagements.update'>['payload'] & { projectId: string }) { return build('engagements.update', projectId, payload); }

export function seatsUpdate({ projectId, ...payload }: Of<'seats.update'>['payload'] & { projectId: string }) { return build('seats.update', projectId, payload); }

export function requestsTriage({ projectId, ...payload }: Of<'requests.triage'>['payload'] & { projectId: string }) { return build('requests.triage', projectId, payload); }

export function requestsMessage({ projectId, ...payload }: Of<'requests.message'>['payload'] & { projectId: string }) { return build('requests.message', projectId, payload); }

export function artifactsTransition({ projectId, ...payload }: Of<'artifacts.transition'>['payload'] & { projectId: string }) { return build('artifacts.transition', projectId, payload); }

export function dossierRefresh({ projectId, ...payload }: { projectId: string }) { return build('dossier.refresh', projectId, payload); }
