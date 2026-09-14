import { defineConfig, devices } from '@playwright/test'

// Static-demo verification only (see .agents/edunova/static-demo-plan.md). No backend to start —
// `npm run dev` (Vite) is the only server this needs; the mock backend lives entirely in the browser.
export default defineConfig({
  testDir: './e2e',
  // Dev-mode Vite serving 200+ unbundled modules can be genuinely slow to boot per page load,
  // especially the first cold navigation of a run — most specs' own `expect(...).toHaveURL(/\/portal/,
  // { timeout: 10_000 })` calls after login were timing out on that, not on anything app-level being
  // broken (retrying in isolation always passed). Global defaults below give real headroom without
  // editing every spec's hardcoded per-call timeout.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5183',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  webServer: {
    command: 'npx vite --port 5183 --strictPort',
    url: 'http://localhost:5183',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
