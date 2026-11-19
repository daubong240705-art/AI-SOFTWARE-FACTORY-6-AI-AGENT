import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const mode = process.argv[2];
const home = join(homedir(), '.factory');
const projectFile = join(home, 'run', 'smoke-project');
const origin = 'http://127.0.0.1:8787';
let session = '';
let csrf = '';

async function api(path, body) {
  const headers = session ? { cookie: session } : {};
  if (body) Object.assign(headers, { origin, 'x-csrf-token': csrf, 'content-type': 'application/json' });
  const response = await fetch(origin + path, { headers, signal: AbortSignal.timeout(5000),
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`${body?.type ?? path}: HTTP ${response.status}, ${data.error?.code ?? 'failed'}`);
  if (path === '/auth/session') session = response.headers.get('set-cookie')?.split(';')[0] ?? session;
  return data;
}

async function wait(check, description, seconds = 60) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(500);
  }
  throw new Error(`Timed out: ${description}`);
}

async function runFlow(projectId, agentId, mockAgents) {
  const command = (type, payload) => api('/commands', { apiVersion: 1, commandId: randomUUID(), projectId, type, payload });
  const flowId = randomUUID();
  const runId = randomUUID();
  const title = mockAgents ? 'Install smoke' : 'Model smoke';
  const instructions = mockAgents ? 'Do work' : 'Use the workspace tool to write factory-model-smoke.txt containing FACTORY_MODEL_OK, then finish.';
  const edge = (from, to) => ({ id: `${from}-out-${to}`, from: { node: from, port: 'out' }, to: { node: to }, loopBack: false });
  await command('flows.create', { flowId, definition: { schema: 2, key: mockAgents ? 'install-smoke' : 'model-smoke', title,
    nodes: [
      { id: 'start', type: 'trigger', title: 'Start', trigger: { kind: 'manual' } },
      { id: 'work', type: 'agent', title: 'Work', agent: { agent: agentId },
        task: { title, instructions, acceptance: [mockAgents ? 'Complete the work' : 'Create the requested file'], inputs: [] } },
      { id: 'done', type: 'output', title: 'Done', target: 'artifact', from: ['nodes.work.output'] },
    ], edges: [edge('start', 'work'), edge('work', 'done')] } });
  await command('flows.publish', { flowId, expectedRevision: 1 });
  await command('flow-runs.start', { flowId, runId, version: 'published', test: mockAgents, mockAgents });
  let taskId;
  await wait(async () => {
    const { run, nodeRuns } = await api(`/projects/${projectId}/flow-runs/${runId}`);
    assert.ok(!['failed', 'canceled', 'cancelled'].includes(run.state), `Workflow run ${run.state}`);
    taskId = nodeRuns.find(node => node.nodeId === 'work')?.taskId;
    return run.state === 'succeeded';
  }, `${title} run`, mockAgents ? 60 : 240);
  assert.ok(taskId, 'Agent node created a task');
  const { attempts } = await api(`/projects/${projectId}/tasks/${taskId}/attempts`);
  assert.ok(attempts.some(attempt => attempt.runtime === (mockAgents ? 'fake' : 'api-agent') && attempt.state === 'succeeded'), 'Expected successful dispatch attempt');
}

async function smoke() {
  await wait(async () => { try { await api('/health'); return true; } catch { return false; } }, 'Host health');
  ({ csrfToken: csrf } = await api('/auth/session'));
  assert.ok(session && csrf, 'Open login did not establish a session');
  if (mode === 'create') {
    const projectId = randomUUID();
    const root = join(home, 'projects', 'install-smoke');
    mkdirSync(root, { recursive: true });
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', 'Smoke fixture']);
    await api('/commands', { apiVersion: 1, commandId: randomUUID(), projectId, type: 'projects.create',
      payload: { name: 'Install smoke', workspace: { kind: 'git', root } } });
    const { agents } = await api(`/projects/${projectId}/agents`);
    assert.ok(agents.length, 'Project did not inherit agents');
    await runFlow(projectId, agents[0].id, true);
    writeFileSync(projectFile, projectId, { mode: 0o600 });
  } else {
    const projectId = readFileSync(projectFile, 'utf8');
    const { project } = await api(`/projects/${projectId}`);
    assert.equal(project.id, projectId);
    if (mode === 'model') {
      const agentId = randomUUID();
      await api('/commands', { apiVersion: 1, commandId: randomUUID(), projectId, type: 'agents.create',
        payload: { agentId, config: { name: 'Model Smoke', role: 'Writer', runtime: { adapter: 'api-agent', model: process.env.FACTORY_TEST_MODEL } } } });
      await runFlow(projectId, agentId, false);
      const worktrees = join(home, 'worktrees');
      assert.ok(readdirSync(worktrees, { recursive: true }).some(path => path.endsWith('/factory-model-smoke.txt') &&
        existsSync(join(worktrees, path)) && readFileSync(join(worktrees, path), 'utf8').includes('FACTORY_MODEL_OK')), 'Agent did not write the requested file');
    }
  }
}

try {
  if (mode === 'doctor') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const report = JSON.parse(Buffer.concat(chunks).toString());
    const checks = Array.isArray(report) ? report : report.checks;
    for (const code of ['D-NODE', 'D-STATE', 'D-GIT', 'D-UI']) {
      const check = Array.isArray(checks) ? checks.find(item => (item.code ?? item.id) === code) : checks?.[code];
      assert.ok(check === 'pass' || check?.ok === true || check?.status?.toLowerCase() === 'pass', `${code} did not pass`);
    }
  } else {
    assert.ok(['create', 'persist', 'model'].includes(mode), 'Unknown smoke mode');
    await smoke();
  }
} catch (error) {
  console.error(error instanceof Error && mode !== 'model' ? error.message : 'Model smoke failed');
  process.exitCode = 1;
}
