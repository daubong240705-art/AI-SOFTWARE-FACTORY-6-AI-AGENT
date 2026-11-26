import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentSummary, FlowRunDetail, FlowRunSummary, GroupSummary, Project, Task } from '@factory/contracts';
import type { Interaction, Office } from '../../../api/officeModels';
import { desksFor, nodeProgress, type ProjectAttempt } from '../../office/liveModel';
import { deriveWorld, projectBuildings } from './deriveWorld';
import { diffWorld, createWorldSeen } from './events';
import { agentStation, campusFootprints, deskFloorNorth, roomDesk, roomDestination, studioMeeting } from '../layout/campus';
import { liveAttemptCount, podFootprints, resolveScope, scopeFloor, scopeGroups } from './scope';
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
  const withCapacity = { ...agent('one', { live: 2 }), maxConcurrent: 4 };
  const idleWithCapacity = { ...agent('two'), maxConcurrent: 3 };
  state.rosters!.first!.agents = [withCapacity, idleWithCapacity];
  state.attempts = { first: [attempt('first-run', 'task', 'one'), attempt('other-run', 'other', 'one')] };
  const { model, assign } = deriveWorld(state);
  assert.deepEqual(model.projects.map(item => item.id), ['first', 'second']);
  assert.deepEqual(model.agents.map(item => [item.seatId, item.projectId, item.runs.length]), [['one', 'first', 2], ['two', 'first', 0], ['three', 'second', 0]]);
  assert.deepEqual(deriveWorld(state, assign).assign, assign);
  assert.notDeepEqual(roomDesk(model.agents[0]!).position, roomDesk(model.agents[2]!).position);
  assert.equal(model.agents[0]!.projectColor, model.agents[1]!.projectColor);
  assert.notEqual(model.agents[0]!.projectColor, model.agents[2]!.projectColor);
  const groups = scopeGroups(model);
  const { roster, agents } = scopeFloor(model, groups.options[0]!, null, null);
  assert.deepEqual(agents.map(item => [item.seatId, liveAttemptCount(item)]), [['one', 2], ['two', 0], ['three', 0]]);
  assert.equal(roster.length, 3);
  assert.ok(roster.every(item => item.slot === 0));
});

test('World scopes default to recent activity and include only the selected group, descendants or project', () => {
  const state = inputs();
  state.groups = { groups: [group('Game', null), group('Sub', 'Game'), group('Elsewhere', null)], membership: { first: 'Game', second: 'Sub', archived: 'Elsewhere' } };
  state.projects!.push(project('shared'), project('other'));
  state.groups.membership.other = 'Elsewhere';
  state.rosters!.shared = { ...state.rosters!.first!, agents: [agent('shared-agent', { projectId: 'shared' })] };
  state.attempts = { first: [attempt('earlier', 'earlier-task', 'one')], second: [{ ...attempt('recent', 'recent-task', 'three', 'waiting-input'), startedAt: new Date(Date.parse(now) + 1000).toISOString() }] };
  const { model } = deriveWorld(state);
  const groups = scopeGroups(model);
  const root = groups.options.find(option => option.id === 'Game')!;
  const child = groups.options.find(option => option.id === 'Sub')!;
  const ungrouped = groups.options.find(option => option.id === null)!;
  assert.equal(child.name, 'Game / Sub');
  assert.deepEqual(resolveScope(groups, null), { groupId: 'Sub', projectId: null });
  assert.deepEqual(resolveScope(groups, { groupId: 'Game', projectId: 'other' }), { groupId: 'Game', projectId: null });
  assert.deepEqual([root.agents, root.working, root.waiting], [3, 1, 1]);
  assert.deepEqual(scopeFloor(model, root, null, null).agents.map(item => item.seatId), ['one', 'two', 'three']);
  assert.deepEqual(scopeFloor(model, root, 'second', null).agents.map(item => item.seatId), ['three']);
  assert.deepEqual(scopeFloor(model, child, null, null).agents.map(item => item.seatId), ['three']);
  assert.deepEqual(scopeFloor(model, ungrouped, null, null).agents.map(item => item.seatId), ['shared-agent']);
});

test('compact pods keep the full roster and expand only the requested project', () => {
  const state = inputs();
  state.rosters!.first!.agents = Array.from({ length: 32 }, (_, index) => agent(`first-${index}`));
  state.rosters!.second!.agents = Array.from({ length: 5 }, (_, index) => agent(`second-${index}`, { projectId: 'second' }));
  const { model } = deriveWorld(state);
  const ungrouped = scopeGroups(model).options[0]!;
  const layout = scopeFloor(model, ungrouped, null, null);
  assert.equal(layout.roster.length, 37);
  assert.deepEqual(layout.pods.map(pod => [pod.name, pod.collapsed, pod.remaining]), [['first', true, 28], ['second', true, 1]]);
  assert.equal(layout.agents.length, 8);
  assert.equal(podFootprints(layout.pods).length, 2);
  const expanded = scopeFloor(model, ungrouped, null, 'first');
  assert.deepEqual(expanded.pods.map(pod => [pod.collapsed, pod.remaining]), [[false, 0], [true, 1]]);
  assert.equal(expanded.agents.length, 36);
  assert.equal(podFootprints(expanded.pods).length, 33);
  assert.equal(new Set(expanded.agents.map(item => item.slotIndex)).size, 36);
  assert.ok(expanded.agents.every(item => roomDesk(item).position[1] < expanded.floorSouth));
  const atThreshold = scopeFloor({ ...model, agents: model.agents.slice(0, 36) }, ungrouped, null, null);
  assert.equal(atThreshold.compact, false);
  assert.equal(atThreshold.agents.length, 36);
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
