import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiClientError } from '../src/api/client';
import { Attention, attentionHash } from '../src/screens/Attention';
import { AppShell } from '../src/screens/AppShell';
import type { Store } from '../src/state/store';
import { allKinds, kindMix } from './attention-fixtures';
import { attentionSetup } from './attention-test-utils';
import { envelope, id, otherId } from './fixtures';
import { review } from './inbox-fixtures';
import { requestDetail } from './m3-fixtures';

const stores: Store[] = [];
afterEach(() => { cleanup(); stores.splice(0).forEach(store => store.dispose()); vi.restoreAllMocks(); });
async function setup(key?: string, inbox = allKinds) {
  const value = await attentionSetup(inbox, key); stores.push(value.store);
  return { ...value, ...render(<Attention store={value.store} />) };
}
const pane = () => screen.getByRole('region', { name: 'Item details' });
const rows = () => within(screen.getByRole('list', { name: 'Attention items' })).getAllByRole('button');
const selected = () => rows().find(row => row.getAttribute('aria-current') === 'true');

it('renders review results, criteria, checks and integration facts inline with technical details collapsed', async () => {
  await setup(); await screen.findByRole('button', { name: 'Approve' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(rows()).toHaveLength(10); expect(selected()?.textContent).toContain('Review patch');
  expect(await screen.findByRole('region', { name: 'Patch diff' })).toBeTruthy();
  const facts = screen.getByRole('complementary', { name: 'Review facts' });
  expect(within(facts).getByText('Tests pass')).toBeTruthy(); expect(within(facts).getByText('12 tests passed')).toBeTruthy();
  expect(within(facts).getByText('Integration conflict: factory/integration')).toBeTruthy();
  expect(screen.getByText('modified a.ts')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Request changes' })).toBeTruthy();
  expect([...pane().querySelectorAll('details')].every(detail => !detail.open)).toBe(true);
  expect(pane().querySelectorAll('kbd').length).toBeGreaterThanOrEqual(4);
});

it('selects by click and preserves the selected hash after remount and external hash changes', async () => {
  const { store, unmount } = await setup();
  fireEvent.click(rows().find(row => row.textContent?.includes('Which colour?'))!);
  await screen.findByRole('button', { name: 'Answer' });
  expect(selected()?.textContent).toContain('Which colour?'); expect(location.hash).toBe(attentionHash(`approval:${otherId}`));
  unmount(); render(<Attention store={store} />);
  await screen.findByRole('button', { name: 'Answer' }); expect(selected()?.textContent).toContain('Which colour?');
  act(() => { location.hash = attentionHash(`patch:${id}`); });
  await screen.findByRole('button', { name: 'Reject' }); expect(selected()?.textContent).toContain('Add a verification stage');
});

it.each([
  [`workflow:${id}`, 'Stalled workflow', 'Waiting for a missing artifact'],
  [`breaker:${id}`, 'Team paused by breaker', 'Three consecutive failures'],
  [`conflict:${id}`, 'Integration conflict', 'factory/integration'],
  [`rule:${id}`, 'Quarantined rule', 'Retry rule'],
  [`monitor:${id}`, 'Monitor not healthy', 'error-rate: 12'],
])('renders read-only %s with one Open link and no action buttons', async (key, heading, text) => {
  await setup(key); await within(pane()).findByRole('heading', { name: heading });
  expect(within(pane()).getByText(text)).toBeTruthy();
  expect(within(pane()).getAllByRole('link')).toHaveLength(1);
  expect(within(pane()).getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(`#/project/${id}`);
  expect(within(pane()).queryAllByRole('button')).toHaveLength(0);
});

it('releases a gate through the existing confirmation and command', async () => {
  const { api } = await setup(`gate:${id}`);
  fireEvent.click(await screen.findByRole('button', { name: 'Release' }));
  expect(screen.getByText('Build core')).toBeTruthy(); expect(api.sendCommand).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(api.sendCommand).toHaveBeenCalledOnce());
  expect(api.sendCommand.mock.calls[0]?.[0]).toMatchObject({ type: 'tasks.release', projectId: id, payload: { taskId: id, expectedRevision: 1 } });
});

it('keeps question options unselected and confirms the chosen answer', async () => {
  const { api } = await setup(`approval:${otherId}`);
  const answer = await screen.findByRole('button', { name: 'Answer' }); expect((answer as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: /Yes/ })); fireEvent.click(answer);
  expect(api.sendCommand).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(api.sendCommand).toHaveBeenCalledOnce());
  expect(api.sendCommand.mock.calls[0]?.[0].payload).toMatchObject({ approvalId: otherId, optionId: 'yes' });
});

it('handles a request inline and preserves reason validation', async () => {
  const { api } = await setup(`request:${id}`);
  await within(pane()).findByRole('heading', { name: 'REQ-001 Find sources' });
  const accept = screen.getByRole('button', { name: /^Accept$/ }); expect((accept as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason (1-1000 characters)' }), { target: { value: 'Useful work' } });
  fireEvent.click(accept); await waitFor(() => expect(api.sendCommand).toHaveBeenCalledOnce());
  expect(api.sendCommand.mock.calls[0]?.[0]).toMatchObject({ type: 'requests.triage', payload: { requestTaskId: id, decision: 'accept', reason: 'Useful work' } });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(api.getRequest).toHaveBeenCalledWith(id, requestDetail.requestId);
});

it.each(['approve', 'reject'] as const)('sends plan patch %s only after confirmation', async decision => {
  const { api } = await setup(`patch:${id}`);
  await screen.findByRole('button', { name: 'Reject' }); expect(screen.getByText('Add stage verify')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: decision === 'approve' ? 'Approve' : 'Reject' }));
  expect(api.sendCommand).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(api.sendCommand).toHaveBeenCalledOnce());
  expect(api.sendCommand.mock.calls[0]?.[0]).toMatchObject({ type: 'workflows.decide-patch', projectId: id, payload: { patchId: id, decision } });
});

