import { API_VERSION, commandSchema, type Command } from '@factory/contracts';
import { LIBRARY_SCOPE_ID, SYSTEM_SCOPE_ID } from '@factory/contracts';
import type { IntegrationSpec } from '@factory/contracts';

type Of<T extends Command['type']> = Extract<Command, { type: T }>;
export type SetupCommandType = Extract<Command['type'], `setup.${string}`>;
export function setupCommand<Type extends SetupCommandType>(type: Type, projectId: string, payload: Of<Type>['payload']) {
  return build(type, projectId, payload);
}

function build<T extends Command['type']>(type: T, projectId: string, payload: Of<T>['payload']): Of<T> {
  return commandSchema.parse({ apiVersion: API_VERSION, commandId: crypto.randomUUID(), projectId, type, payload }) as Of<T>;
}

export function agentsCreate({ projectId, ...payload }: Omit<Of<'agents.create'>['payload'], 'agentId'> & { projectId: string }) { return build('agents.create', projectId, { ...payload, agentId: crypto.randomUUID() }); }
export function agentsUpdate({ projectId, ...payload }: Of<'agents.update'>['payload'] & { projectId: string }) { return build('agents.update', projectId, payload); }
export function agentsClone({ projectId, ...payload }: Omit<Of<'agents.clone'>['payload'], 'agentId'> & { projectId: string }) { return build('agents.clone', projectId, { ...payload, agentId: crypto.randomUUID() }); }
export function agentsSetStatus({ projectId, ...payload }: Of<'agents.set-status'>['payload'] & { projectId: string }) { return build('agents.set-status', projectId, payload); }
export function agentsSetLead({ projectId, ...payload }: Of<'agents.set-lead'>['payload'] & { projectId: string }) { return build('agents.set-lead', projectId, payload); }
export function agentsRollback({ projectId, ...payload }: Of<'agents.rollback'>['payload'] & { projectId: string }) { return build('agents.rollback', projectId, payload); }
export function agentsDelete({ projectId, ...payload }: Of<'agents.delete'>['payload'] & { projectId: string }) { return build('agents.delete', projectId, payload); }
export function agentsSaveAsTemplate({ projectId, ...payload }: Omit<Of<'agents.save-as-template'>['payload'], 'templateId'> & { projectId: string }) { return build('agents.save-as-template', projectId, { ...payload, templateId: crypto.randomUUID() }); }
export function agentsUpgradeFromTemplate({ projectId, ...payload }: Of<'agents.upgrade-from-template'>['payload'] & { projectId: string }) { return build('agents.upgrade-from-template', projectId, payload); }
export function skillsCreate(payload: Omit<Of<'skills.create'>['payload'], 'skillId'>) { return build('skills.create', LIBRARY_SCOPE_ID, { ...payload, skillId: crypto.randomUUID() }); }
export function skillsUpdate(payload: Of<'skills.update'>['payload']) { return build('skills.update', LIBRARY_SCOPE_ID, payload); }
export function skillsDelete(payload: Of<'skills.delete'>['payload']) { return build('skills.delete', LIBRARY_SCOPE_ID, payload); }
export function templatesCreate(payload: Omit<Of<'templates.create'>['payload'], 'templateId'>) { return build('templates.create', LIBRARY_SCOPE_ID, { ...payload, templateId: crypto.randomUUID() }); }
export function templatesUpdate(payload: Of<'templates.update'>['payload']) { return build('templates.update', LIBRARY_SCOPE_ID, payload); }
export function templatesDelete(payload: Of<'templates.delete'>['payload']) { return build('templates.delete', LIBRARY_SCOPE_ID, payload); }
export function agentTeamsCreate({ projectId, ...payload }: Omit<Of<'teams.create'>['payload'], 'teamId'> & { projectId: string }) { return build('teams.create', projectId, { ...payload, teamId: crypto.randomUUID() }); }
export function agentTeamsUpdate({ projectId, ...payload }: Of<'teams.update'>['payload'] & { projectId: string }) { return build('teams.update', projectId, payload); }
export function agentTeamsDelete({ projectId, ...payload }: Of<'teams.delete'>['payload'] & { projectId: string }) { return build('teams.delete', projectId, payload); }
export type FlowCommandType = Extract<Command['type'], `flows.${string}` | `flow-runs.${string}` | `insights.${string}`>;
export function flowCommand<T extends FlowCommandType>(type: T, projectId: string, payload: Of<T>['payload']) { return build(type, projectId, payload); }
export function relationsSet({ projectId, ...payload }: Of<'relations.set'>['payload'] & { projectId: string }) { return build('relations.set', projectId, payload); }

