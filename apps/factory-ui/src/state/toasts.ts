import type { Approval, Command } from '@factory/contracts';
import { toast } from 'sonner';
import { i18n } from '../i18n';

function successKey(command: Command, approvalKind?: Approval['kind']) {
  switch (command.type) {
    case 'models.set': return 'modelsUi.saved';
    case 'artifacts.share': return 'knowledgeWrite.shared';
    case 'artifacts.clear-stale': return 'knowledgeWrite.reviewed';
    case 'integration.retry': return 'integrationUi.retryRequested';
    case 'integration.skip': return 'integrationUi.skipped';
    case 'autonomy.set': return 'settingsWrite.autonomySaved';
    case 'standing-approvals.create': return 'settingsWrite.approvalCreated';
    case 'standing-approvals.revoke': return 'settingsWrite.approvalRevoked';
    case 'rules.create':
    case 'monitors.create': return 'automationWrite.created';
    case 'rules.update':
    case 'monitors.update': return 'automationWrite.saved';
    case 'rules.pause':
    case 'monitors.pause': return 'automationWrite.paused';
    case 'rules.resume':
    case 'monitors.resume': return 'automationWrite.resumed';
    case 'rules.delete':
    case 'monitors.delete': return 'automationWrite.deleted';
    case 'approvals.decide': {
      if (approvalKind === 'question') return 'toastUi.answered';
      const { optionId } = command.payload;
      if (optionId === 'request-changes') return 'toastUi.changesRequested';
      if (approvalKind === 'start-gate' && ['go', 'start', 'approve', 'accept'].includes(optionId)) return 'toastUi.started';
      if (optionId === 'approve' || optionId === 'accept') return 'toastUi.approved';
      return 'toastUi.answered';
    }
    case 'tasks.create': return 'toastUi.taskCreated';
    // Starting uses the Execution Gate release command; transition to active is a retry.
    case 'tasks.release': return 'toastUi.started';
    case 'tasks.transition': return command.payload.to === 'accepted' ? 'toastUi.approved' : undefined;
    case 'projects.create': return 'toastUi.projectCreated';
    case 'projects.update':
    case 'budgets.set':
      return 'toastUi.saved';
    default: return undefined;
  }
}

export function notifyCommandSuccess(command: Command, approvalKind?: Approval['kind']) {
  const key = successKey(command, approvalKind);
  if (key) toast.success(i18n.t(key), { id: command.commandId, duration: 2500 });
}

export function notifyEffectReconciled(effectId: string) {
  toast.success(i18n.t('codeUi.reconciled'), { id: `reconcile:${effectId}`, duration: 2500 });
}
