import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startHost } from '../../factory-host/dist/host.js';

const uiDir = fileURLToPath(new URL('../dist/', import.meta.url));
const runDir = fileURLToPath(new URL('./.run/', import.meta.url));
try { await access(join(uiDir, 'index.html')); }
catch { throw new Error('Built UI missing: run npm run e2e:ui-build in apps/factory-ui first.'); }
const port = Number(process.env.E2E_PORT ?? 8791);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('E2E_PORT must be a valid TCP port.');

/** @type {import('../../factory-host/dist/models/gateway.js').ModelGateway} */
const modelGateway = {
  providerId: 'fake',
  async complete(request) {
    request.signal?.throwIfAborted();
    const last = request.messages.at(-1)?.content ?? '';
    let text = 'Hello from the fake Lead.';
    if (last.includes('PLAN-PLEASE')) {
      const plan = { tasks: [{ title: 'Write the README section',
        goal: 'Document the project in a README section.', acceptance: ['README has a section'],
        expectedFiles: 1, requiredCapabilities: ['docs.markdown', 'test.unit'],
        placement: 'repo-bound', sideEffect: 'artifact', reviewPolicy: 'human-final', dependsOn: [] }] };
      text = `I propose a README task for your review.\n\n\`\`\`factory-plan\n${JSON.stringify(plan)}\n\`\`\``;
    } else if (last.includes('XSS-PLEASE')) {
      text = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script> hello';
    } else if (last.includes('SLOW-PLEASE')) {
      await delay(1500, undefined, { signal: request.signal });
    }
    return { text, usage: { inputTokens: 1200, cachedInputTokens: 0, outputTokens: 80, reasoningOutputTokens: 0 },
      finishReason: 'stop', provider: 'fake', model: request.model };
  },
};

const stateDir = await mkdtemp(join(tmpdir(), 'factory-ui-e2e-'));
let host;
let closing;
let stopPoll;
let starting = Promise.resolve();
function cleanup() {
  closing ??= (async () => {
    clearInterval(stopPoll);
    try { await host?.close(); }
    finally {
      await rm(stateDir, { recursive: true, force: true });
      await rm(join(runDir, 'host.json'), { force: true });
      await rm(join(runDir, 'stop'), { force: true });
    }
  })();
  return closing;
}
// Register before startup so an interrupted startup also releases its temporary state.
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void (async () => { await starting.catch(() => {}); await cleanup(); })()
    .then(() => process.exit(0), () => process.exit(1));
});
await mkdir(runDir, { recursive: true });
await rm(join(runDir, 'stop'), { force: true });
starting = startHost({ stateDir, port, uiDir, keepAliveMs: 2000, modelGateway,
  // Omit budgetConfig to use the Host's DEFAULT_BUDGET_CONFIG.
  onBootstrapToken(token) {
    // The one-time test token is written only here; never send it to stdout/stderr.
    writeFileSync(join(runDir, 'host.json'), JSON.stringify({ port, token }), { mode: 0o600 });
  },
});
try {
  host = await starting;
  // Windows process-tree termination cannot deliver POSIX signals. Let Playwright's
  // global teardown request the same graceful cleanup before it stops the webServer.
  stopPoll = setInterval(() => {
    void access(join(runDir, 'stop')).then(() => cleanup().then(() => process.exit(0)), () => {});
  }, 100);
  stopPoll.unref();
  console.log(`E2E Host ready on http://127.0.0.1:${port} (deterministic fake model)`);
} catch {
  await cleanup();
  throw new Error('E2E Host failed to start. Check the Host build, UI build, and loopback port.');
}