it('moves to the next row after a successful review and announces it politely', async () => {
  const { api } = await setup(); fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  const remaining = { ...allKinds, approvals: allKinds.approvals.filter(item => item.id !== id) };
  api.getGlobalInbox.mockResolvedValue({ ...envelope, ...remaining });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(selected()?.textContent).toContain('Which colour?'));
  expect(document.activeElement).toBe(selected()); expect(location.hash).toBe(attentionHash(`approval:${otherId}`));
  const announcement = document.querySelector('[data-attention-announcement]');
  expect(announcement?.textContent).toBe('Decision recorded. Selected: Which colour?'); expect(announcement?.getAttribute('aria-live')).toBe('polite');
});

it('requires a non-whitespace change comment and sends fresh revision and digest', async () => {
  const { api } = await setup(); api.getApproval.mockResolvedValue({ ...envelope, approval: { ...review, revision: 9, context: { refs: [], digest: 'b'.repeat(64) } } });
  await screen.findByRole('button', { name: 'Approve' });
  await act(async () => { await stores[0]!.loadApproval(id); });
  fireEvent.click(screen.getByRole('button', { name: /^Request changes$/ }));
  const comment = screen.getByRole('textbox', { name: 'Comment (Required)' }); expect(document.activeElement).toBe(comment);
  const confirm = screen.getByRole('button', { name: 'Confirm request changes' }); expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(comment, { target: { value: '  ' } }); expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(comment, { target: { value: 'Fix the test' } }); fireEvent.click(confirm);
  expect(api.sendCommand).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));
  await waitFor(() => expect(api.sendCommand).toHaveBeenCalledOnce());
  expect(api.sendCommand.mock.calls[0]?.[0].payload).toMatchObject({ expectedRevision: 9, contextDigest: 'b'.repeat(64), optionId: 'request-changes', comment: 'Fix the test' });
});

it('refreshes conflicts and requires review again; errors retry the same identity', async () => {
  const { api } = await setup(); fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  api.sendCommand.mockRejectedValueOnce(new ApiClientError('api', 409, { code: 'conflict', message: 'Changed', nextAction: 'refresh', correlationId: id }));
  api.getApproval.mockResolvedValue({ ...envelope, approval: { ...review, revision: 2 } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); await screen.findByText('This item changed. Please review it again.');
  expect(screen.queryByRole('group', { name: 'Confirm task action' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Approve' })); api.sendCommand.mockRejectedValueOnce(new Error('PRIVATE'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); await screen.findByRole('alert'); expect(document.body.textContent).not.toContain('PRIVATE');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(3));
  expect(api.sendCommand.mock.calls[1]?.[0].payload.expectedRevision).toBe(2);
  expect(api.sendCommand.mock.calls[2]?.[0]).toBe(api.sendCommand.mock.calls[1]?.[0]);
});

it('blocks expired inline decisions', async () => {
  await setup(undefined, { ...allKinds, approvals: [{ ...review, expiresAt: '2026-01-01T00:00:00.000Z' }] });
  await screen.findByText('Expired'); expect(within(pane()).queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(within(pane()).queryByRole('radio')).toBeNull();
});

it('shows one empty sentence and Overview link, including after the last decision', async () => {
  const { api } = await setup(undefined, { ...kindMix(1) });
  fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  api.getGlobalInbox.mockResolvedValue({ ...envelope, ...kindMix(0) }); fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await screen.findByRole('link', { name: 'Overview' }); expect(location.hash).toBe('#/attention');
  expect(within(screen.getByRole('list', { name: 'Attention items' })).queryAllByRole('button')).toHaveLength(0);
  expect(document.querySelector('.attention-empty')?.textContent).toBe('All caught up. Overview');
  expect(document.querySelector('[data-attention-announcement]')?.textContent).toBe('Decision recorded. All caught up.');
  expect(document.activeElement).toBe(pane());
});

it('sidebar badge equals rendered row count for every kind combination', async () => {
  const { store, api } = await attentionSetup(kindMix(0)); stores.push(store); render(<AppShell store={store} />);
  const list = screen.getByRole('list', { name: 'Attention items' });
  for (let mask = 0; mask < 1024; mask++) {
    api.getGlobalInbox.mockResolvedValue({ ...envelope, ...kindMix(mask) });
    await act(async () => { await store.loadGlobalInbox(); });
    const count = mask.toString(2).replaceAll('0', '').length;
    const badge = screen.getByRole('navigation').querySelector('.attention-badge');
    expect(list.querySelectorAll(':scope > li > button'), `mask ${mask}`).toHaveLength(count);
    expect(badge?.textContent ?? '0').toBe(String(count));
  }
}, 120_000);
