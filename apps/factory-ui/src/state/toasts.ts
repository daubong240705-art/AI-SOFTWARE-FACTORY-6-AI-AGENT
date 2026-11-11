import type { Approval, Command } from '@factory/contracts';
import { toast } from 'sonner';
import { i18n } from '../i18n';

function successKey(command: Command, approvalKind?: Approval['kind']) {
  switch (command.type) {
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
    case 'seats.update':
    case 'engagements.create':
    case 'engagements.update':
    case 'teams.create-from-pack':
    case 'teams.set-lifecycle': return 'toastUi.saved';
    default: return undefined;
  }
}

export function notifyCommandSuccess(command: Command, approvalKind?: Approval['kind']) {
  const key = successKey(command, approvalKind);
  if (key) toast.success(i18n.t(key), { id: command.commandId, duration: 2500 });
}
