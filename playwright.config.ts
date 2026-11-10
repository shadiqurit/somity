import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://localhost:5174', headless: true, trace: 'retain-on-failure', channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' },
  webServer: [
    { command: 'node scripts/e2e-api.mjs', url: 'http://127.0.0.1:4100/api/health', reuseExistingServer: false, timeout: 30000 },
    { command: 'npm run dev -w frontend -- --port 5174 --strictPort', url: 'http://localhost:5174', env: { VITE_PROXY_TARGET: 'http://127.0.0.1:4100' }, reuseExistingServer: false, timeout: 30000 },
  ],
});
