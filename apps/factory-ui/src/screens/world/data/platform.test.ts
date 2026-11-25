import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentSummary, FlowRunDetail, FlowRunSummary, GroupSummary, Project, Task } from '@factory/contracts';
import type { Interaction, Office } from '../../../api/officeModels';
import { desksFor, nodeProgress, type ProjectAttempt } from '../../office/liveModel';
import { deriveWorld, projectBuildings } from './deriveWorld';
import { diffWorld, createWorldSeen } from './events';
import { agentStation, campusFootprints, deskFloorNorth, roomDesk, roomDestination, studioMeeting } from '../layout/campus';
import { studioNavigation } from '../layout/studioNavigation';
import { intersectsFootprint } from '../layout/waypoints';
import { resolveWalkMove } from '../scene/walk/collision';
import type { WorldInputs } from './types';

const now = new Date(2026, 10, 25, 16).toISOString();
const project = (id: string, disposition: Project['disposition'] = 'active'): Project => ({ id, name: id, revision: 1, disposition, leadAgentId: null, groupId: null, workspace: { kind: 'directory', root: '/projects' } });
const agent = (id: string, extra: Partial<AgentSummary> = {}): AgentSummary => ({ id, projectId: 'first', name: id, role: 'research', revision: 1, configRevision: 1, status: 'active', isLead: false, adapter: 'codex', model: 'test', teamIds: [], template: null, live: 0, ...extra });
const task = (id: string, state: Task['state'], ownerSeatId: string): Task => ({ id, projectId: 'first', revision: 1, code: 'TASK-001', title: id, goal: 'test', brief: '', parentTaskId: null, engagementId: null, ownerSeatId, origin: { kind: 'operator' }, state, holds: [], disposition: 'active', requiredCapabilities: [], placement: 'portable', sideEffect: 'none', reviewPolicy: 'automatic', gate: { requiresGo: false }, acceptance: [], inputs: [], dependsOn: [] });
const attempt = (id: string, taskId: string, seatId: string, state: ProjectAttempt['state'] = 'running'): ProjectAttempt => ({ id, taskId, taskCode: 'TASK-001', taskTitle: taskId, epoch: 1, revision: 1, runtime: 'fake', outcome: 'known', seatId, seatName: seatId, state, startedAt: now, endedAt: null });
const group = (id: string, parentId: string | null): GroupSummary => ({ id, parentId, revision: 1, slug: id, name: id, path: parentId ? `${parentId}/${id}` : id, description: '', depth: parentId ? 2 : 1, archived: false, projectCount: 0, updatedAt: now });
const inputs = (): WorldInputs => ({ projects: [project('first'), project('second'), project('archived', 'archived')], serverNow: now, interactions: {}, tasks: {}, rosters: {
  first: { agents: [agent('one'), agent('two')], teams: [], relations: [], relationsRevision: 0 },
  second: { agents: [agent('three', { projectId: 'second' })], teams: [], relations: [], relationsRevision: 0 },
} });
const handoff = (id: string, at = now): Interaction => ({ id, at, kind: 'handoff', from: { kind: 'seat', seatId: 'one', name: 'One' }, to: { kind: 'seat', seatId: 'two', name: 'Two' }, taskId: 'task', code: 'TASK-001', text: '<b>literal</b>' });
const interactions = (items: Interaction[]): Office => ({ apiVersion: 1, ok: true, generatedAt: now, seats: [], items });

