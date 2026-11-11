import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectSchema } from '@factory/contracts';
import { m5ReadModels } from '../src/api/readModels';
import { ApiClientError } from '../src/api/client';
import { ProjectView } from '../src/screens/ProjectView';
import type { Store } from '../src/state/store';
import { envelope, id, otherId, project } from './fixtures';
import { breakers, healthyMonitor, rule, schedule, unhealthyMonitor, workflow, workflowDetail } from './m5-fixtures';
import { useEnglish } from './setup';
import { setupUI } from './ui-fixtures';

const stores: Store[] = [];
beforeEach(useEnglish);
afterEach(() => { cleanup(); stores.splice(0).forEach(store => store.dispose()); });

async function page(tab: 'workflow' | 'automation', configure?: (fixture: ReturnType<typeof setupUI>) => void) {
  history.replaceState(null, '', `#/project/${id}/${tab}`);
  const fixture = setupUI(); stores.push(fixture.store);
  configure?.(fixture);
  await fixture.store.boot(); await fixture.store.selectProject(id);
  render(<ProjectView store={fixture.store} project={projectSchema.parse(project)} />);
  await act(async () => {});
  return fixture;
}

describe('M5 read models', () => {
  it('treats missing arrays as empty and ignores extra fields', () => {
    expect(m5ReadModels.workflows.parse({ extra: 1 }).instances).toEqual([]);
    expect(m5ReadModels.breakers.parse({}).routes).toEqual([]);
    expect(m5ReadModels.schedules.parse({ ...envelope }).items).toEqual([]);
    expect(m5ReadModels.workflows.parse({ instances: [{ ...workflow, surprise: true }] }).instances[0]).not.toHaveProperty('surprise');
  });
  it('drops one malformed item without losing the others', () => {
    const parsed = m5ReadModels.monitors.parse({ ...envelope, items: [{ nonsense: true }, healthyMonitor] });
    expect(parsed.items.map(item => item.name)).toEqual(['Disk space']);
  });
  it('falls back to unknown for a state the UI does not know', () => {
    expect(m5ReadModels.workflows.parse({ instances: [{ ...workflow, state: 'brand-new' }] }).instances[0]?.state).toBe('unknown');
  });
});

describe('project tabs', () => {
  it('lists six tabs and the hash selects Workflow and Automation', async () => {
    await page('workflow');
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Overview', 'Board', 'Workflow', 'Automation', 'Knowledge', 'Settings']);
    expect(screen.getByRole('tab', { name: 'Workflow' }).getAttribute('aria-selected')).toBe('true');
    cleanup(); stores.splice(0).forEach(store => store.dispose());
    await page('automation');
    expect(screen.getByRole('tab', { name: 'Automation' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('Workflow tab', () => {
  it('shows an empty sentence and no command buttons', async () => {
    await page('workflow');
    expect(screen.getByText('No workflow instances yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve|reject|start|cancel/i })).toBeNull();
  });
  it('lists instances with one status word and opens the stage detail on click', async () => {
    const fixture = await page('workflow', ({ api }) => {
      api.listWorkflows.mockResolvedValue({ instances: [workflow] });
      api.getWorkflow.mockResolvedValue({ instance: workflowDetail });
    });
    const list = screen.getByRole('region', { name: 'Workflow instances' });
    fireEvent.click(within(list).getByRole('button', { name: /Ship release/ }));
    await act(async () => {});
    expect(fixture.api.getWorkflow).toHaveBeenCalledWith(id, workflow.id);
    const stages = screen.getByRole('list', { name: /stages/i });
    expect(within(stages).getAllByRole('listitem')).toHaveLength(2);
    expect(within(stages).getByText('UI-001')).toBeTruthy();
    expect(within(stages).getByText('UI-002')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('list', { name: /stages/i })).toBeNull();
  });
  it('shows an error notice with a retry that reloads', async () => {
    const fixture = await page('workflow', ({ api }) => { api.listWorkflows.mockRejectedValue(new ApiClientError('network', 0, undefined)); });
    expect(screen.getByRole('alert')).toBeTruthy();
    fixture.api.listWorkflows.mockResolvedValue({ instances: [workflow] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await act(async () => {});
    expect(screen.getByText('Ship release')).toBeTruthy();
  });
});

describe('Automation tab', () => {
  it('shows empty sentences for schedules, rules and monitors and hides the breakers section', async () => {
    await page('automation');
    expect(screen.getByRole('heading', { name: 'Schedules' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Rules' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Monitors' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Breakers' })).toBeNull();
  });
  it('shows quarantined items with a word, unhealthy monitors first, and open breakers', async () => {
    await page('automation', ({ api }) => {
      api.listSchedules.mockResolvedValue({ ...envelope, items: [schedule] });
      api.listRules.mockResolvedValue({ ...envelope, items: [rule] });
      api.listMonitors.mockResolvedValue({ ...envelope, items: [healthyMonitor, unhealthyMonitor] });
      api.listBreakers.mockResolvedValue(breakers);
    });
    expect(screen.getByText('Daily release')).toBeTruthy();
    expect(screen.getByText('On completed task')).toBeTruthy();
    expect(screen.getAllByText(/quarantined/i).length).toBeGreaterThanOrEqual(2);
    const monitors = screen.getByRole('heading', { name: 'Monitors' }).closest('section')!;
    const names = within(monitors).getAllByRole('listitem').map(row => row.querySelector('strong')?.textContent);
    expect(names).toEqual(['Approval age', 'Disk space']);
    expect(screen.getByRole('heading', { name: 'Breakers' })).toBeTruthy();
    expect(screen.getByText('api/route')).toBeTruthy();
  });
  it('keeps technical identifiers inside a collapsed disclosure', async () => {
    await page('automation', ({ api }) => { api.listMonitors.mockResolvedValue({ ...envelope, items: [healthyMonitor] }); });
    const details = screen.getAllByText('Technical details')[0]!.closest('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain(healthyMonitor.id);
    expect(otherId).not.toBe(id);
  });
});
