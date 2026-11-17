// Run after npm run build. Fixtures stay inside factory-host and npm is forced offline.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = fs.mkdtempSync(join(app, '.dep-cache-smoke-'));
const originalSpawn = cp.spawn, priorDisabled = process.env.FACTORY_DEP_CACHE;
let installs = 0;
cp.spawn = function (command, args, options) {
  if (command === 'npm' && args[0] === 'ci') {
    installs++;
    assert.deepEqual(args, ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline']);
    assert.equal(options.env.npm_config_userconfig, join(options.env.HOME, '.npmrc'));
    assert.equal(options.env.npm_config_globalconfig, '/dev/null');
    assert.equal(options.env.NODE_OPTIONS, undefined);
    assert.deepEqual(fs.readdirSync(options.cwd).sort(), ['package-lock.json', 'package.json']);
    options = { ...options, env: { ...options.env, npm_config_offline: 'true' } };
  }
  return originalSpawn.call(this, command, args, options);
};
syncBuiltinESMExports();
try {
  delete process.env.FACTORY_DEP_CACHE;
  const { createDependencyCache } = await import('../dist/deps/cache.js');
  const { patchIsSafeToApply } = await import('../dist/workspace/evidence.js');
  const local = join(scratch, 'tiny'); fs.mkdirSync(local);
  fs.writeFileSync(join(local, 'package.json'), JSON.stringify({ name: 'tiny-local', version: '1.0.0', main: 'index.js', scripts: { postinstall: 'exit 99' } }));
  fs.writeFileSync(join(local, 'index.js'), 'module.exports = "original";\n');
  const archive = join(scratch, 'tiny.tgz');
  cp.execFileSync('tar', ['-czf', archive, '--transform=s,^,package/,', '-C', local, 'package.json', 'index.js'], { stdio: 'ignore' });
  const integrity = `sha512-${createHash('sha512').update(fs.readFileSync(archive)).digest('base64')}`;
  const manifest = { name: 'cache-smoke', version: '1.0.0', dependencies: { 'tiny-local': `file:${archive}` } };
  function lock(version = '1.0.0') {
    return JSON.stringify({ name: 'cache-smoke', version, lockfileVersion: 3, requires: true, packages: {
      '': { ...manifest, version }, 'node_modules/tiny-local': { version: '1.0.0', resolved: `file:${archive}`, integrity, hasInstallScript: true },
    } });
  }
  function worktree(name, contents = lock()) {
    const dir = join(scratch, name); fs.mkdirSync(dir);
    fs.writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
    fs.writeFileSync(join(dir, 'package-lock.json'), contents); return dir;
  }
  const key = (contents) => createHash('sha256').update(contents).update(`\0node-${process.versions.node.split('.')[0]}`).digest('hex');
  const state = join(scratch, 'state'), root = join(state, 'dep-cache');
  const abandoned = join(root, '.partial-abandoned'); fs.mkdirSync(abandoned, { recursive: true });
  fs.writeFileSync(join(abandoned, 'leftover'), 'partial');
  const cache = createDependencyCache(state);
  assert.equal(fs.existsSync(abandoned), false, 'startup removes partials');
  const first = worktree('attempt-1'), second = worktree('attempt-2');
  const firstResults = await Promise.all([cache.prepare(first), cache.prepare(second)]);
  assert.ok(firstResults.every((r) => r.used), 'concurrent miss materialises both worktrees');
  assert.equal(installs, 1, 'concurrent miss installs once');
  const third = worktree('attempt-3'); assert.equal((await cache.prepare(third)).used, true);
  assert.equal(installs, 1, 'subsequent hit never runs npm');
  const cachedFile = join(root, key(lock()), 'node_modules/tiny-local/index.js');
  const agentFile = join(first, 'node_modules/tiny-local/index.js');
  assert.notEqual(fs.statSync(agentFile).ino, fs.statSync(cachedFile).ino, 'no shared hardlinks');
  assert.ok(fs.statSync(agentFile).mode & 0o200, 'agent copy is writable');
  fs.writeFileSync(agentFile, 'agent edit\n');
  assert.equal(fs.readFileSync(cachedFile, 'utf8'), 'module.exports = "original";\n');
  assert.equal(fs.readFileSync(join(second, 'node_modules/tiny-local/index.js'), 'utf8'), 'module.exports = "original";\n');
  assert.equal((await cache.prepare(first)).used, true, 'reused worktree gets fresh dependencies');
  assert.equal(fs.readFileSync(agentFile, 'utf8'), fs.readFileSync(cachedFile, 'utf8'));
  assert.equal((await cache.prepare(worktree('different-lock', lock('1.0.1')))).used, true); assert.equal(installs, 2);
  assert.ok(fs.existsSync(join(root, key(lock('1.0.1')), 'node_modules')));
  for (let i = 2; i < 8; i++) assert.equal((await cache.prepare(worktree(`lru-${i}`, lock(`1.0.${i}`)))).used, true);
  const entries = () => fs.readdirSync(root).filter((name) => /^[a-f0-9]{64}$/.test(name));
  assert.equal(entries().length, 8);
  for (let i = 0; i < 8; i++) fs.utimesSync(join(root, key(lock(`1.0.${i}`))), new Date(1000 + i), new Date(1000 + i));
  assert.equal((await cache.prepare(third)).used, true);
  assert.equal((await cache.prepare(worktree('lru-ninth', lock('1.0.8')))).used, true);
  assert.equal(entries().length, 8);
  assert.ok(fs.existsSync(join(root, key(lock()))), 'cache hit refreshes LRU');
  assert.equal(fs.existsSync(join(root, key(lock('1.0.1')))), false, 'oldest entry evicted');
  const bad = worktree('bad-lock', '{'), failedBefore = installs;
  assert.ok((await Promise.all([cache.prepare(bad), cache.prepare(bad)])).every((r) => !r.used && r.warning));
  assert.equal(installs, failedBefore + 1, 'failed concurrent miss also installs once');
  assert.equal(fs.existsSync(join(bad, 'node_modules')), false);
  assert.equal(fs.readdirSync(root).some((name) => name.startsWith('.partial-')), false);
  process.env.FACTORY_DEP_CACHE = '0';
  const disabledState = join(scratch, 'disabled-state'), disabled = worktree('disabled'), before = installs;
  assert.deepEqual(await createDependencyCache(disabledState).prepare(disabled), { used: false });
  assert.deepEqual(await cache.prepare(disabled), { used: false }); assert.equal(installs, before);
  assert.equal(fs.existsSync(disabledState), false, 'disabled mode creates no state');
  assert.equal(fs.existsSync(join(disabled, 'node_modules')), false);
  assert.equal(patchIsSafeToApply('diff --git a/node_modules/foo.js b/node_modules/foo.js\nnew file mode 100644\n--- /dev/null\n+++ b/node_modules/foo.js\n@@ -0,0 +1 @@\n+dependency\n').ok, false);
  console.log('dep-cache smoke passed: miss/concurrency, hit, isolation, new lock, LRU, failure, startup cleanup, disable, patch safety');
} finally {
  cp.spawn = originalSpawn; syncBuiltinESMExports();
  if (priorDisabled === undefined) delete process.env.FACTORY_DEP_CACHE; else process.env.FACTORY_DEP_CACHE = priorDisabled;
  fs.rmSync(scratch, { recursive: true, force: true });
}
