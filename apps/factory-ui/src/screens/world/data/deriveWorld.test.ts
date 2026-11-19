import { anchorsForAgents, deskForAgent } from '../agentPresentation';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { ActivitySeat, ActivityTeam } from '../../../api/activityModels';
import type { OrgTeam } from '../../../api/m3Models';
import type { Interaction, Office } from '../../../api/officeModels';
import type { WorkflowDetail } from '../../../api/readModels';
import type { GameReport, GameSummary, PortalGame, PortalStats, ReleaseView, Task } from '@factory/contracts';
import { classifyPod } from './classify';
import { assignDesks } from './assignDesks';
import { deriveWorld } from './deriveWorld';
import { createWorldSeen, diffWorld } from './events';
import { createWorldPoller, type PollClock, type PollJob } from './poller';
import { officeSeat } from './officeSeat';
import type { WorldInputs } from './types';
const at = '2026-11-17T08:00:00.000Z';
const date = (delta: number) => new Date(Date.parse(at) + delta).toISOString();
const seat = (id: string, extra: Partial<ActivitySeat> = {}): ActivitySeat => ({ id, name: id, role: 'worker', isLead: false, slots: 1, status: 'idle', runs: [], queued: 0, needsYou: [], lastFinished: null, ...extra });
const team = (seats: ActivitySeat[], extra: Partial<ActivityTeam> = {}): ActivityTeam => ({ id: 'team', name: 'Real team', lifecycle: 'active', counts: { working: 0, waiting: 0, problem: 0, queued: 0, idle: 0 }, seats, ...extra });
const org = (capabilities?: string[], extra: Partial<OrgTeam> = {}): OrgTeam => ({ id: 'team', name: 'Real team', charter: '', packKey: 'games', packVersion: '1', lifecycle: 'active', revision: 1, engagements: [], seats: [{ id: 'seat', name: 'seat', role: 'worker', slots: 1, revision: 1, isLead: false, live: 0, runtime: null, runtimeConfig: null, capabilities: capabilities ?? [], tools: [] }], ...extra });
const game = (projectId = 'p', extra: Partial<GameSummary> = {}): GameSummary => ({ projectId, name: projectId, gameId: `game-${projectId}`, workflow: { instanceId: `wf-${projectId}`, state: 'active', currentStage: 'design', loops: 0 }, release: null, updatedAt: at, ...extra });
function inputs(): WorldInputs {
    return { activity: { ok: true, apiVersion: 1, generatedAt: at, nodes: [], teams: [team([seat('seat')])] }, teams: { teams: [org([])] }, games: { games: [game()] }, interactions: {}, tasks: {}, workflows: {}, reports: {}, releases: {} };
}
const task = (id: string, state: Task['state'], extra: Partial<Task> = {}): Task => ({ id, projectId: 'p', revision: 1, code: `TASK-${id.padStart(3, '0')}`, title: id, goal: 'goal', brief: '', parentTaskId: null, engagementId: null, ownerSeatId: null, origin: { kind: 'operator' }, state, holds: [], disposition: 'active', requiredCapabilities: [], placement: 'portable', sideEffect: 'none', reviewPolicy: 'automatic', gate: { requiresGo: false }, acceptance: [], inputs: [], dependsOn: [], ...extra });
const detail = (ids: string[]): WorkflowDetail => ({ id: 'wf-p', key: 'game', title: 'Game', state: 'active', createdAt: at, startedAt: at, endedAt: null, lastProgressAt: at, patches: [], graph: null, phases: [], stages: ids.map((id, i) => ({ key: id, phase: '', state: 'done', loopCount: i, tasks: [{ taskId: id, code: id, state: 'done' }] })) });
const interaction = (id: string, kind: Interaction['kind'] = 'handoff', extra: Partial<Interaction> = {}): Interaction => ({ id, at, kind, from: { kind: 'seat', seatId: 'seat', name: 'seat' }, to: { kind: 'seat', seatId: 'other', name: 'other' }, taskId: null, code: null, text: 'real exchange', ...extra });
const office = (items: Interaction[]): Office => ({ ok: true, apiVersion: 1, generatedAt: at, seats: [], items });
const report = (qaRounds: GameReport['qaRounds']): GameReport => ({ stages: [], totals: { durationMs: 0, attempts: 0, tokens: null }, qaRounds });
const round = (iteration: number, verdict: GameReport['qaRounds'][number]['verdict'], count = 1): GameReport['qaRounds'][number] => ({ iteration, verdict, taskCode: 'QA-001', criteria: Array.from({ length: count }, (_, i) => ({ criterion: `criterion ${i}`, passed: verdict === 'passed', evidence: `evidence ${i}` })) });
const release = (id: string, state: ReleaseView['state'], version: number | null, delta = 0): ReleaseView => ({ id, kind: 'publish', gameId: 'game-p', commitSha: null, state, version, playUrl: null, error: null, createdAt: date(delta), completedAt: state === 'done' ? date(delta) : null });
// All fixtures are synthetic test inputs; production has no fallback/demo data.
test('empty or failed sources produce no fabricated entities', () => {
    const model = deriveWorld({ interactions: {}, tasks: {}, workflows: {}, reports: {}, releases: {} }).model;
    assert.equal(model.focusProjectId, null);
    assert.deepEqual(model.agents, []);
    assert.deepEqual(model.gallery, []);
    assert.equal(model.portal.onlineUsers, null);
});
test('pod priority, authoritative capabilities and fallback names', () => {
    const s = seat('seat', { isLead: true });
    assert.equal(classifyPod(s, org(['test.unit'], { packKey: 'portal-ops' })), 'portal');
    assert.equal(classifyPod(s, org(['test.unit'])), 'lead');
    for (const [caps, expected] of [[['game.design', 'review.game'], 'qa'], [['test.unit'], 'qa'], [['game.design', 'game.rules'], 'design'], [['game.rules'], 'rules'], [['game.ui', 'game.client'], 'art'], [['design.asset'], 'art'], [['game.integrate'], 'client']] as const)
        assert.equal(classifyPod(seat('seat'), org([...caps])), expected);
    assert.equal(classifyPod(seat('seat', { name: 'QA tester' })), 'qa');
    assert.equal(classifyPod(seat('seat', { name: 'QA tester' }), org([])), 'annex');
});
test('desk allocations survive reorder, removals and new seats without collisions', () => {
    const items = Array.from({ length: 14 }, (_, i) => ({ seatId: String(i), podKey: 'design' as const }));
    const first = assignDesks(items);
    assert.equal(first['2']?.podKey, 'annex');
    assert.equal(Object.values(first).filter(a => a.overflow).length, 4);
    const active = [items[9]!, items[1]!, items[2]!, { seatId: 'new', podKey: 'design' as const }];
    const next = assignDesks(active, first);
    for (const id of ['9', '1', '2'])
        assert.deepEqual(next[id], first[id]);
    assert.equal(next.new?.slotIndex, 0);
    const drawn = Object.values(next).filter(a => !a.overflow);
    assert.equal(new Set(drawn.map(a => `${a.podKey}:${a.slotIndex}`)).size, drawn.length);
});
test('agents use real teams, server-time resting and status poses; archived teams vanish', () => {
    const x = inputs();
    x.activity!.teams = [team([
            seat('old', { lastFinished: { code: 'A-001', outcome: 'succeeded', at: date(-900000) } }),
            seat('recent', { lastFinished: { code: 'A-002', outcome: 'succeeded', at: date(-899999) } }),
            ...(['working', 'queued', 'waiting', 'problem', 'done'] as const).map(status => seat(status, { status })),
        ]), team([seat('archived')], { id: 'archived', lifecycle: 'archived' })];
    const before = JSON.stringify(x);
    const { model } = deriveWorld(x);
    assert.deepEqual(model.agents.map(a => [a.seatId, a.pose]), [['done', 'success'], ['old', 'resting'], ['problem', 'error'], ['queued', 'thinking'], ['recent', 'idle'], ['waiting', 'attention'], ['working', 'working']]);
    assert.equal(JSON.stringify(x), before);
    x.teams!.teams[0]!.lifecycle = 'paused';
    assert.ok(deriveWorld(x).model.agents.every(a => a.pose === 'resting'));
    const adapted = officeSeat(model.agents[0]!, { name: 'Real team' });
    assert.equal(adapted.chat, null);
    assert.equal(adapted.teamId, 'team');
});
test('hot games use workflow or live runs, cap at 3, sort by updatedAt, with explicit/fallback focus', () => {
    const x = inputs();
    x.games = { games: [game('old', { updatedAt: date(-3000) }), game('live', { workflow: null }), game('new', { updatedAt: date(1000) }), game('paused', { workflow: { instanceId: 'paused-wf', state: 'paused', currentStage: null, loops: 0 } }), game('cold', { workflow: null, updatedAt: date(5000) })] };
    x.activity!.teams[0]!.seats[0]!.runs = [{ projectId: 'live', projectName: 'live', taskId: 'task', code: 'A-001', title: 'Live', attemptId: 'attempt', attemptState: 'preparing', nodeId: null, startedAt: at, progress: null }];
    assert.deepEqual(deriveWorld(x).model.hotProjects.map(g => g.projectId), ['new', 'live', 'paused']);
    assert.equal(deriveWorld(x).model.focusProjectId, 'new');
    x.focusProjectId = 'cold';
    assert.equal(deriveWorld(x).model.focusProjectId, 'cold');
    delete x.focusProjectId;
    x.activity!.teams = [];
    x.games.games = [game('cold', { workflow: null })];
    assert.equal(deriveWorld(x).model.focusProjectId, 'cold');
});
test('task columns exclude parked work, prioritize action holds, cap each column and take last done stages', () => {
    const x = inputs();
    x.tasks.p = [...Array.from({ length: 8 }, (_, i) => task(String(i), 'done')), task('101', 'proposed'), task('102', 'accepted'), task('103', 'ready'), task('104', 'awaiting-go'), task('105', 'active'), task('106', 'in-review'), task('107', 'failed'), task('108', 'ready', { disposition: 'parked' }), task('109', 'ready', { holds: [{ kind: 'decision', reason: 'review', ref: null, since: at, needsAction: true }] }), ...Array.from({ length: 7 }, (_, i) => task(`20${i}`, 'active'))];
    x.workflows.p = detail(['7', '6', '5', '4', '3', '2', '1', '0']);
    const { model } = deriveWorld(x);
    assert.deepEqual(model.tasks.columns.done.map(t => t.taskId), ['5', '4', '3', '2', '1', '0']);
    assert.equal(model.tasks.overflow.done, 2);
    assert.equal(model.tasks.overflow.doing, 2);
    assert.equal(model.tasks.columns.todo.length, 4);
    assert.equal(model.tasks.columns.review.length, 2);
    assert.equal(model.stages[2]?.loopCount, 2);
    x.games!.games[0]!.workflow!.instanceId = 'replacement';
    assert.deepEqual(deriveWorld(x).model.stages, []);
});
test('interaction endpoints cover flights and leave progress/finished/failed as non-flights', () => {
    const x = inputs();
    x.interactions.p = office([
        ...(['handoff', 'request', 'assign', 'question', 'review', 'start-gate', 'output', 'finished', 'failed', 'progress'] as const).map(kind => interaction(kind, kind, { taskId: 'actual-task' })),
        ...(['answer', 'rework', 'message'] as const).map(kind => interaction(kind, kind, { from: { kind: 'operator' } })),
    ]);
    const h = deriveWorld(x).model.handoffs;
    assert.equal(h.length, 10);
    assert.equal(h.find(h => h.kind === 'handoff')?.taskId, 'actual-task', 'Clicks must preserve the real task reference');
    assert.equal(h.find(h => h.kind === 'question')?.to.kind, 'owner');
    assert.equal(h.find(h => h.kind === 'message')?.from.kind, 'owner');
    assert.equal(h.find(h => h.kind === 'output')?.to.kind, 'knowledge');
});
test('QA iteration order, stable bug identity, retesting, passed clearance and overflow', () => {
    const x = inputs();
    x.reports.p = report([round(2, 'running'), round(1, 'changes-requested', 14)]);
    const a = deriveWorld(x).model;
    assert.equal(a.bugs.length, 12);
    assert.equal(a.bugOverflow, 2);
    assert.equal(a.bugIds.length, 14);
    assert.equal(a.bugs[0]?.state, 'retesting');
    assert.equal(a.bugs[0]?.taskCode, 'QA-001', 'An unfocused game can resolve the QA task by code');
    x.tasks.p = [task('qa-task', 'failed', { code: 'QA-001' })];
    assert.equal(deriveWorld(x).model.bugs[0]?.taskId, 'qa-task');
    x.reports.p.qaRounds = [round(3, 'changes-requested')];
    assert.equal(deriveWorld(x).model.bugs[0]?.id, a.bugs[0]?.id);
    x.reports.p.qaRounds.push(round(4, 'passed'));
    assert.deepEqual(deriveWorld(x).model.bugs, []);
});
test('gallery caps completed publishes, keeps pending/new failures, and joins real portal counts', () => {
    const x = inputs();
    x.releases.p = { enabled: true, releases: [...Array.from({ length: 11 }, (_, i) => release(`done${i}`, 'done', i + 1, -i * 1000)), release('oldFailed', 'failed', null, -20000), release('newFailed', 'failed', null, 1000), release('pending', 'pending', null, 2000), { ...release('rollback', 'done', 99), kind: 'rollback' }] };
    x.portal = { configured: true, projectId: null };
    const pg: PortalGame = { id: 'game-p', name: 'Game', description: '', category: '', minPlayers: 1, maxPlayers: 2, bot: false, enabled: false, currentVersion: 1, updatedAt: at, versions: [] };
    x.portalGames = { games: [pg] };
    x.portalStats = { from: '2026-11-17', to: '2026-11-17', utcOffsetMinutes: 0, totals: { matches: 0, players: 0, registeredPlayers: 0, guestPlayers: 0, newUsers: 0 }, live: { rooms: 1, playingRooms: 1, waitingRooms: 0, onlineUsers: 2, byGame: { 'game-p': { rooms: 1, playing: 2 } } }, games: [] } satisfies PortalStats;
    const m = deriveWorld(x).model;
    assert.equal(m.gallery.filter(g => g.state === 'done').length, 9);
    assert.equal(m.gallery.filter(g => g.state === 'failed').length, 1);
    assert.equal(m.gallery.find(g => g.version === 1)?.current, true);
    assert.equal(m.gallery[0]?.enabled, false);
    assert.equal(m.gallery[0]?.playing, 2);
    assert.equal(m.portal.onlineUsers, 2);
    assert.equal(m.portal.booths[0]?.rooms, 1);
    delete x.portalStats;
    assert.equal(deriveWorld(x).model.gallery[0]?.playing, null);
    assert.deepEqual(deriveWorld(x).model.portal.booths, []);
});
test('first model and each first project interaction read establish independent baselines', () => {
    const x = inputs();
    x.interactions.p = office([interaction('history')]);
    const base = deriveWorld(x).model;
    const initial = createWorldSeen(Date.parse(at));
    const first = diffWorld(null, base, initial, at);
    assert.equal(first.events.length, 0);
    assert.equal(initial.baseline, false);
    assert.equal(first.seen.baseline, true);
    x.interactions.p.items.push(interaction('new'));
    x.interactions.other = office([interaction('other-history')]);
    const next = deriveWorld(x).model;
    const second = diffWorld(base, next, first.seen, at);
    assert.deepEqual(second.events.map(e => e.id), ['handoff:p:new']);
    assert.deepEqual(diffWorld(next, next, second.seen, at).events, []);
    second.seen.reset = true;
    x.interactions.p.items.push(interaction('after-hidden'));
    assert.deepEqual(diffWorld(next, deriveWorld(x).model, second.seen, at).events, []);
});
test('4-second baseline fallback and 90-second stale suppression', () => {
    const x = inputs();
    delete x.teams;
    const m = deriveWorld(x).model;
    const seen = createWorldSeen(Date.parse(at));
    const a = diffWorld(null, m, seen, date(3999));
    assert.equal(a.seen.baseline, false);
    const b = diffWorld(m, m, a.seen, date(4000));
    assert.equal(b.seen.baseline, true);
    x.interactions.p = office([]);
    const c = diffWorld(m, deriveWorld(x).model, b.seen, date(4000));
    x.interactions.p.items.push(interaction('stale', 'handoff', { at: date(-90001) }), interaction('fresh', 'handoff', { at: date(4000) }));
    const d = diffWorld(deriveWorld(x).model, deriveWorld(x).model, c.seen, date(4000));
    assert.deepEqual(d.events.map(e => e.id), ['handoff:p:fresh']);
});
test('bug and pose changes emit once; releases require a newer, recent completed version', () => {
    const x = inputs();
    x.reports.p = report([]);
    x.releases.p = { enabled: true, releases: [] };
    const a = deriveWorld(x).model;
    const seen = diffWorld(null, a, createWorldSeen(Date.parse(at)), at).seen;
    x.reports.p.qaRounds.push(round(1, 'changes-requested'));
    x.releases.p.releases.push(release('v1', 'done', 1));
    x.activity!.teams[0]!.seats[0]!.status = 'working';
    const b = deriveWorld(x).model;
    const change = diffWorld(a, b, seen, at);
    assert.deepEqual(change.events.map(e => e.type).sort(), ['bugSpawned', 'poseChanged', 'release']);
    assert.deepEqual(diffWorld(b, b, change.seen, at).events, []);
    x.reports.p.qaRounds.push(round(2, 'passed'));
    x.releases.p.releases.push(release('v2', 'done', 2, -90001));
    const c = diffWorld(b, deriveWorld(x).model, change.seen, at);
    assert.deepEqual(c.events.map(e => e.type), ['bugDefeated']);
});
function fakeClock() {
    const pending = new Map<number, {
        fn: () => void;
        ms: number;
    }>();
    let id = 0;
    const clock: PollClock = { set: (fn, ms) => { pending.set(++id, { fn, ms }); return id; }, clear: id => { pending.delete(id as number); }, random: () => 0.5 };
    return { pending, clock, fire() { const entry = pending.entries().next().value; assert.ok(entry); pending.delete(entry[0]); entry[1].fn(); } };
}
const flush = async () => { for (let i = 0; i < 10; i++)
    await Promise.resolve(); };