export function notificationsMarkRead({ projectId, ...payload }: Of<'notifications.mark-read'>['payload'] & { projectId: string }) { return build('notifications.mark-read', projectId, payload); }
export function notificationsDismiss({ projectId, ...payload }: Of<'notifications.dismiss'>['payload'] & { projectId: string }) { return build('notifications.dismiss', projectId, payload); }
export function modelsSet({ projectId, ...payload }: Of<'models.set'>['payload'] & { projectId: string }) { return build('models.set', projectId, payload); }
export function integrationRetry({ projectId, ...payload }: Of<'integration.retry'>['payload'] & { projectId: string }) { return build('integration.retry', projectId, payload); }
export function integrationSkip({ projectId, ...payload }: Of<'integration.skip'>['payload'] & { projectId: string }) { return build('integration.skip', projectId, payload); }

export function autonomySet({ projectId, ...payload }: Of<'autonomy.set'>['payload'] & { projectId: string }) {
  return build('autonomy.set', projectId, payload);
}
export function standingApprovalsCreate({ projectId, ...payload }: Omit<Of<'standing-approvals.create'>['payload'], 'standingId'> & { projectId: string }) {
  return build('standing-approvals.create', projectId, { standingId: crypto.randomUUID(), ...payload });
}
export function standingApprovalsRevoke({ projectId, ...payload }: Of<'standing-approvals.revoke'>['payload'] & { projectId: string }) {
  return build('standing-approvals.revoke', projectId, payload);
}

