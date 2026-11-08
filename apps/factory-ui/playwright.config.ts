import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testIgnore: 'work/**', // needs the WSL Host: see playwright.work.config.ts
  globalTeardown: './e2e/teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: 'e2e/.results',
  use: {
    baseURL: 'http://127.0.0.1:8791',
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: 'node e2e/host.mjs',
    url: 'http://127.0.0.1:8791/health',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