test('poller serializes invalidations, cancels on hidden/stop and does not repeat once-only reads', async () => {
    const timer = fakeClock();
    let hidden = false;
    let runs = 0;
    let finish = () => { };
    let signal: AbortSignal | undefined;
    const job: PollJob = { key: 'key', interval: 5000, run: s => { runs++; signal = s; return new Promise<void>(r => { finish = r; }); } };
    const poller = createWorldPoller({ clock: timer.clock, hidden: () => hidden, onError: () => assert.fail('unexpected error') });
    poller.sync([job]);
    poller.refresh('key');
    poller.refresh('key');
    assert.equal(runs, 1);
    finish();
    await flush();
    timer.fire();
    assert.equal(runs, 2);
    hidden = true;
    poller.visibility();
    assert.equal(signal?.aborted, true);
    finish();
    await flush();
    assert.equal(timer.pending.size, 0);
    hidden = false;
    poller.visibility();
    assert.equal(runs, 3);
    poller.stop();
    assert.equal(signal?.aborted, true);
    finish();
    await flush();
    assert.equal(timer.pending.size, 0);
    const once = createWorldPoller({ clock: timer.clock, hidden: () => false, onError: () => { } });
    once.sync([{ key: 'portal', interval: Infinity, run: async () => { } }]);
    await flush();
    assert.equal(timer.pending.size, 0);
    once.stop();
});
test('poller backs off failures to 60 seconds and recovers to its normal interval', async () => {
    const timer = fakeClock();
    let failed = true;
    let errors = 0;
    const poller = createWorldPoller({ clock: timer.clock, hidden: () => false, onError: () => { errors++; } });
    poller.sync([{ key: 'activity', interval: 5000, run: async () => { if (failed)
                throw new Error('safe test failure'); } }]);
    for (const delay of [10000, 20000, 40000, 60000]) {
        await flush();
        assert.equal([...timer.pending.values()][0]?.ms, delay);
        timer.fire();
    }
    failed = false;
    await flush();
    timer.fire();
    await flush();
    assert.equal([...timer.pending.values()][0]?.ms, 5000);
    assert.equal(errors, 5);
    poller.stop();
});

