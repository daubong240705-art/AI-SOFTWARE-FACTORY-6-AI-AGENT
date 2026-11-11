import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectSchema } from '@factory/contracts';
import { ApiClientError, createApiClient } from '../src/api/client';
import { settingsReadModels } from '../src/api/settingsModels';
import { ProjectView } from '../src/screens/ProjectView';
import { projectTab, viewHash } from '../src/screens/shell/navigation';
import type { Store } from '../src/state/store';
import { autonomy, settingsBudget, standingApproval, standingApprovals } from './settings-fixtures';
import { deferred, envelope, id, otherId, project, response } from './fixtures';
import { setupUI } from './ui-fixtures';
import { useEnglish } from './setup';

const stores: Store[] = [];
beforeEach(useEnglish);
afterEach(() => { cleanup(); stores.splice(0).forEach(store => store.dispose()); });

async function page(configure?: (fixture: ReturnType<typeof setupUI>) => void) {
  history.replaceState(null, '', `#/project/${id}/settings`);
  const fixture = setupUI(); stores.push(fixture.store);
  fixture.api.getBudget.mockResolvedValue({ ...envelope, budget: settingsBudget });
  fixture.api.getAutonomy.mockResolvedValue(autonomy);
  fixture.api.listStandingApprovals.mockResolvedValue(standingApprovals);
  configure?.(fixture);
  await fixture.store.boot(); await fixture.store.selectProject(id);
  const rendered = render(<ProjectView store={fixture.store} project={projectSchema.parse(project)} />);
  await act(async () => {});
  return { ...fixture, ...rendered };
}

describe('Settings read models', () => {
  it('defaults missing arrays and strips extra fields', () => {
    const { teams: _teams, ...withoutTeams } = autonomy;
    expect(settingsReadModels.autonomy.parse({ ...withoutTeams, extra: true }).teams).toEqual([]);
    expect(settingsReadModels.autonomy.parse({ ...autonomy, extra: true })).not.toHaveProperty('extra');
    expect(settingsReadModels.standingApprovals.parse({ level: standingApprovals.level }).items).toEqual([]);
    expect(settingsReadModels.standingApprovals.parse({ ...standingApprovals, extra: true })).not.toHaveProperty('extra');
  });
  it('drops malformed rows while preserving good rows', () => {
    expect(settingsReadModels.autonomy.parse({ ...autonomy, teams: [{ broken: true }, autonomy.teams[0]] }).teams).toEqual([autonomy.teams[0]]);
    const result = settingsReadModels.standingApprovals.parse({ ...standingApprovals, items: [{ broken: true }, standingApproval, { ...standingApproval, expiresAt: 'bad-date' }] });
    expect(result.items.map(item => item.id)).toEqual([id]);
  });
  it('degrades unknown levels, sources, states, actions and scopes', () => {
    const parsed = settingsReadModels.standingApprovals.parse({ ...standingApprovals, items: [{ ...standingApproval, state: 'new', actionKind: 'new', scope: { kind: 'new', ref: id } }] });
    expect(parsed.items[0]).toMatchObject({ state: 'unknown', actionKind: 'unknown', scope: { kind: 'unknown' } });
    expect(settingsReadModels.autonomy.parse({ ...autonomy, project: { level: 9, source: 'new' } }).project).toMatchObject({ level: 'unknown', source: 'unknown', revision: null });
  });
  it('uses project-scoped GET endpoints with tolerant schemas', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(autonomy)).mockResolvedValueOnce(response(standingApprovals));
    const client = createApiClient({ fetchImpl: fetcher });
    expect(await client.getAutonomy(id)).toEqual(autonomy);
    expect(await client.listStandingApprovals(id)).toEqual(standingApprovals);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([`/projects/${id}/autonomy`, `/projects/${id}/standing-approvals`]);
    expect(fetcher.mock.calls.every(call => call[1].method === 'GET')).toBe(true);
  });
});

