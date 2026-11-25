import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { commandSchema, LIBRARY_SCOPE_ID, SYSTEM_SCOPE_ID } from '@factory/contracts';

const apiVersion = 1;
const id = () => randomUUID();

function config(name, role = 'Kiểm thử') {
  return { name, role, description: `Agent audit ${name}`, goals: ['Hoàn thành kiểm thử'], instructions: 'Làm việc theo yêu cầu kiểm thử.', workRules: [], tags: ['audit'], runtime: { adapter: 'fake', model: null, effort: 'low', permission: 'workspace-write', maxConcurrent: 1, timeoutMinutes: 5 }, skills: [], tools: null, delegation: { canAssign: 'none', canProposeAgents: false, maxDepth: 1, maxOpenSubtasks: 5 }, autonomy: null, budget: {} };
}

export class HostApi {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = ''; this.failures = []; }
  async request(path, options = {}) {
    const headers = { origin: this.base, ...(options.body ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...(options.headers ?? {}) };
    const response = await fetch(`${this.base}${path}`, { ...options, headers, signal: AbortSignal.timeout(5000) });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await response.text();
    let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (response.status >= 400) this.failures.push({ path, status: response.status });
    return { response, body };
  }
  async session() { const result = await this.request('/auth/session'); this.csrf = result.body?.csrfToken ?? ''; if (!this.cookie || !this.csrf) throw new Error(`Không thiết lập được phiên audit (HTTP ${result.response.status}).`); }
  async command(projectId, type, payload) {
    const command = commandSchema.parse({ apiVersion, commandId: id(), projectId, type, payload });
    const result = await this.request('/commands', { method: 'POST', headers: { 'x-csrf-token': this.csrf }, body: JSON.stringify(command) });
    if (!result.body?.ok) throw new Error(`${type}: ${result.body?.error?.message ?? result.body?.message ?? `HTTP ${result.response.status}`}`);
    return result.body.receipt ?? result.body;
  }
  async json(path) { const result = await this.request(path); if (!result.body || result.response.status >= 400) throw new Error(`${path}: HTTP ${result.response.status}`); return result.body; }
}

async function tryCommand(api, log, projectId, type, payload) {
  try { return await api.command(projectId, type, payload); }
  catch (error) { log.push({ type, error: String(error.message ?? error) }); return null; }
}

export async function waitForRun(api, project, runId, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const detail = await api.json(`/projects/${project}/flow-runs/${runId}`);
    if (predicate(detail)) return detail;
    if (['failed', 'cancelled', 'stalled', 'succeeded'].includes(detail.run.state)) throw new Error(`Lượt chạy dừng ở trạng thái ${detail.run.state}.`);
    await delay(300);
  }
  throw new Error('Hết thời gian chờ trạng thái lượt chạy.');
}

export function createTask(api, project, { title, code, ownerSeatId = null }) {
  const taskId = id();
  return api.command(project, 'tasks.create', { taskId, code, title, goal: 'Kiểm tra', brief: 'Việc mẫu cho audit', parentTaskId: null, engagementId: null, ownerSeatId, requiredCapabilities: [], placement: 'portable', sideEffect: 'none', reviewPolicy: 'human-final', requiresGo: true, acceptance: ['Xong'], inputs: [], dependsOn: [] }).then(() => taskId);
}

