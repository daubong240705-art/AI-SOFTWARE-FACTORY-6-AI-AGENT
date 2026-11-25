import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { agentMenu, approvalRow, createMenu, dialog, hook, libraryRow, navigateHash, openScreen, openTreeProject, screens, sidebar } from './screens.mjs';
import { createTask, waitForRun } from './seed.mjs';

const hidden = locator => locator.waitFor({ state: 'hidden' });
const step = (name, expected, run) => ({ name, expected, run });
const agentName = 'Agent kiểm thử CRUD';
const skillName = 'audit-crud-skill';
const templateName = 'Mẫu kiểm thử CRUD';
const secretName = 'Audit credential';
const connectionName = 'audit-local';

async function eventually(read, predicate = Boolean) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(250);
  }
  throw new Error('Expected state was not observed.');
}

async function connect(page, source, port, target) {
  const handle = (node, name) => hook(page, `flow-handle-${node}-${name}`);
  const from = await handle(source, port).boundingBox();
  const to = await handle(target, 'in').boundingBox();
  assert.ok(from && to, 'Both workflow handles must be visible.');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  try { await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 }); }
  finally { await page.mouse.up(); }
  await flowEdge(page, source, port, target).waitFor({ state: 'attached' });
}

const flowEdge = (page, source, port, target) => page.locator(`.react-flow__edge[aria-label="${source}:${port} → ${target}"]`);

function watchSecret(page, base, canaries) {
  let leaked = false;
  let unreadable = false;
  const pending = new Set();
  const includesCanary = text => canaries.some(value => text.includes(value));
  const listener = response => {
    if (!response.url().startsWith(`${base}/`)) return;
    const scan = (async () => {
      const headers = await response.allHeaders();
      leaked ||= includesCanary(JSON.stringify(headers));
      if (!['fetch', 'xhr', 'document'].includes(response.request().resourceType()) || /text\/event-stream/.test(headers['content-type'] ?? '') || [204, 304].includes(response.status()) || (response.status() >= 300 && response.status() < 400)) return;
      leaked ||= includesCanary(await response.text());
    })().catch(() => { unreadable = true; }).finally(() => pending.delete(scan));
    pending.add(scan);
  };
  page.on('response', listener);
  return {
    async verify() {
      const status = await page.evaluate(async () => (await fetch('/credentials', { cache: 'no-store' })).status);
      assert.equal(status, 200, 'Credential metadata could not be read.');
      await Promise.all(pending);
      const domLeak = await page.evaluate(values => {
        const html = document.documentElement.outerHTML;
        const inputs = [...document.querySelectorAll('input:not([type="password"]), textarea')];
        return values.some(value => html.includes(value) || inputs.some(input => input.value.includes(value)));
      }, canaries);
      assert.ok(!leaked && !domLeak, 'A credential value was exposed. Evidence withheld.');
      assert.ok(!unreadable, 'A same-origin response could not be checked for credential exposure.');
    },
    close: () => page.off('response', listener),
  };
}