test('Office orders the lead, teams, then names and projects status from real work', () => {
  const desks = desksFor({ agents: [agent('idle'), agent('lead', { isLead: true }), agent('review', { teamIds: ['beta'] }), agent('failed', { teamIds: ['alpha'] }), agent('paused', { status: 'paused' }), agent('hidden', { status: 'archived' })],
    teams: [{ id: 'beta', name: 'Beta', projectId: 'first', revision: 1, memberIds: ['review'], description: '', leadAgentId: null }, { id: 'alpha', name: 'Alpha', projectId: 'first', revision: 1, memberIds: ['failed'], description: '', leadAgentId: null }], relations: [], relationsRevision: 0 },
  [task('work', 'active', 'lead'), task('check', 'in-review', 'review'), task('try', 'failed', 'failed')], [attempt('run', 'work', 'lead')], undefined, undefined, Date.parse(now));
  assert.deepEqual(desks.map(desk => [desk.agent.id, desk.status]), [['lead', 'working'], ['failed', 'problem'], ['review', 'waiting'], ['idle', 'idle'], ['paused', 'paused']]);
  assert.equal(desks[0]?.today.length, 1);
  assert.equal(desks[2]?.task?.id, 'check');
});

test('each project owns one character per active agent and multiple attempts stay with that character', () => {
  const state = inputs();
  state.attempts = { first: [attempt('first-run', 'task', 'one'), attempt('other-run', 'other', 'one')] };
  const { model, assign } = deriveWorld(state);
  assert.deepEqual(model.projects.map(item => item.id), ['first', 'second']);
  assert.deepEqual(model.agents.map(item => [item.seatId, item.projectId, item.runs.length]), [['one', 'first', 2], ['two', 'first', 0], ['three', 'second', 0]]);
  assert.deepEqual(deriveWorld(state, assign).assign, assign);
  assert.notDeepEqual(roomDesk(model.agents[0]!).position, roomDesk(model.agents[2]!).position);
  assert.equal(model.agents[0]!.projectColor, model.agents[1]!.projectColor);
  assert.notEqual(model.agents[0]!.projectColor, model.agents[2]!.projectColor);
});

test('project ancestry remains available for the project picker', () => {
  const buildings = projectBuildings([project('first'), project('second'), project('archived', 'archived')], { groups: [group('root', null), group('child', 'root')], membership: { first: 'child' } });
  assert.deepEqual(buildings.map(item => [item.name, item.rooms.map(room => room.id)]), [['root', ['first']], [null, ['second']]]);
});

test('first exchange read does not replay old handoffs; new real exchanges are emitted once', () => {
  const state = inputs(); state.interactions.first = interactions([handoff('old')]);
  const initial = deriveWorld(state).model;
  const first = diffWorld(null, initial, createWorldSeen(Date.parse(now)), now);
  assert.equal(first.events.length, 0);
  state.interactions.first.items.push(handoff('new'), handoff('stale', new Date(Date.parse(now) - 100_000).toISOString()));
  const next = deriveWorld(state).model;
  const second = diffWorld(initial, next, first.seen, now);
  assert.deepEqual(second.events.map(event => event.id), ['handoff:first:new']);
  assert.equal(next.handoffs.find(item => item.id.endsWith(':new'))?.taskId, 'task');
  assert.deepEqual(diffWorld(next, next, second.seen, now).events, []);
});

test('workflow progress counts latest node iterations and excludes terminal runs', () => {
  const run: FlowRunSummary = { id: 'run', projectId: 'first', flowId: 'flow', flowTitle: 'Work', version: 1, test: false, state: 'running', stateReason: null, revision: 1, trigger: 'manual', createdAt: now, startedAt: now, endedAt: null };
  const detail = { run, definition: { nodes: [{ id: 'work', title: 'Work' }, { id: 'done', title: 'Done' }] }, nodeRuns: [
    { nodeId: 'work', iteration: 1, attemptNo: 1, state: 'succeeded' }, { nodeId: 'work', iteration: 2, attemptNo: 1, state: 'running' }, { nodeId: 'done', iteration: 1, attemptNo: 1, state: 'skipped' },
  ] } as FlowRunDetail;
  assert.deepEqual(nodeProgress(detail), { complete: 1, total: 2, active: ['Work'] });
  const state = inputs(); state.flows = { first: { ok: true, apiVersion: 1, flows: [], runs: [run, { ...run, id: 'finished', state: 'succeeded' }] } }; state.runDetails = { run: detail };
  assert.deepEqual(deriveWorld(state).model.workflows.map(item => item.run.id), ['run']);
});