test('controller schedules real sources, retains failed data, changes focus and resets after long hidden intervals', async () => {
  const {createWorldDataController} = await import('./controller');
  const timer = fakeClock(); let now = Date.parse(at); let hidden = false; let activityFails = false;
  const x = inputs(); x.games!.games.push(game('cold', {workflow: null}));
  const calls: Record<string, number> = {}; const signals: AbortSignal[] = [];
  const capture = <T>(key: string, value: T, signal?: AbortSignal): Promise<T> => {
    calls[key] = (calls[key] ?? 0) + 1;
    if (signal) signals.push(signal);
    return Promise.resolve(structuredClone(value));
  };
  const engine = createWorldDataController({
    getOrgActivity: s => {if (activityFails) return Promise.reject(new Error('safe test failure')); return capture('activity', x.activity!, s);},
    listGames: s => capture('games', x.games!, s),
    listTeams: s => capture('teams', x.teams!, s),
    getProjectInteractions: (id, limit, s) => {assert.equal(limit, 60); return capture(`interactions:${id}`, office(x.interactions[id]?.items ?? []), s);},
    getGameReport: (id, s) => capture(`report:${id}`, report([]), s),
    listTasks: (id, s) => capture(`tasks:${id}`, {ok: true, apiVersion: 1, items: [task('001', 'ready', {projectId: id})]}, s),
    getWorkflow: (id, instanceId, s) => {assert.equal(instanceId, `wf-${id}`); return capture(`workflow:${id}`, {instance: detail([])}, s);},
    listReleases: (id, s) => capture(`releases:${id}`, {enabled: true, canPublish: {allowed: true, reason: null}, releases: []}, s),
    getPortal: s => capture('portal', {configured: false, projectId: null}, s),
    portalGames: () => assert.fail('unconfigured portal games'),
    portalStats: () => assert.fail('unconfigured portal stats'),
  }, {hidden: () => hidden, now: () => now, clock: timer.clock, onSnapshot: () => {}});
  const fire = (delay: number) => {
    const entry = [...timer.pending.entries()].find(([, v]) => v.ms === delay);
    assert.ok(entry, `missing interval ${delay}`); timer.pending.delete(entry[0]); entry[1].fn();
  };
  engine.start(); await flush();
  assert.deepEqual(engine.getSnapshot().reports.p, report([])); await flush();
  assert.equal(calls.portal, 1); assert.equal(calls['releases:cold'], 1);
  assert.equal(calls['interactions:cold'], undefined); assert.equal(calls['tasks:p'], 1);
  assert.equal(engine.getSnapshot().sources.activity?.state, 'ok');
  assert.deepEqual(engine.getSnapshot().events, []);
  const identical = engine.getSnapshot();
  fire(5000); await flush();
  assert.equal(engine.getSnapshot(), identical, 'identical poll does not emit or replace scene props');
  x.activity!.generatedAt = new Date(now + 1000).toISOString();
  fire(5000); await flush();
  assert.equal(engine.getSnapshot(), identical, 'transport timestamp alone does not re-render the scene');
  x.activity!.teams[0]!.seats[0]!.status = 'working';
  fire(5000); await flush();
  assert.equal(engine.getSnapshot().events[0]?.type, 'poseChanged');
  engine.consumeEvents(); assert.deepEqual(engine.getSnapshot().events, []);
  activityFails = true; fire(5000); await flush();
  assert.equal(engine.getSnapshot().sources.activity?.state, 'error');
  assert.equal(engine.getSnapshot().model.agents[0]?.status, 'working');
  activityFails = false;
  engine.setFocusProjectId('cold'); await flush();
  assert.equal(calls['tasks:cold'], 1); assert.equal(engine.getSnapshot().model.focusProjectId, 'cold');
  engine.setFocusProjectId(null); await flush();
  const teamsBefore = calls.teams ?? 0; const releasesBefore = calls['releases:p'] ?? 0;
  x.activity!.teams[0]!.seats.push(seat('new-seat'));
  x.games!.games[0]!.release = {version: 1, state: 'done', playUrl: null, createdAt: at};
  // Visibility also exercises refresh while an error-backoff timer is pending.
  hidden = true; engine.visibility(); now += 1000; hidden = false; engine.visibility(); await flush(); await flush();
  assert.ok((calls.teams ?? 0) > teamsBefore); assert.ok((calls['releases:p'] ?? 0) > releasesBefore);
  assert.equal(calls.portal, 1);
  engine.consumeEvents(); hidden = true; engine.visibility(); now += 31000;
  x.activity!.generatedAt = new Date(now).toISOString(); x.activity!.teams[0]!.seats[0]!.status = 'done';
  hidden = false; engine.visibility(); await flush(); await flush();
  assert.deepEqual(engine.getSnapshot().events, []);
  assert.equal(engine.getSnapshot().model.agents.find(a => a.seatId === 'seat')?.status, 'done');
  engine.stop(); assert.equal(timer.pending.size, 0); assert.ok(signals.length > 0);
});