function scenarios(page, fixture, base, endpoint, canaries) {
  const project = fixture.projects.primary;
  const api = fixture.api;
  const go = key => openScreen(page, screens.find(item => item.id === key), fixture, base);
  const byId = id => hook(page, id);
  const modal = () => dialog(page);
  const fill = (id, value) => hook(modal(), id).fill(value);
  const submit = async (id = 'dialog-save') => { await hook(modal(), id).click(); await hidden(modal()); };
  const cancel = () => hook(modal(), 'dialog-cancel').click();
  const agents = () => api.json(`/projects/${project}/agents`);
  const getAgent = id => api.json(`/projects/${project}/agents/${id}`);
  const library = () => api.json('/library');
  const credential = async () => (await api.json('/credentials')).credentials.find(item => item.name === secretName);
  const connection = async () => (await api.json('/integrations')).integrations.find(item => item.name === connectionName);
  const getGroup = id => api.json(`/groups/${id}`);
  const routeId = () => new URL(page.url()).hash.split('/').at(-1);
  let agentId, teamId, relationRevision, secretId, connectionId, parentId, childId, flowId, runId;
  let secretWatch;
  const agent = action => agentMenu(page, agentId, action);
  const team = action => hook(byId(`team-row-${teamId}`), `team-${action}`).click();
  const assets = (name, action) => async () => { await libraryRow(page, name).click(); await byId(action).click(); };
  const selectRelation = async (from, to, kind) => {
    const row = byId('relation-row').last();
    const endpoints = hook(row, 'relation-agent');
    await endpoints.first().selectOption(from); await endpoints.last().selectOption(to);
    await hook(row, 'relation-kind').selectOption(kind);
  };
  return [
    { id: 'agent', steps: [
      step('create', 'New agent appears in the project tree destination.', async () => {
        await go('overview'); await openTreeProject(page, project, [fixture.groups.parent, fixture.groups.child]);
        await byId('project-tab-agents').click(); await byId('agent-create').click();
        await fill('agent-name', agentName); await fill('agent-role', 'Kiểm thử'); await submit();
        agentId = (await eventually(async () => (await agents()).agents.find(item => item.name === agentName))).id;
        await byId(`agent-row-${agentId}`).waitFor();
      }),
      step('edit', 'Role change creates revision 2.', async () => {
        await agent('edit'); await fill('agent-role', 'Kiểm tra bản sửa'); await hook(modal(), 'dialog-save').click();
        await hidden(modal()); await eventually(() => getAgent(agentId), item => item.config.role === 'Kiểm tra bản sửa');
      }),
      step('history', 'Revision 1 can be selected.', async () => {
        await agent('edit'); await byId('agent-tab-history').click();
        await byId('agent-history-version').selectOption('1'); await byId('agent-rollback').waitFor();
      }),
      step('rollback', 'Rollback restores the original role as a new revision.', async () => {
        await byId('agent-rollback').click(); await eventually(() => getAgent(agentId), item => item.config.role === 'Kiểm thử'); await cancel();
      }),
      step('clone', 'A distinct agent appears.', async () => {
        await agent('clone'); await fill('agent-clone-name', 'Bản sao kiểm thử'); await submit();
        const clone = await eventually(async () => (await agents()).agents.find(item => item.name === 'Bản sao kiểm thử'));
        assert.notEqual(clone.id, agentId); await byId(`agent-row-${clone.id}`).waitFor();
      }),
      step('pause', 'The paused agent appears under the paused filter.', async () => {
        await agent('pause'); await byId('agent-status-filter').selectOption('paused'); await byId(`agent-row-${agentId}`).waitFor();
      }),
      step('archive', 'The archived agent retains its task history.', async () => {
        await createTask(api, project, { code: 'AU-101', title: 'Task giữ lịch sử agent', ownerSeatId: agentId });
        await agent('archive'); await submit(); await byId('agent-status-filter').selectOption('archived'); await byId(`agent-row-${agentId}`).waitFor();
      }),
      step('delete-refusal', 'Deletion is refused and the archived agent remains.', async () => {
        await agent('delete'); await hook(modal(), 'dialog-confirm').click(); await modal().getByRole('alert').waitFor();
        assert.equal((await agents()).agents.find(item => item.id === agentId)?.status, 'archived'); await cancel();
      }),
    ] },
    { id: 'team', steps: [
      step('create', 'New team appears.', async () => {
        await go('project-agents'); await byId('team-create').click(); await fill('team-name', 'Team kiểm thử'); await submit();
        teamId = (await eventually(async () => (await agents()).teams.find(item => item.name === 'Team kiểm thử'))).id;
        await byId(`team-row-${teamId}`).waitFor();
      }),
      step('edit', 'New name persists.', async () => {
        await team('edit'); await fill('team-name', 'Team đã sửa'); await submit();
        await eventually(agents, item => item.teams.some(entry => entry.id === teamId && entry.name === 'Team đã sửa'));
      }),
      step('delete', 'Deleted team is removed.', async () => { await team('delete'); await submit('dialog-confirm'); await hidden(byId(`team-row-${teamId}`)); }),
    ] },
    { id: 'relations', steps: [
      step('create', 'A manages relation is saved.', async () => {
        await go('project-agents'); await byId('relation-create').click();
        await selectRelation(fixture.agents.primary, fixture.agents.fresh, 'manages'); await byId('relation-save').click();
        ({ relationsRevision: relationRevision } = await eventually(agents, item => item.relations.some(relation => relation.from === fixture.agents.primary && relation.to === fixture.agents.fresh && relation.kind === 'manages')));
        await hidden(byId('relation-save').and(page.locator(':enabled')));
      }),
      step('cycle-refusal', 'A reverse edge is rejected and revision is unchanged.', async () => {
        await byId('relation-create').click(); await selectRelation(fixture.agents.fresh, fixture.agents.primary, 'manages');
        await byId('relation-save').click(); await byId('relation-panel').getByRole('alert').waitFor();
        assert.equal((await agents()).relationsRevision, relationRevision);
      }),
      step('edit-delete', 'The draft edge can be removed and the existing relation edited and deleted.', async () => {
        await go('project-agents');
        const row = byId('relation-row').filter({ has: byId('relation-kind').and(page.locator('select:has(option[value="manages"]:checked)')) });
        await hook(row, 'relation-kind').selectOption('approves'); await byId('relation-save').click();
        await eventually(agents, item => item.relationsRevision > relationRevision);
        await hidden(byId('relation-save').and(page.locator(':enabled')));
        const edited = byId('relation-row').filter({ has: page.locator('select:has(option[value="approves"]:checked)') });
        await hook(edited, 'relation-delete').click(); await byId('relation-save').click();
        await eventually(agents, item => !item.relations.some(relation => relation.from === fixture.agents.primary && relation.to === fixture.agents.fresh && relation.kind === 'approves'));
      }),
    ] },
    { id: 'skill', steps: [
      step('create', 'Skill starts at version 1.', async () => {
        await go('library'); await byId('skill-create').click(); await fill('skill-name', skillName); await fill('skill-description', 'Mô tả audit'); await fill('skill-content', '# Bản đầu'); await submit(); await libraryRow(page, skillName).waitFor();
        await eventually(library, item => item.skills.some(skill => skill.name === skillName && skill.latestVersion === 1));
      }),
      step('edit', 'Metadata edit does not create a content version.', async () => {
        await assets(skillName, 'skill-edit')(); await fill('skill-description', 'Mô tả đã sửa'); await submit();
        await eventually(library, item => item.skills.some(skill => skill.name === skillName && skill.description === 'Mô tả đã sửa' && skill.latestVersion === 1));
      }),
      step('new-version', 'Content edit creates version 2.', async () => {
        await byId('skill-edit').click(); await fill('skill-content', '# Bản thứ hai'); await submit();
        await eventually(library, item => item.skills.some(skill => skill.name === skillName && skill.latestVersion === 2));
      }),
      step('delete', 'Skill disappears.', async () => { await byId('skill-delete').click(); await submit('dialog-confirm'); await hidden(libraryRow(page, skillName)); }),
    ] },
    { id: 'template', steps: [
      step('create', 'Agent template appears.', async () => {
        await go('library-templates'); await byId('template-create').click(); await fill('agent-name', templateName); await fill('agent-role', 'Kiểm thử'); await submit(); await libraryRow(page, templateName).waitFor();
      }),
      step('edit', 'The new name appears.', async () => {
        await assets(templateName, 'template-edit')(); await fill('agent-name', 'Mẫu đã sửa'); await submit(); await libraryRow(page, 'Mẫu đã sửa').waitFor();
      }),
      step('delete', 'Agent template disappears.', async () => { await byId('template-delete').click(); await submit('dialog-confirm'); await hidden(libraryRow(page, 'Mẫu đã sửa')); }),
    ] },
    { id: 'secret', sensitive: true, close: () => secretWatch?.close(), steps: [
      step('create', 'Secret metadata appears without exposing the value.', async () => {
        await go('integration-secrets'); secretWatch = watchSecret(page, base, canaries);
        await byId('secret-create').click(); await fill('secret-name', secretName); await fill('secret-value', canaries[0]); await submit();
        secretId = (await eventually(credential)).id; await byId(`secret-row-${secretId}`).waitFor(); await secretWatch.verify();
      }),
      step('replace', 'Revision increases without exposing either value.', async () => {
        const { revision } = await credential();
        await hook(byId(`secret-row-${secretId}`), 'secret-replace').click(); await fill('secret-value', canaries[1]); await submit();
        await eventually(credential, item => item?.revision > revision); await secretWatch.verify();
      }),
      step('delete', 'Metadata disappears; neither value is disclosed.', async () => {
        await hook(byId(`secret-row-${secretId}`), 'secret-delete').click(); await fill('integration-confirm-name', secretName); await submit('dialog-confirm');
        await hidden(byId(`secret-row-${secretId}`)); await eventually(credential, item => !item); await secretWatch.verify();
      }),
    ] },
    { id: 'connection', steps: [
      step('create', 'An HTTP API connection appears.', async () => {
        await go('integrations'); await byId('connection-create').click(); await fill('connection-name', connectionName);
        await hook(modal(), 'connection-kind').selectOption('http-api'); await fill('connection-base-url', endpoint.url); await fill('connection-operation-name', 'probe'); await submit();
        connectionId = (await eventually(connection)).id; await byId(`connection-row-${connectionId}`).waitFor();
      }),
      step('test', 'The local fixture receives the probe and the connection becomes ready.', async () => {
        const before = endpoint.hits();
        await hook(byId(`connection-row-${connectionId}`), 'connection-test').click();
        await eventually(connection, item => item?.status === 'ready'); assert.ok(endpoint.hits() > before);
      }),
      step('delete', 'Connection disappears.', async () => {
        await hook(byId(`connection-row-${connectionId}`), 'connection-delete').click(); await fill('integration-confirm-name', connectionName);
        await submit('dialog-confirm'); await hidden(byId(`connection-row-${connectionId}`));
      }),
    ] },
    { id: 'group', steps: [
      step('create', 'New root group has its own page.', async () => {
        await go('overview'); await hook(await sidebar(page), 'sidebar-create').click(); await byId('group-create').click();
        await fill('group-name', 'Group kiểm thử'); await fill('group-slug', 'audit-crud'); await submit();
        await byId('group-tab-overview').waitFor(); parentId = routeId();
      }),
      step('child', 'Child appears at a nested path.', async () => {
        await byId('group-tab-children').click(); await byId('group-create-child').click();
        await fill('group-name', 'Group con'); await fill('group-slug', 'nested'); await submit();
        await page.waitForFunction(id => location.hash.startsWith('#/g/') && !location.hash.endsWith(`/${id}`), parentId);
        childId = routeId(); await byId('group-tab-settings').waitFor();
        assert.equal((await getGroup(childId)).group.parentId, parentId);
      }),
      step('settings-override', 'The child stores a model override.', async () => {
        await byId('group-tab-settings').click(); await byId('group-setting-defaultModel').fill('audit-model');
        await byId('group-settings-save').click(); await eventually(() => getGroup(childId), item => item?.settings.defaultModel === 'audit-model');
      }),
      step('move-project', 'Project can be found under the new group hierarchy.', async () => {
        const movingProject = fixture.projects.empty;
        const settings = screens.find(item => item.id === 'project-settings-group');
        await openScreen(page, { ...settings, project: 'empty' }, fixture, base); await byId('project-group-move').click();
        const item = id => hook(modal(), `tree-${id}`);
        await item(parentId).waitFor();
        if (await item(parentId).getAttribute('aria-expanded') === 'false') await item(parentId).locator(':scope > [data-testid="tree-open"] > [data-testid="tree-expand"]').click();
        await hook(item(childId), 'tree-open').click(); await submit();
        await eventually(() => api.json('/groups'), item => item.membership[movingProject] === childId);
        await openTreeProject(page, movingProject, [parentId, childId]); await byId('project-tab-overview').and(page.locator('[aria-selected="true"]')).waitFor();
      }),
      step('archive', 'Group with a child can be archived.', async () => {
        await navigateHash(page, base, `#/g/${parentId}`); await byId('group-archive').click(); await submit();
        await eventually(() => getGroup(parentId), item => item?.group.archived);
      }),
      step('delete-refusal', 'A parent with a child cannot be deleted.', async () => {
        await byId('group-delete').click(); await hook(modal(), 'group-delete-blockers').waitFor();
        assert.ok(await hook(modal(), 'dialog-confirm').isDisabled()); await cancel();
      }),
    ] },
    { id: 'workflow', steps: [
      step('create-blank', 'Trigger and Output are present.', async () => {
        await go('project-flows'); await byId('flow-create').click(); await fill('flow-title', 'Workflow kiểm thử'); await fill('flow-key', 'audit-ui-flow'); await submit('flow-submit');
        await byId('flow-save').waitFor(); flowId = routeId();
        await byId('flow-handle-trigger-out').waitFor(); await byId('flow-handle-output-in').waitFor();
      }),
      step('connect', 'Trigger → Agent → Approval → Output replaces the starter edge.', async () => {
        const direct = flowEdge(page, 'trigger', 'out', 'output');
        await direct.focus(); await page.keyboard.press('Enter'); await byId('flow-remove').click(); await hidden(direct);
        await byId('flow-add-agent').click(); await byId('flow-add-approval').click(); await byId('flow-field-prompt').fill('Duyệt lần kiểm thử');
        await connect(page, 'trigger', 'out', 'agent'); await connect(page, 'agent', 'out', 'approval'); await connect(page, 'approval', 'approved', 'output');
        await byId('flow-auto-layout').click();
      }),
      step('save-draft', 'Draft stores all three edges.', async () => {
        await byId('flow-save').click();
        await eventually(() => api.json(`/projects/${project}/flows/${flowId}`), item => item.draft.edges.length === 3 && item.draft.nodes.some(node => node.type === 'agent'));
        await hidden(byId('flow-save').and(page.locator(':enabled')));
      }),
      step('publish', 'Published run control is enabled.', async () => {
        await byId('flow-publish').click(); await byId('flow-run').and(page.locator(':enabled')).waitFor();
      }),
      step('test-run', 'Mock-agent test run reaches an approval.', async () => {
        await byId('flow-test-run').click(); await hook(modal(), 'flow-toggle').check(); await submit('flow-start-run');
        await byId('flow-run-detail').waitFor(); runId = routeId();
        await waitForRun(api, project, runId, item => item.run.flowId === flowId && item.nodeRuns.some(node => node.approvalId));
      }),
      step('approve', 'Approval is confirmed in Attention.', async () => {
        const run = await waitForRun(api, project, runId, item => item.nodeRuns.some(node => node.approvalId));
        const row = approvalRow(page, run.nodeRuns.find(node => node.approvalId).approvalId);
        await go('attention'); await row.click();
        await byId('attention-option-approve').click();
        await byId('attention-approve').click(); await byId('attention-confirm').click(); await hidden(row);
      }),
      step('succeeded', 'The approved run reaches succeeded.', async () => {
        await waitForRun(api, project, runId, item => item.run.state === 'succeeded');
        await go('project-flows'); await byId(`flow-run-row-${runId}`).click(); await byId('flow-run-detail').waitFor();
      }),
    ] },
    { id: 'task', steps: [
      step('create', 'Task created via the project menu appears on the board.', async () => {
        await go('project-board'); await createMenu(page, 'task-create');
        const title = 'Task kiểm thử CRUD';
        await byId('task-title').fill(title); await byId('task-goal').fill('Kiểm tra bảng việc'); await byId('task-acceptance').fill('Xuất hiện trên bảng');
        await byId('task-save').click(); await hidden(byId('task-title'));
        const task = await eventually(async () => (await api.json(`/projects/${project}/tasks`)).items.find(item => item.title === title));
        await page.locator(`[data-task-id="${task.id}"]`).waitFor();
      }),
    ] },
  ];
}

export async function runCrudFlows({ page, fixture, base, endpoint, canaries, results, screenshot, safeText }) {
  for (const scenario of scenarios(page, fixture, base, endpoint, canaries)) {
    let blocked = false;
    try {
      for (const item of scenario.steps) {
        const result = { flow: scenario.id, name: item.name, expected: item.expected, status: blocked ? 'SKIP' : 'PASS' };
        results.push(result);
        if (blocked) continue;
        try { await item.run(); }
        catch (error) {
          blocked = true; result.status = 'FAIL';
          result.error = scenario.sensitive && !/^A (credential|same-origin)/.test(error.message) ? 'Credential check failed; details and screenshot withheld.' : safeText(error.message);
          if (!scenario.sensitive) {
            try { result.file = await screenshot(`crud-${scenario.id}-${item.name}-1280-light.png`); }
            catch (captureError) { result.error += ` · Screenshot unavailable: ${safeText(captureError.message)}`; }
          }
        }
      }
    } finally {
      scenario.close?.();
      if (blocked) await page.goto('about:blank');
    }
  }
}