export function projectsCreate({ name, root, kind = 'directory', teamTemplate, groupId }: { name: string; root: string; kind?: 'directory' | 'git'; teamTemplate?: string | undefined; groupId?: string | null }) {
  return build('projects.create', crypto.randomUUID(), { name, workspace: { kind, root }, ...(teamTemplate ? { teamTemplate } : {}), ...(groupId ? { groupId } : {}) });
}
export function groupsCreate(payload: Omit<Of<'groups.create'>['payload'], 'groupId'>) { return build('groups.create', SYSTEM_SCOPE_ID, { ...payload, groupId: crypto.randomUUID() }); }
export function groupsUpdate(payload: Of<'groups.update'>['payload']) { return build('groups.update', SYSTEM_SCOPE_ID, payload); }
export function groupsMove(payload: Of<'groups.move'>['payload']) { return build('groups.move', SYSTEM_SCOPE_ID, payload); }
export function groupsArchive(payload: Of<'groups.archive'>['payload']) { return build('groups.archive', SYSTEM_SCOPE_ID, payload); }
export function groupsDelete(payload: Of<'groups.delete'>['payload']) { return build('groups.delete', SYSTEM_SCOPE_ID, payload); }
export function groupsSetSettings(payload: Of<'groups.set-settings'>['payload']) { return build('groups.set-settings', SYSTEM_SCOPE_ID, payload); }
export function integrationsCreate(spec: IntegrationSpec) { return build('integrations.create', SYSTEM_SCOPE_ID, { ...spec, id: crypto.randomUUID() }); }
export function integrationsUpdate(payload: Of<'integrations.update'>['payload']) { return build('integrations.update', SYSTEM_SCOPE_ID, payload); }
export function integrationsDelete(payload: Of<'integrations.delete'>['payload']) { return build('integrations.delete', SYSTEM_SCOPE_ID, payload); }
export function integrationsTest(payload: Of<'integrations.test'>['payload']) { return build('integrations.test', SYSTEM_SCOPE_ID, payload); }
export function credentialsCreate(payload: Omit<Of<'credentials.create'>['payload'], 'id'>) { return build('credentials.create', SYSTEM_SCOPE_ID, { ...payload, id: crypto.randomUUID() }); }
export function credentialsReplace(payload: Of<'credentials.replace'>['payload']) { return build('credentials.replace', SYSTEM_SCOPE_ID, payload); }
export function credentialsDelete(payload: Of<'credentials.delete'>['payload']) { return build('credentials.delete', SYSTEM_SCOPE_ID, payload); }
export function projectsSetGroup(projectId: string, payload: Of<'projects.set-group'>['payload']) { return build('projects.set-group', projectId, payload); }
export function projectsArchive({ projectId, expectedRevision, confirmName }: { projectId: string; expectedRevision: number; confirmName: string }) {
  return build('projects.archive', projectId, { expectedRevision, confirmName });
}
export function conversationsCreate({ projectId, seatId, title }: { projectId: string; seatId: string; title: string }) {
  return build('conversations.create', projectId, { conversationId: crypto.randomUUID(), agentId: seatId, title, workItemId: null });
}
export function chatSend({ projectId, conversationId, conversationRevision, text, intent }: {
  projectId: string; conversationId: string; conversationRevision: number; text: string; intent?: 'discuss' | 'delegate';
}) {
  return build('chat.send', projectId, { conversationId, expectedRevision: conversationRevision, messageId: crypto.randomUUID(), text, ...(intent ? { intent } : {}), attachmentIds: [], context: [], draftRevision: null });
}
export function setLeadChatMode({ projectId, ...payload }: Of<'projects.set-lead-chat-mode'>['payload'] & { projectId: string }) {
  return build('projects.set-lead-chat-mode', projectId, payload);
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
export function tasksCreate({ projectId, code, title, goal, brief = goal, acceptance, requiredCapabilities = [], inputs = [] }: {
  projectId: string; code: string; title: string; goal: string; brief?: string;
  acceptance: string[]; requiredCapabilities?: string[]; inputs?: Of<'tasks.create'>['payload']['inputs'];
}) {
  return build('tasks.create', projectId, { taskId: crypto.randomUUID(), code, title, goal, brief,
    parentTaskId: null, engagementId: null, ownerSeatId: null, inputs, dependsOn: [],
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






export function requestsTriage({ projectId, ...payload }: Of<'requests.triage'>['payload'] & { projectId: string }) { return build('requests.triage', projectId, payload); }

export function requestsMessage({ projectId, ...payload }: Of<'requests.message'>['payload'] & { projectId: string }) { return build('requests.message', projectId, payload); }

export function artifactsTransition({ projectId, ...payload }: Of<'artifacts.transition'>['payload'] & { projectId: string }) { return build('artifacts.transition', projectId, payload); }

export function dossierRefresh({ projectId, ...payload }: { projectId: string }) { return build('dossier.refresh', projectId, payload); }

export function rulesCreate({ projectId, ...payload }: Omit<Of<'rules.create'>['payload'], 'ruleId'> & { projectId: string }) {
  return build('rules.create', projectId, { ruleId: crypto.randomUUID(), ...payload });
}
export function rulesUpdate({ projectId, ...payload }: Of<'rules.update'>['payload'] & { projectId: string }) {
  return build('rules.update', projectId, payload);
}
export function rulesPause({ projectId, ...payload }: Of<'rules.pause'>['payload'] & { projectId: string }) {
  return build('rules.pause', projectId, payload);
}
export function rulesResume({ projectId, ...payload }: Of<'rules.resume'>['payload'] & { projectId: string }) {
  return build('rules.resume', projectId, payload);
}
export function rulesDelete({ projectId, ...payload }: Of<'rules.delete'>['payload'] & { projectId: string }) {
  return build('rules.delete', projectId, payload);
}
export function monitorsCreate({ projectId, ...payload }: Omit<Of<'monitors.create'>['payload'], 'monitorId'> & { projectId: string }) {
  return build('monitors.create', projectId, { monitorId: crypto.randomUUID(), ...payload });
}
export function monitorsUpdate({ projectId, ...payload }: Of<'monitors.update'>['payload'] & { projectId: string }) {
  return build('monitors.update', projectId, payload);
}
export function monitorsPause({ projectId, ...payload }: Of<'monitors.pause'>['payload'] & { projectId: string }) {
  return build('monitors.pause', projectId, payload);
}
export function monitorsResume({ projectId, ...payload }: Of<'monitors.resume'>['payload'] & { projectId: string }) {
  return build('monitors.resume', projectId, payload);
}
export function monitorsDelete({ projectId, ...payload }: Of<'monitors.delete'>['payload'] & { projectId: string }) {
  return build('monitors.delete', projectId, payload);
}

export function artifactsShare({ projectId, ...payload }: Of<'artifacts.share'>['payload'] & { projectId: string }) { return build('artifacts.share', projectId, payload); }
export function artifactsClearStale({ projectId, ...payload }: Of<'artifacts.clear-stale'>['payload'] & { projectId: string }) { return build('artifacts.clear-stale', projectId, payload); }