test('idle agents stay seated; working workflow agents can visit the board or meeting table', () => {
  const state = inputs();
  const run: FlowRunSummary = { id: 'run', projectId: 'first', flowId: 'flow', flowTitle: 'Work', version: 1, test: false, state: 'running', stateReason: null, revision: 1, trigger: 'manual', createdAt: now, startedAt: now, endedAt: null };
  state.tasks.first = [task('work', 'ready', 'one'), task('review', 'in-review', 'two')];
  state.flows = { first: { ok: true, apiVersion: 1, flows: [], runs: [run] } };
  state.runDetails = { run: { run, inputs: {}, definition: { schema: 2, key: 'work', title: 'Work', description: '', inputs: [], nodes: [], edges: [], settings: { concurrency: 'allow' }, layout: {} },
    nodeRuns: [{ nodeId: 'node', taskId: 'work', iteration: 1, attemptNo: 1, state: 'ready', port: null, startedAt: null, endedAt: null, error: null, approvalId: null, childRunId: null, output: null, pinned: false }] } };
  assert.deepEqual(deriveWorld(state).model.agents.map(item => agentStation(item, Date.parse(now))), ['desk', 'desk', 'desk']);
  state.attempts = { first: [attempt('start', 'work', 'one')] };
  assert.equal(agentStation(deriveWorld(state).model.agents[0]!, Date.parse(now)), 'board');
  state.interactions.first = interactions([handoff('handoff')]);
  assert.deepEqual(deriveWorld(state).model.agents.map(item => agentStation(item, Date.parse(now))), ['meeting', 'desk', 'desk']);
  assert.equal(agentStation(deriveWorld(state).model.agents[0]!, Date.parse(now) + 30000), 'board');
});

test('walk mode crosses into the desk area, clamps at the exterior, and respects studio furniture', () => {
  const model = deriveWorld(inputs()).model;
  const { floorSouth } = model;
  const crossing = resolveWalkMove({ x: 0, z: 12 }, { x: 0, z: floorSouth }, .35, [], floorSouth);
  assert.equal(crossing.z, floorSouth - .35);
  const [x, z] = studioMeeting;
  const step = resolveWalkMove({ x, z: z - 3 }, { x: 0, z: 3 }, .35, campusFootprints(0), floorSouth);
  assert.ok(step.z <= z - 1.65);
});

test('65+ agents share one floor with a clear tile route from every desk to both stations', () => {
  const state = inputs();
  state.rosters!.first!.agents = Array.from({ length: 65 }, (_, index) => agent(`staff-${index}`));
  const { model } = deriveWorld(state);
  const staff = model.agents.filter(item => item.projectId === 'first');
  assert.equal(staff.filter(item => !item.overflow).length, 65);
  assert.equal(new Set(model.agents.map(item => roomDesk(item).position.join(','))).size, 66);
  assert.ok(model.floorSouth > deriveWorld(inputs()).model.floorSouth);
  const furniture = campusFootprints(model.agents.length);
  const route = studioNavigation(model.floorSouth, furniture);
  for (const item of model.agents) for (const station of ['meeting', 'board'] as const) {
    const desk = roomDestination(item, 'desk'), destination = roomDestination(item, station);
    const path = route(desk, destination);
    assert.deepEqual(path[0], desk, item.seatId);
    assert.deepEqual(path.at(-1), destination);
    for (const [index, [x, , z]] of path.entries()) {
      assert.ok(x >= -17.5 && x <= 17.5 && z > deskFloorNorth && z < model.floorSouth);
      const next = path[index + 1];
      if (next) assert.ok(!furniture.some(obstacle => intersectsFootprint([x, z], [next[0], next[2]], obstacle)));
    }
  }
});
