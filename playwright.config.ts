import { defineConfig, devices } from '@playwright/test'

// Lean e2e smoke suite (Phase 10 §3). Assumes the frontend (:3000) and backend (:4000) dev servers
// are already running — this config does NOT manage their lifecycle (no `webServer`), since other
// processes/agents own those. Run `npm run e2e` after starting `npm run dev` and `npm run server:dev`.
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false, // tests share one school's data via API reset — keep them sequential
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