describe('Settings tab', () => {
  it('shows the budget meter, verdict words, no project limit and tasks in urgency order', async () => {
    const { api } = await page();
    const section = screen.getByRole('region', { name: 'Budget' });
    const meter = within(section).getByRole('meter', { name: 'Today' });
    expect(meter.getAttribute('value')).toBe('920'); expect(meter.getAttribute('max')).toBe('1000');
    expect(within(section).getByText('No project limit')).toBeTruthy();
    expect(within(section).getAllByText('Near limit')).toHaveLength(2);
    expect(within(section).getAllByText('Limit reached')).toHaveLength(2);
    expect(within(section).getByText('Within limit')).toBeTruthy();
    const rows = within(section).getAllByRole('row').slice(1);
    expect(rows.map(row => within(row).getByRole('rowheader').textContent)).toEqual(['UI-003', 'UI-002', 'UI-001']);
    expect(within(section).getByText('Team engagement')).toBeTruthy();
    expect(api.getBudget).toHaveBeenCalledOnce();
  });
  it('shows a limited project budget and clamps an exceeded day meter', async () => {
    await page(({ api }) => api.getBudget.mockResolvedValue({ ...envelope, budget: { ...settingsBudget, day: { ...settingsBudget.day, used: 1200, verdict: 'exceeded' }, project: { ...settingsBudget.project, used: 2800, limit: 3000, verdict: 'warn' } } }));
    expect(screen.getByRole('meter').getAttribute('value')).toBe('1000');
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toBe('1,200 / 1,000 tokens');
    expect(screen.getByText('2,800 / 3,000 tokens')).toBeTruthy();
    expect(screen.queryByText('No project limit')).toBeNull();
  });
  it.each(['explicit', 'default'] as const)('shows the project %s source and the capped effective team level', async source => {
    await page(({ api }) => api.getAutonomy.mockResolvedValue({ ...autonomy, project: { ...autonomy.project, source } }));
    const section = screen.getByRole('region', { name: 'Autonomy' });
    expect(within(section).getByText('Level 3')).toBeTruthy();
    expect(within(section).getByText(source === 'explicit' ? 'Set explicitly' : 'Using the default')).toBeTruthy();
    const teams = within(section).getAllByRole('listitem');
    expect(teams[0]?.textContent).toContain('Take external actions under standing approval. (L4)');
    expect(teams[0]?.textContent).toContain('Effective level (capped by project): Coordinate across teams within budget. (L3)');
    expect(teams[0]?.querySelector('strong')?.textContent).toBe('Team');
    expect(teams[1]?.querySelector('strong')?.textContent).toBe('Team');
  });
  it('omits the effective level when it equals the team level', async () => {
    await page(({ api }) => api.getAutonomy.mockResolvedValue({ ...autonomy, teams: autonomy.teams.map(team => ({ ...team, level: team.effectiveLevel })) }));
    const section = screen.getByRole('region', { name: 'Autonomy' });
    expect(within(section).queryByText(/Effective level/)).toBeNull();
  });
  it('shows active approvals first and collapses revoked and expired entries', async () => {
    await page(); const section = screen.getByRole('region', { name: 'Standing approvals' });
    expect(within(section.querySelector('ul.settings-list')!).getAllByRole('listitem')).toHaveLength(1);
    expect(within(section).getByText('Active')).toBeTruthy();
    expect(within(section.querySelector('ul.settings-list')!).getByText('3 / 10 uses today')).toBeTruthy();
    expect(within(section.querySelector('ul.settings-list')!).getByText(/^Expires /).getAttribute('datetime')).toBe(standingApproval.expiresAt);
    const details = within(section).getByText('Revoked and expired approvals').closest('details')!;
    expect(details.open).toBe(false);
    fireEvent.click(within(section).getByText('Revoked and expired approvals'));
    expect(within(section).getAllByRole('listitem')).toHaveLength(3);
    expect(within(section).getByText('Revoked')).toBeTruthy(); expect(within(section).getByText('Expired')).toBeTruthy();
  });
  it('shows unknown approvals visibly with human fallbacks and identifiers collapsed', async () => {
    await page(({ api }) => api.listStandingApprovals.mockResolvedValue(settingsReadModels.standingApprovals.parse({ ...standingApprovals, items: [{ ...standingApproval, state: 'new', actionKind: 'new', scope: { kind: 'new', ref: otherId } }] })));
    const section = screen.getByRole('region', { name: 'Standing approvals' });
    expect(within(section).getByText('Unknown action')).toBeTruthy(); expect(within(section).getByText('Unknown')).toBeTruthy();
    expect(within(section).getByText('Unknown scope')).toBeTruthy();
    const details = within(section).getByText('Technical details').closest('details')!;
    expect(details.open).toBe(false); expect(details.textContent).toContain(otherId);
  });
  it('shows one short sentence for an empty approval list', async () => {
    await page(({ api }) => api.listStandingApprovals.mockResolvedValue({ items: [], level: standingApprovals.level }));
    const section = screen.getByRole('region', { name: 'Standing approvals' });
    expect(within(section).getByText('No standing approvals.')).toBeTruthy(); expect(within(section).queryByRole('list')).toBeNull();
  });
  it('selects Settings from the hash and supports roving tab focus and wrapping', async () => {
    await page(); const settings = screen.getByRole('tab', { name: 'Settings' }); const overview = screen.getByRole('tab', { name: 'Overview' });
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Overview', 'Board', 'Workflow', 'Automation', 'Knowledge', 'Settings']);
    expect(settings.tabIndex).toBe(0); expect(settings.getAttribute('aria-selected')).toBe('true');
    expect(projectTab(location.hash)).toBe('settings'); expect(viewHash(`project:${id}`, 'settings')).toBe(location.hash);
    fireEvent.keyDown(settings, { key: 'ArrowRight' }); expect(document.activeElement).toBe(overview);
    fireEvent.keyDown(overview, { key: 'ArrowLeft' }); await act(async () => {});
    expect(document.activeElement).toBe(settings); expect(location.hash).toBe(`#/project/${id}/settings`);
    fireEvent.keyDown(settings, { key: 'Home' }); expect(document.activeElement).toBe(overview);
    fireEvent.keyDown(overview, { key: 'End' }); await act(async () => {}); expect(document.activeElement).toBe(settings);
  });
  it('shows independent loading states without empty text and disables refresh', async () => {
    const pendingAutonomy = deferred<unknown>(); const pendingApprovals = deferred<unknown>();
    await page(({ api }) => { api.getAutonomy.mockReturnValue(pendingAutonomy.promise); api.listStandingApprovals.mockReturnValue(pendingApprovals.promise); });
    expect(screen.getAllByRole('status')).toHaveLength(2); expect(screen.queryByText('No standing approvals.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh' }).hasAttribute('disabled')).toBe(true);
    await act(async () => { pendingAutonomy.resolve(autonomy); pendingApprovals.resolve(standingApprovals); });
    expect(screen.queryByRole('status')).toBeNull(); expect(screen.getByRole('button', { name: 'Refresh' }).hasAttribute('disabled')).toBe(false);
  });
  it.each(['autonomy', 'standingApprovals'] as const)('retries an independent %s read error', async area => {
    const fixture = await page(({ api }) => (area === 'autonomy' ? api.getAutonomy : api.listStandingApprovals).mockRejectedValue(new ApiClientError('network')));
    const section = screen.getByRole('region', { name: area === 'autonomy' ? 'Autonomy' : 'Standing approvals' });
    expect(within(section).getByRole('alert')).toBeTruthy(); expect(within(section).queryByText('No standing approvals.')).toBeNull();
    fixture.api.getAutonomy.mockResolvedValue(autonomy); fixture.api.listStandingApprovals.mockResolvedValue(standingApprovals);
    fireEvent.click(within(section).getByRole('button', { name: 'Retry' })); await act(async () => {});
    expect(within(section).queryByRole('alert')).toBeNull();
  });
  it('refreshes reads on opening and reopening without refetching budget or sending commands', async () => {
    const { api } = await page(); const panel = screen.getByRole('tabpanel');
    expect(within(panel).getAllByRole('button').map(button => button.textContent)).toEqual(['Refresh']);
    fireEvent.click(within(panel).getByRole('button', { name: 'Refresh' })); await act(async () => {});
    expect(api.getAutonomy).toHaveBeenCalledTimes(2); expect(api.listStandingApprovals).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' })); fireEvent.click(screen.getByRole('tab', { name: 'Settings' })); await act(async () => {});
    expect(api.getAutonomy).toHaveBeenCalledTimes(3); expect(api.listStandingApprovals).toHaveBeenCalledTimes(3);
    expect(api.getBudget).toHaveBeenCalledOnce(); expect(api.sendCommand).not.toHaveBeenCalled();
  });
});