test('configured portal polls counts at 15/60 seconds without re-reading configuration', async () => {
  const {createWorldDataController} = await import('./controller');
  const timer = fakeClock(); let configReads = 0; let statsReads = 0; let gamesReads = 0;
  const stats: PortalStats = {from: '2026-11-17', to: '2026-11-17', utcOffsetMinutes: 0, totals: {matches: 0, players: 0, registeredPlayers: 0, guestPlayers: 0, newUsers: 0}, live: {rooms: 0, playingRooms: 0, waitingRooms: 0, onlineUsers: 0, byGame: {}}, games: []};
  const x = inputs(); x.games!.games = [];
  const engine = createWorldDataController({
    getOrgActivity: async () => x.activity!, listTeams: async () => x.teams!, listGames: async () => x.games!,
    getPortal: async () => {configReads++; return {configured: true, projectId: null};},
    portalGames: async () => {gamesReads++; return {games: []};},
    portalStats: async () => {statsReads++; return stats;},
    getProjectInteractions: () => assert.fail('no hot games'), getGameReport: () => assert.fail('no hot games'),
    listTasks: () => assert.fail('no focus'), getWorkflow: () => assert.fail('no focus'), listReleases: () => assert.fail('no games'),
  }, {hidden: () => false, now: () => Date.parse(at), clock: timer.clock, onSnapshot: () => {}});
  engine.start(); await flush();
  assert.equal(engine.getSnapshot().model.portal.onlineUsers, 0);
  assert.equal(statsReads, 1); assert.equal(gamesReads, 1); assert.equal(configReads, 1);
  const statsTimer = [...timer.pending.entries()].find(([,v]) => v.ms === 15000)!;
  timer.pending.delete(statsTimer[0]); statsTimer[1].fn(); await flush();
  assert.equal(statsReads, 2); assert.equal(gamesReads, 1); assert.equal(configReads, 1);
  engine.stop();
});

