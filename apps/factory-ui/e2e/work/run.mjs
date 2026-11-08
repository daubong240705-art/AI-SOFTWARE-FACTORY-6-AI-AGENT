// Windows orchestrator: starts the REAL Host inside WSL (e2e/work-host.mjs), runs the Playwright suite against it and stops it.
//   npm run e2e:work            (prerequisites: npm run e2e:ui-build, scripts/factory-v2/deploy-host-wsl.sh)
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const script = fileURLToPath(new URL('../work-host.mjs', import.meta.url));
const wslPath = script.replace(/^([A-Za-z]):\\/, (_m, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/');
const host = spawn('wsl.exe', ['-e', 'bash', '-c', `export PATH=$HOME/factory-v2/node/bin:$PATH; exec node ${wslPath}`], { stdio: ['ignore', 'pipe', 'inherit'] });
let exiting = false;
const stop = () => {
  if (exiting) return; exiting = true;
  // The bracket keeps pkill from matching its own command line.
  spawnSync('wsl.exe', ['-e', 'bash', '-c', 'pkill -TERM -f "[w]ork-host.mjs"; sleep 2; pkill -KILL -f "[w]ork-host.mjs" || true'], { stdio: 'ignore' });
  host.kill();
};
process.on('SIGINT', () => { stop(); process.exit(130); });
const info = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('The WSL Host did not report in time.')), 60_000);
  createInterface({ input: host.stdout }).once('line', (line) => { clearTimeout(timer); try { resolve(JSON.parse(line)); } catch { reject(new Error('Unexpected Host output.')); } });
  host.once('exit', () => reject(new Error('The WSL Host exited early.')));
}).catch((error) => { console.error(error.message); stop(); process.exit(1); });

const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test', '-c', 'playwright.work.config.ts', ...process.argv.slice(2)], {
  stdio: 'inherit', shell: process.platform === 'win32',
  env: { ...process.env, E2E_WORK_TOKEN: info.token, E2E_WORK_URL: `http://127.0.0.1:${info.port}`, E2E_WORK_CLONE: info.cloneRoot, E2E_WORK_REMOTE: info.remoteGit },
});
stop();
process.exit(result.status ?? 1);