export async function seed({ base, projectsRoot }) {
  const api = new HostApi(base); const log = [];
  await api.session();
  const firstRoot = join(projectsRoot, 'audit-default-pack'); const secondRoot = join(projectsRoot, 'audit-no-extra-data');
  await Promise.all([firstRoot, secondRoot].map(root => mkdir(root, { recursive: true })));
  const project = id(); const emptyProject = id();
  const groups = { parent: id(), child: id() };
  await api.command(SYSTEM_SCOPE_ID, 'groups.create', { groupId: groups.parent, parentId: null, slug: 'audit-parent', name: 'Audit parent' });
  await api.command(SYSTEM_SCOPE_ID, 'groups.create', { groupId: groups.child, parentId: groups.parent, slug: 'audit-child', name: 'Audit child' });
  const projectNames = { primary: 'Audit · Gói mặc định', empty: 'Audit · Không dữ liệu thêm' };
  await api.command(project, 'projects.create', { name: projectNames.primary, groupId: groups.child, teamTemplate: 'software-team', workspace: { kind: 'directory', root: firstRoot } });
  await api.command(emptyProject, 'projects.create', { name: projectNames.empty, workspace: { kind: 'directory', root: secondRoot } });
  const agentResponse = await api.json(`/projects/${project}/agents`).catch(error => { log.push({ type: 'agents.read', error: String(error.message) }); return { agents: [], teams: [], relations: [], relationsRevision: 0 }; });
  const agents = agentResponse.agents ?? [];
  const detail = agents[0] ? await api.json(`/projects/${project}/agents/${agents[0].id}`).catch(() => null) : null;
  const baseConfig = detail?.config ?? config('Audit base');
  const paused = id(); const archived = id(); const fresh = id();
  await tryCommand(api, log, project, 'agents.create', { agentId: fresh, config: config('Audit Fresh') });
  await tryCommand(api, log, project, 'agents.create', { agentId: paused, config: config('Audit Paused') });
  await tryCommand(api, log, project, 'agents.create', { agentId: archived, config: config('Audit Archived') });
  await tryCommand(api, log, project, 'agents.update', { agentId: fresh, expectedRevision: 1, config: { ...config('Audit Fresh'), description: 'Mô tả phiên bản thứ hai' } });
  const pausedData = await api.json(`/projects/${project}/agents/${paused}`).catch(() => null);
  const archivedData = await api.json(`/projects/${project}/agents/${archived}`).catch(() => null);
  await tryCommand(api, log, project, 'agents.set-status', { agentId: paused, expectedRevision: pausedData?.revision ?? 1, status: 'paused' });
  await tryCommand(api, log, project, 'agents.set-status', { agentId: archived, expectedRevision: archivedData?.revision ?? 1, status: 'archived' });
  const liveAgents = [agents[0]?.id, fresh, paused].filter(Boolean);
  const team = id();
  await tryCommand(api, log, project, 'teams.create', { teamId: team, name: 'Đội audit', description: 'Đội dùng cho rà soát UI', leadAgentId: liveAgents[0] ?? null, memberIds: liveAgents });
  const relations = liveAgents.length >= 2 ? [{ from: liveAgents[0], to: liveAgents[1], kind: 'collaborates' }] : [];
  await tryCommand(api, log, project, 'relations.set', { expectedRevision: agentResponse.relationsRevision ?? 0, relations });
  const skill = id();
  await tryCommand(api, log, LIBRARY_SCOPE_ID, 'skills.create', { skillId: skill, name: 'audit-skill', description: 'Kỹ năng kiểm thử giao diện', content: '# Audit\nKiểm tra màn hình.', trust: 'instructions' });
  const template = id();
  await tryCommand(api, log, LIBRARY_SCOPE_ID, 'templates.create', { templateId: template, config: { ...baseConfig, name: 'Mẫu audit' }, description: 'Mẫu agent cho audit' });
  const flowId = id();
  const agentId = liveAgents[0] ?? fresh;
  const definition = { schema: 2, key: 'audit-flow', title: 'Quy trình audit', nodes: [
    { id: 'start', title: 'Bắt đầu', type: 'trigger', trigger: { kind: 'manual' } },
    { id: 'agent', title: 'Kiểm thử', type: 'agent', agent: { agent: agentId }, task: { title: 'Kiểm thử audit', instructions: 'Kiểm thử', acceptance: ['Có kết quả'], inputs: [] }, review: 'none' },
    { id: 'approval', title: 'Phê duyệt', type: 'approval', approver: 'operator', prompt: 'Duyệt kết quả audit' },
    { id: 'output', title: 'Kết quả', type: 'output', target: 'artifact', from: ['nodes.agent.output'] },
  ], edges: [
    { id: 'start-out-agent', from: { node: 'start', port: 'out' }, to: { node: 'agent' }, loopBack: false },
    { id: 'agent-out-approval', from: { node: 'agent', port: 'out' }, to: { node: 'approval' }, loopBack: false },
    { id: 'approval-approved-output', from: { node: 'approval', port: 'approved' }, to: { node: 'output' }, loopBack: false },
  ], settings: {}, inputs: [{ name: 'input', type: 'string', required: false }] };
  await tryCommand(api, log, project, 'flows.create', { flowId, definition });
  const flowBeforePublish = await api.json(`/projects/${project}/flows/${flowId}`).catch(() => null);
  await tryCommand(api, log, project, 'flows.publish', { flowId, expectedRevision: flowBeforePublish?.flow?.revision ?? 1 });
  const runs = { finished: id(), waiting: id() };
  let approval;
  for (const [kind, runId] of Object.entries(runs)) {
    const started = await tryCommand(api, log, project, 'flow-runs.start', { runId, flowId, version: 'published', test: true, inputs: { input: 'audit' }, mockAgents: true });
    if (!started) continue;
    try {
      const detail = await waitForRun(api, project, runId, item => item.nodeRuns.some(node => node.approvalId));
      const approvalId = detail.nodeRuns.find(node => node.approvalId).approvalId;
      if (kind === 'waiting') approval = approvalId;
      else {
        const { approval: item } = await api.json(`/projects/${project}/approvals/${approvalId}`);
        await api.command(project, 'approvals.decide', { approvalId, expectedRevision: item.revision, contextDigest: item.context.digest, optionId: 'approve', comment: 'Duyệt lần chạy mẫu' });
        await waitForRun(api, project, runId, result => result.run.state === 'succeeded');
      }
    } catch (error) { log.push({ type: `flow-runs.${kind}`, error: error.message }); }
  }
  const task = await createTask(api, project, { code: 'AU-001', title: 'Việc nháp audit' });
  for (const [index, target] of ['proposed', 'accepted'].entries()) {
    const taskId = await createTask(api, project, { code: `AU-00${index + 2}`, title: `Việc ${target === 'proposed' ? 'đề xuất' : 'đã chấp nhận'} audit` });
    await tryCommand(api, log, project, 'tasks.transition', { taskId, expectedRevision: 1, to: 'proposed' });
    if (target === 'accepted') await tryCommand(api, log, project, 'tasks.transition', { taskId, expectedRevision: 2, to: 'accepted' });
  }
  // Newest root span (the finished/waiting runs above write one) gives the Trace screen something to show.
  const trace = (await api.json(`/projects/${project}/traces?limit=1`).catch(error => { log.push({ type: 'traces.read', error: String(error.message) }); return { traces: [] }; })).traces[0]?.traceId ?? null;
  if (!trace) log.push({ type: 'traces.read', error: 'No trace was recorded for the seeded runs.' });
  return { projects: { primary: project, empty: emptyProject }, groups, agents: { primary: agentId, fresh, paused, archived }, team, skill, template, flow: flowId, runs, approval, task, trace, seedFailures: log, apiFailures: api.failures, api };
}