test('jitter includes both ends of the ten-percent range and drawn agents stay below 24', async () => {
  for (const [random, expected] of [[0, 54000], [1, 66000]] as const) {
    const timer = fakeClock(); timer.clock.random = () => random;
    const poller = createWorldPoller({clock: timer.clock, hidden: () => false, onError: () => {}});
    poller.sync([{key: 'teams', interval: 60000, run: async () => {}}]); await flush();
    assert.equal([...timer.pending.values()][0]?.ms, expected); poller.stop();
  }
  const pods = ['lead', 'design', 'rules', 'art', 'client', 'qa', 'portal', 'annex'] as const;
  const assignments = assignDesks(pods.flatMap(podKey => Array.from({length: 6}, (_,i) => ({seatId: `${podKey}:${i}`, podKey}))));
  assert.ok(Object.values(assignments).filter(s => !s.overflow).length <= 24);
});

test('removing and re-adding a key waits for the aborted request to settle', async () => {
  const timer = fakeClock(); let runs = 0; let finish = () => {};
  const job: PollJob = {key: 'focus', interval: 15000, run: () => {runs++; return new Promise<void>(resolve => {finish = resolve;});}};
  const poller = createWorldPoller({clock: timer.clock, hidden: () => false, onError: () => {}});
  poller.sync([job]); poller.sync([]); poller.sync([job]); assert.equal(runs, 1);
  finish(); await flush(); timer.fire(); assert.equal(runs, 2);
  poller.stop(); finish(); await flush();
});

