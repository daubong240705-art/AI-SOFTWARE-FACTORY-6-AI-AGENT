import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveLeadId } from '../src/screens/projectChatLead.ts';

const projectId = 'new-web-games-project';

test('team Lead wins without any roster request', async () => {
  assert.equal(await resolveLeadId({}, projectId, 'lead-seat'), 'lead-seat');
});

test('missing team data falls back to the active Lead in the web-games agents roster', async () => {
  const api = { async listProjectAgents(project) {
    assert.equal(project, projectId);
    return { teams: [], agents: [
      { id: 'former-lead', isLead: true, status: 'paused' },
      { id: 'rules-engineer', isLead: false, status: 'active' },
      { id: 'game-lead', isLead: true, status: 'active' },
    ] };
  } };
  assert.equal(await resolveLeadId(api, projectId), 'game-lead');
});

test('team lead marker and unique project-wide delegation are fallback signals', async () => {
  const agents = ['game-lead', 'rules-engineer'].map(id => ({ id, status: 'active', isLead: false }));
  const api = {
    async listProjectAgents() { return { agents, teams: [{ leadAgentId: 'game-lead' }] }; },
  };
  assert.equal(await resolveLeadId(api, projectId), 'game-lead');
  const details = {
    async listProjectAgents() { return { agents, teams: [] }; },
    async getAgent(project, id) {
      assert.equal(project, projectId);
      return { id, config: { delegation: { canAssign: id === 'game-lead' ? 'project' : 'none' } } };
    },
  };
  assert.equal(await resolveLeadId(details, projectId), 'game-lead');
});
