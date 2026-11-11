import { access, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export default async function teardown(): Promise<void> {
  // This sentinel contains no auth data. It avoids force-killing the Host on Windows,
  // which would bypass SIGTERM cleanup and leak its temporary SQLite directory.
  await writeFile(new URL('./.run/stop', import.meta.url), 'stop');
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await access(new URL('./.run/host.json', import.meta.url)); }
    catch { return; }
    await delay(100);
  }
  throw new Error('E2E Host did not finish graceful cleanup within 10 seconds.');
}