test('operator placements keep resting agents at desks and reserve unique lounge spots for paused teams', () => {
  const x = inputs();
  x.activity!.teams = [team(Array.from({length: 30}, (_, index) => seat(`seat-${String(index).padStart(2, '0')}`)))];
  const active = deriveWorld(x).model.agents;
  assert.ok(active.some(agent => agent.pose === 'resting'));
  const anchors = anchorsForAgents(active);
  for (const agent of active) {
    const desk = deskForAgent(agent);
    if (!desk) { assert.ok(!anchors.has(agent.seatId)); continue; }
    assert.equal(anchors.get(agent.seatId)!.id, desk.id);
    assert.deepEqual(anchors.get(agent.seatId)!.point, desk.seat);
  }
  x.activity!.teams[0]!.lifecycle = 'paused';
  const paused = deriveWorld(x).model.agents;
  const visiting = anchorsForAgents(paused);
  const lounge = [...visiting.values()].filter(anchor => anchor.id.startsWith('rest-'));
  assert.equal(lounge.length, Math.min(6, visiting.size));
  assert.equal(new Set(lounge.map(anchor => anchor.id)).size, lounge.length);
  assert.equal(new Set(lounge.map(anchor => anchor.point.join(','))).size, lounge.length);
  assert.deepEqual(anchorsForAgents([...paused].reverse()), visiting);
  for (const agent of paused) {
    const anchor = visiting.get(agent.seatId);
    if (anchor && !anchor.id.startsWith('rest-')) assert.equal(anchor.id, deskForAgent(agent)!.id);
  }
});

// W-13: one worker per seat slot.
const activeRun = (attemptId: string, taskId = attemptId, startedAt = at): ActivitySeat['runs'][number] => ({ projectId: 'p', projectName: 'p', taskId, code: `T-${taskId}`, title: taskId, attemptId, attemptState: 'running', nodeId: null, startedAt, progress: null });
function workers(seats: ActivitySeat[], previous = {}) {
  const x = inputs(); x.activity!.teams = [team(seats)];
  return deriveWorld(x, previous);
}
test('a seat with two slots becomes two idle workers on different desks', () => {
  const { model } = workers([seat('rules', { slots: 2 })]);
  assert.deepEqual(model.agents.map(a => [a.seatId, a.ownerSeatId, a.slot, a.status]), [['rules', 'rules', 0, 'idle'], ['rules#2', 'rules', 1, 'idle']]);
  assert.notEqual(deskForAgent(model.agents[0]!)?.id, deskForAgent(model.agents[1]!)?.id);
  assert.equal(model.agents[1]!.name, 'rules #2');
});
test('two runs make both workers work; one run leaves the second idle', () => {
  const both = workers([seat('rules', { slots: 2, status: 'working', runs: [activeRun('a', 'a', date(0)), activeRun('b', 'b', date(1000))] })]).model.agents;
  assert.deepEqual(both.map(a => [a.status, a.runs.map(r => r.attemptId)]), [['working', ['a']], ['working', ['b']]]);
  const one = workers([seat('rules', { slots: 2, status: 'working', runs: [activeRun('a')] })]).model.agents;
  assert.deepEqual(one.map(a => a.status), ['working', 'idle']);
});
test('controller keeps Rules Engineer slot 2 working across reordered activity polls', async () => {
    const { createWorldDataController } = await import('./controller');
    const timer = fakeClock(); let poll = 0; const seatValue = seat('rules', { name: 'Rules Engineer', slots: 2, status: 'working', runs: [activeRun('attempt-a', 'a', date(0)), activeRun('attempt-b', 'b', date(1000))] });
    const activity = () => ({ ok: true as const, apiVersion: 1 as const, generatedAt: at, nodes: [], teams: [team([{ ...seatValue, runs: poll % 2 ? [...seatValue.runs].reverse() : seatValue.runs }])] });
    const api: import('./controller').WorldDataApi = {
      getOrgActivity: async () => { poll++; return activity(); }, listTeams: async () => ({ teams: [org([])] }), listGames: async () => ({ games: [] }),
      getProjectInteractions: async () => office([]), listTasks: async () => ({ ok: true, apiVersion: 1, items: [] }), getWorkflow: async () => ({ instance: detail([]) }), getGameReport: async () => report([]), listReleases: async () => ({ enabled: true, canPublish: { allowed: true, reason: null }, releases: [] }), getPortal: async () => ({ configured: false, projectId: null }), portalGames: async () => ({ games: [] }), portalStats: async () => { throw new Error('not configured'); },
    };
    const engine = createWorldDataController(api, { hidden: () => false, clock: timer.clock, onSnapshot: () => {} });
    engine.start(); await flush();
    const first = engine.getSnapshot().model.agents;
    assert.deepEqual(first.map(agent => [agent.seatId, agent.status, agent.runs[0]?.attemptId]), [['rules', 'working', 'attempt-a'], ['rules#2', 'working', 'attempt-b']]);
    const pending = [...timer.pending.entries()].find(([, item]) => item.ms === 5000); assert.ok(pending); timer.pending.delete(pending[0]); pending[1].fn(); await flush();
    const second = engine.getSnapshot().model.agents;
    assert.deepEqual(second.map(agent => [agent.seatId, agent.status, agent.runs[0]?.attemptId]), [['rules', 'working', 'attempt-a'], ['rules#2', 'working', 'attempt-b']]);
    assert.equal(poll, 2);
    assert.deepEqual(second.map(a => deskForAgent(a)?.id), first.map(a => deskForAgent(a)?.id));
    engine.stop();
});
test('a run keeps its worker and desk when the other run ends', () => {
  const first = workers([seat('rules', { slots: 2, status: 'working', runs: [activeRun('a', 'a', date(0)), activeRun('b', 'b', date(1000))] })]);
  const second = workers([seat('rules', { slots: 2, status: 'working', runs: [activeRun('b', 'b', date(1000))] })], first.assign);
  assert.deepEqual(second.model.agents.map(a => [a.seatId, a.status, a.runs.map(r => r.attemptId)]), [['rules', 'idle', []], ['rules#2', 'working', ['b']]]);
  assert.deepEqual(second.model.agents.map(a => deskForAgent(a)?.id), first.model.agents.map(a => deskForAgent(a)?.id));
});
test('a question goes to the worker whose run it belongs to', () => {
  const need = { approvalId: 'q1', kind: 'question' as const, taskId: 'b', code: 'T-b' };
  const agents = workers([seat('rules', { slots: 2, status: 'waiting', runs: [activeRun('a', 'a', date(0)), activeRun('b', 'b', date(1000))], needsYou: [need] })]).model.agents;
  assert.deepEqual(agents.map(a => [a.status, a.needsYou.length]), [['working', 0], ['waiting', 1]]);
});

