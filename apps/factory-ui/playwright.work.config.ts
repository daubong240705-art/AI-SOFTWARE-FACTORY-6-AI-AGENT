import { defineConfig, devices } from '@playwright/test';

// End-to-end against a REAL Host running in WSL (real OpenCode in the bubblewrap sandbox, fake model, real git).
// Start the Host first: node e2e/work-host.mjs (inside WSL), then pass E2E_WORK_TOKEN and optionally E2E_WORK_URL.
export default defineConfig({
  testDir: 'e2e/work',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  outputDir: 'e2e/.results-work',
  use: {
    baseURL: process.env.E2E_WORK_URL ?? 'http://127.0.0.1:8812',
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
});
