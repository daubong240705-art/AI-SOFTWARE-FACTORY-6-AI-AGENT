import type { Inbox } from '../src/api/client';
import { attentionHash } from '../src/screens/Attention';
import { setupUI, artifact, attempt, patch } from './ui-fixtures';
import { allKinds } from './attention-fixtures';
import { envelope, id, task } from './fixtures';
import { requestDetail } from './m3-fixtures';

export async function attentionSetup(inbox: Inbox = allKinds, key?: string) {
  history.replaceState(null, '', attentionHash(key));
  const fixture = setupUI();
  fixture.api.getGlobalInbox.mockResolvedValue({ ...envelope, ...inbox });
  fixture.api.getInbox.mockResolvedValue({ ...envelope, ...inbox });
  fixture.api.getApproval.mockImplementation(async (_projectId: string, approvalId: string) => ({ ...envelope, approval: inbox.approvals.find(item => item.id === approvalId) }));
  fixture.api.listTasks.mockResolvedValue({ ...envelope, items: [{ ...task, state: 'awaiting-go', acceptance: ['Tests pass', 'Handles empty input'] }] });
  fixture.api.listAttempts.mockResolvedValue({ ...envelope, attempts: [{ ...attempt, state: 'succeeded' }] });
  fixture.api.listTaskArtifacts.mockResolvedValue({ ...envelope, items: [artifact] });
  fixture.api.getAttemptPatch.mockResolvedValue({ ...envelope, ...patch });
  fixture.api.listAttemptEvents.mockResolvedValue({ ...envelope, events: [{ seq: 1, at: attempt.startedAt, kind: 'evidence', body: { detail: '12 tests passed', files: [{ path: 'a.ts', status: 'modified' }], totals: { files: 1, additions: 1, deletions: 1 } } }] });
  fixture.api.getRequest.mockResolvedValue({ ...envelope, request: requestDetail });
  await fixture.store.boot(); await fixture.store.loadProjects(); await fixture.store.selectProject(id);
  return fixture;
}
