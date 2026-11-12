// Runs INSIDE WSL (Linux, ext4). Starts the REAL Host (main.js) with FACTORY_RUNTIME=opencode, a local fake
// OpenAI-compatible upstream (no real model, no tokens), a git clone of a tiny source repo and a bare "remote"
// for the push effect. Prints one JSON line with { port, token, cloneRoot, remoteGit } and keeps running until SIGTERM.
//   node work-host.mjs   (env: E2E_WORK_PORT, E2E_WORK_DIR)
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { rmSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';

const home = homedir();
const BASE = process.env.E2E_WORK_DIR ?? `${home}/factory-v2/e2e-work`;
const APP = process.env.E2E_APP_DIR ?? `${home}/factory-v2/app/apps/factory-host/dist`;
const PORT = Number(process.env.E2E_WORK_PORT ?? 8812);
const REAL_KEY = 'sk-e2e-work-upstream-key-0123456789';
// E2E_WORK_KEEP=1 reuses the data of an earlier run (a demo with real projects, tasks and reviews).
const KEEP = process.env.E2E_WORK_KEEP === '1';
if (!KEEP) rmSync(BASE, { recursive: true, force: true });
for (const dir of ['src-repo', 'proxy', 'remote.git']) mkdirSync(`${BASE}/${dir}`, { recursive: true });
chmodSync(`${BASE}/proxy`, 0o700);
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' });
if (!KEEP) {
git(['init', '-q', '-b', 'main'], `${BASE}/src-repo`);
writeFileSync(`${BASE}/src-repo/README.md`, '# Demo project\n\nA tiny repository used by the end-to-end test.\n');
git(['add', '.'], `${BASE}/src-repo`);
git(['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', 'commit', '-qm', 'initial'], `${BASE}/src-repo`);
git(['init', '-q', '--bare'], `${BASE}/remote.git`);
}

// ---- fake model: scripted by what the request contains -------------------------------------------------------
const toolResults = (messages) => messages.filter((m) => m.role === 'tool').length;
const firstUser = (messages) => JSON.stringify(messages.find((m) => m.role === 'user')?.content ?? '');
const upstream = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let json = {};
    try { json = JSON.parse(body); } catch { /* ignore */ }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta, finish = null) => 'data: ' + JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: json.model,
      choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n';
    const call = (name, args) => {
      res.write(chunk({ role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_' + name, type: 'function', function: { name, arguments: '' } }] }));
      res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }));
      res.write(chunk({}, 'tool_calls'));
    };
    const text = (content) => { res.write(chunk({ role: 'assistant', content: '' })); res.write(chunk({ content })); res.write(chunk({}, 'stop')); };
    const tools = (json.tools ?? []).map((t) => t.function?.name);
    const messages = json.messages ?? [];
    const step = toolResults(messages);
    const prompt = firstUser(messages);
    const asks = prompt.includes('ASK-ME') && !prompt.includes('Decision from the operator');
    if (!tools.includes('write')) text('Notes task');
    else if (asks && step === 0) {
      call('factory_decision_request', { subject: 'Which format should the notes use?', summary: 'The task does not say whether the notes should be short or detailed.',
        options: [{ id: 'short', label: 'Short', consequence: 'A few lines.' }, { id: 'detailed', label: 'Detailed', consequence: 'A full page with sections.' }],
        recommendation: 'short', impactIfWaiting: 'The notes file is not written until you answer.' });
    } else if (step === 0) call('write', { filePath: 'AGENT-NOTES.md', content: '# Agent notes\n\nWritten by the agent inside the sandbox.\n' });
    else if (step === 1) call('factory_output_register', { title: 'Agent notes', kind: 'other', mediaType: 'text/markdown', path: 'AGENT-NOTES.md', abstractL0: 'Notes written by the agent.' });
    else if (step === 2) call('factory_task_progress', { summary: 'Notes written and registered', percent: 90 });
    else text('Added AGENT-NOTES.md and registered it as a deliverable.');
    res.write('data: ' + JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: json.model, choices: [], usage: { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const upstreamPort = upstream.address().port;

const clone = KEEP ? { root: `${BASE}/projects/demo` } : JSON.parse(execFileSync(process.execPath, [`${APP}/workspace/cli.js`, 'clone', '--projects-root', `${BASE}/projects`, '--name', 'Demo', '--source', `${BASE}/src-repo`], { encoding: 'utf8' }));
const env = { ...process.env, FACTORY_STATE_DIR: `${BASE}/state`, FACTORY_PORT: String(PORT), FACTORY_BACKUP_DIR: `${BASE}/backups`,
  FACTORY_PROJECTS_ROOT: `${BASE}/projects`, FACTORY_WORKTREES_ROOT: `${BASE}/worktrees`, FACTORY_RUNTIME: 'opencode', FACTORY_OPENCODE_DIR: `${home}/factory-v2/opencode`,
  FACTORY_PROXY_SOCKET: `${BASE}/proxy/model.sock`, NINE_ROUTER_API_KEY: REAL_KEY, FACTORY_GATEWAY_URL: `http://127.0.0.1:${upstreamPort}/v1`,
  FACTORY_AGENT_MODELS: 'approved-model', FACTORY_PUSH_REMOTES: `backup=file://${BASE}/remote.git` };
const host = spawn(process.execPath, [`${APP}/main.js`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
host.stdout.on('data', (d) => { out += d; }); host.stderr.on('data', (d) => { out += d; });
for (let i = 0; i < 150 && !/bootstrap token/i.test(out); i++) await new Promise((r) => setTimeout(r, 200));
const token = /bootstrap token: ([0-9a-f]+)/i.exec(out)?.[1];
if (!token) { console.error('Host did not start:', out.replaceAll(REAL_KEY, '<key>').slice(0, 600)); process.exit(1); }
console.log(JSON.stringify({ port: PORT, token, cloneRoot: clone.root, remoteGit: `${BASE}/remote.git`, base: BASE }));
const stop = () => { host.kill('SIGTERM'); upstream.close(); setTimeout(() => process.exit(0), 1500).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
host.on('exit', () => process.exit(0));