test('activity anchors remain reachable and every navigation edge avoids prop footprints', async () => {
  const { layout, navigationAnchors, pathBetween } = await import('../layout/waypoints');
  assert.equal(layout.blockedEdges, 0);
  for (const id of ['coffee', 'cat', 'plant-water', 'ping-left', 'ping-right', 'rest-1']) {
    assert.ok(navigationAnchors[id]);
    assert.ok(pathBetween('rules-2', id).length >= 2, `unreachable ${id}`);
  }
});
test('leisure reserves two real idle players together and real work interrupts both', async () => {
  const { WanderingDirector } = await import('../scene/wandering');
  const director = new WanderingDirector();
  const people = ['a', 'b'].map(seatId => ({ seatId, idle: true, desk: [0, 0] as const, home: seatId }));
  const spots = [{ id: 'ping-left', point: [-5.4, 2.2] as const }, { id: 'ping-right', point: [-1, 2.2] as const }];
  director.update(people, spots, 0, true, 3);
  let departures = director.update(people, spots, 60000, true, 3);
  for (let i = 1; !departures.length && i < 20; i++) departures = director.update(people, spots, 60000 + i, true, 3);
  assert.equal(departures.length, 2);
  assert.equal(director.reservedSpots().size, 2);
  director.arrive('a', 61000); director.arrive('b', 62000);
  assert.equal(director.activity('a'), 'ping-pong'); assert.equal(director.activity('b'), 'ping-pong');
  people[0]!.idle = false;
  const returns = director.update(people, spots, 63000, true, 3);
  assert.equal(returns.length, 2); assert.ok(returns.every(a => a.urgent));
  assert.equal(director.activity('a'), null); assert.equal(director.activity('b'), null);
  director.update(people, spots, 64000, false, 0);
  assert.equal(director.reservedSpots().size, 0);
});
test('week achievements require actual completion dates and complete source coverage', async () => {
  const { achievements, daylight } = await import('../scene/props/state');
  const x = inputs(); x.releases.p = { enabled: true, releases: [release('one', 'done', 1)] };
  const qa = report([round(1, 'passed')]); x.reports.p = qa;
  const now = new Date(2026, 10, 19, 12);
  let model = deriveWorld(x).model;
  assert.deepEqual(achievements(model, x.reports, now), { released: 1, passed: null });
  qa.stages = [{ key: 'qa', title: 'QA', iterations: [{ iteration: 1, taskCode: 'QA-001', state: 'done', startedAt: at, endedAt: new Date(2026, 10, 18, 12).toISOString(), durationMs: null, attempts: 1, tokens: null }] }];
  assert.deepEqual(achievements(model, x.reports, now), { released: 1, passed: 1 });
  qa.stages[0]!.iterations[0]!.endedAt = new Date(2026, 10, 15, 12).toISOString();
  assert.equal(achievements(model, x.reports, now).passed, 0);
  model = deriveWorld({ interactions: {}, tasks: {}, workflows: {}, reports: {}, releases: {} }).model;
  assert.deepEqual(achievements(model, {}, now), { released: null, passed: null });
  assert.deepEqual([5, 6, 17, 19].map(hour => daylight(new Date(2026, 10, 19, hour))), ['night', 'day', 'sunset', 'night']);
});


test('toys stay local, enforce cooldown and concurrency, expire buffs, and roll counters at local midnight', async () => {
  const { ToyStore, localDay } = await import('../scene/toys/store');
  const now = +new Date(2026, 10, 19, 23, 59, 50), saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
  const state = new ToyStore(storage);
  assert.equal(state.snapshot().sound, false);
  assert.equal(state.apply('a', 'coffee', false, now), true);
  assert.equal(state.apply('a', 'hammer', false, now + 999), false);
  assert.equal(state.apply('b', 'megaphone', false, now), true);
  assert.equal(state.apply('c', 'whip', false, now), true);
  assert.equal(state.apply('d', 'cookie', false, now + 1000), false);
  assert.equal(state.snapshot().active[0]!.until, now + 10000);
  state.refresh(now + 3000); assert.equal(state.snapshot().active.length, 2);
  assert.equal(state.apply('d', 'cookie', true, now + 3000), true);
  assert.equal(state.snapshot().active.find(e => e.worker === 'd')!.quiet, true);
  state.refresh(now + 10000); assert.equal(state.snapshot().active.length, 0);
  assert.equal(state.snapshot().day, localDay(new Date(now + 10000))); assert.deepEqual(state.snapshot().counts, {});
  state.mute(); assert.equal(new ToyStore(storage).snapshot().sound, true);
  const broken = new ToyStore({ getItem: () => '{broken', setItem: () => { throw Error('blocked'); } });
  assert.equal(broken.apply('a', 'whip', true, now), true);
});

