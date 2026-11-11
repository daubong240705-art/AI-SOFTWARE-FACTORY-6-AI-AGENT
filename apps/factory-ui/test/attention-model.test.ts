import { expect, it } from 'vitest';
import { attentionItems } from '../src/screens/shell/attention';
import { allKinds, kindMix } from './attention-fixtures';
import { review } from './inbox-fixtures';
import { id, otherId } from './fixtures';

it('orders actionable expiry first, then age, then a deterministic key; read-only rows follow', () => {
  const inbox = { ...allKinds, approvals: [
    { ...review, id: otherId, requestedAt: '2026-11-09T00:00:00.000Z', expiresAt: '2099-11-15T00:00:00.000Z' },
    { ...review, id, requestedAt: '2026-11-10T00:00:00.000Z', expiresAt: '2099-11-14T00:00:00.000Z' },
  ] };
  const rows = attentionItems(inbox);
  expect(rows.map(row => row.kind)).toEqual(['review', 'review', 'plan-patch', 'request', 'start-gate', 'team-breaker', 'integration-conflict', 'monitor', 'quarantined-rule', 'stalled-workflow']);
  expect(rows.slice(0, 2).map(row => row.key)).toEqual([`approval:${id}`, `approval:${otherId}`]);
  const reverse = { ...inbox, approvals: [...inbox.approvals].reverse() };
  expect(attentionItems(reverse)).toEqual(rows);
  const tied = { ...inbox, approvals: [{ ...review, id: otherId }, { ...review, id }] };
  expect(attentionItems(tied).slice(0, 2).map(row => row.key)).toEqual([`approval:${id}`, `approval:${otherId}`]);
  tied.approvals[0] = { ...review, id: otherId, requestedAt: '2026-11-06T00:00:00.000Z' };
  expect(attentionItems(tied)[0]?.key).toBe(`approval:${otherId}`);
});

it('includes every row exactly once for all 1,024 kind combinations without trusting stale counts', () => {
  for (let mask = 0; mask < 1024; mask++) {
    const inbox = kindMix(mask); const rows = attentionItems(inbox);
    const expected = mask.toString(2).replaceAll('0', '').length;
    expect(rows, `mask ${mask}`).toHaveLength(expected);
    expect(new Set(rows.map(row => row.key)).size).toBe(expected);
    expect(rows.every(row => row.projectId === id && row.projectName === 'Project')).toBe(true);
    expect(rows.filter(row => row.actionable)).toHaveLength((mask & 31).toString(2).replaceAll('0', '').length);
  }
});