test('toy modules have no runtime path to work commands or networking', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const folder = new URL('../scene/toys/', import.meta.url);
  for (const file of readdirSync(folder).filter(f => /\.tsx?$/.test(f))) {
    const source = readFileSync(new URL(file, folder), 'utf8');
    assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon)\b|@\/state|@\/api|\.dispatch\(|\.command\(/, file);
    for (const match of source.matchAll(/import\s+(?!type\b).*?from ['"]([^'"]+)['"]/g)) {
      assert.ok(/^(react|three|@react-three\/fiber|@\/i18n|@\/components\/ui\/button|\.\/|\.\.\/(Ticker|screenTexture|props\/geometry)|\.\.\/\.\.\/layout\/zones)/.test(match[1]!), `${file}: ${match[1]}`);
    }
  }
});

test('toy reactions are additive, finite, spring back, and expire without changing work pose', async () => {
  const { reactToToy } = await import('../characters/reaction');
  const base = { y: 0, sx: 1, sy: 1, sz: 1, rx: 0.12, ry: 0, rz: 0, closed: false, effect: null, effectY: 0, sparkle: 1 };
  const { tools, ToyStore } = await import('../scene/toys/store');
  for (const tool of tools) {
    const reaction = { tool, started: 10000 };
    for (let age = 0; age < 3100; age += 17) {
      const result = reactToToy(base, reaction, 10000 + age);
      assert(Object.values(result.frame).filter(v => typeof v === 'number').every(Number.isFinite));
      assert(result.frame.sx > 0 && result.frame.sy > 0 && result.frame.sz > 0);
    }
    assert.deepEqual(reactToToy(base, reaction, 13100).frame, base);
  }
  assert.equal(base.sy, 1);
  assert(reactToToy(base, { tool: 'hammer', started: 10000 }, 10750).frame.sy < 0.25);
  assert(reactToToy(base, { tool: 'hammer', started: 10000 }, 11250).frame.y > 0.3);
  assert(reactToToy(base, { tool: 'whip', started: 10000 }, 10850).x > 0.2);
  assert(reactToToy(base, { tool: 'taser', started: 10000 }, 10800).ears > 0.9);
  assert.equal(reactToToy(base, undefined, 10800).flash, false);
  const store = new ToyStore(); store.spin(); store.spin();
  assert.equal(store.snapshot().oiiaSpins, 2); assert.equal(store.snapshot().active.length, 0);
});


test('W-18b combos expire, six hits sulk locally, treats bypass cooldown, and moods are not persisted', async () => {
  const { ToyStore } = await import('../scene/toys/store');
  const now = +new Date(2026, 10, 19, 12), saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
  for (const treat of ['coffee', 'cookie'] as const) {
    const state = new ToyStore(storage);
    for (let i = 0; i < 6; i++) assert.equal(state.apply('a', 'whip', false, now + i * 1100), true);
    assert.equal(state.snapshot().combo[0]!.count, 6);
    assert.equal(state.snapshot().sulking[0]!.until, now + 15500);
    assert.equal(state.apply('a', 'hammer', false, now + 6600), false, 'sulking ignores rough toys');
    assert.equal(state.apply('a', treat, false, now + 5600), true, 'treat cheers immediately during cooldown');
    assert.equal(state.snapshot().sulking.length, 0);
    assert.equal(state.snapshot().active[0]!.cheered, true);
    assert.equal(state.snapshot().combo[0]!.count, 1);
    state.refresh(now + 9600); assert.equal(state.snapshot().combo.length, 0);
    assert.equal(state.apply('b', 'taser', false, now + 9600), true);
    assert.equal(state.snapshot().active.find(e => e.worker === 'b')!.until, now + 15800);
    const restored = new ToyStore(storage);
    assert.equal(restored.snapshot().sulking.length, 0); assert.equal(restored.snapshot().combo.length, 0);
  }
  const state = new ToyStore();
  for(let i=0;i<6;i++) state.apply('a','feather',true,now+i*1100);
  state.refresh(now+15500);assert.equal(state.snapshot().sulking.length,0);
  assert.equal(state.apply('a','whip',false,now+15500),true);
  assert.equal(state.snapshot().combo[0]!.count,1);
  state.spin(true,true,now); assert.equal(state.snapshot().oiiaMegaSpins,1); assert.equal(state.snapshot().catSpin.audience,true);
  state.clear(); assert.equal(state.snapshot().sulking.length,0); assert.equal(state.snapshot().catSpin.started,0);
});

test('W-18b impact hold lasts 70ms, combos intensify knockback, and sulking restores facing', async () => {
  const { reactToToy } = await import('../characters/reaction');
  const base = { y: 0, sx: 1, sy: 1, sz: 1, rx: 0, ry: 0, rz: 0, closed: false, effect: null, effectY: 0, sparkle: 1 };
  const reaction = { tool: 'whip' as const, started: 10000, combo: 3, sulkUntil: 21000 };
  assert.deepEqual(reactToToy(base,reaction,10680),reactToToy(base,reaction,10749));
  assert(reactToToy(base,reaction,10850).x > reactToToy(base,{...reaction,combo:1},10850).x);
  assert.equal(reactToToy(base,reaction,13000).frame.ry,Math.PI);
  assert.equal(reactToToy(base,reaction,21000).frame.ry,0);
});
