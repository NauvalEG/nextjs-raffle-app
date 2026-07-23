import { defineConfig, devices } from "@playwright/test";

// E2E suite (E3-02 Features 1–4). Runs against a production build:
// `npm run build` must have been run before `npm run test:e2e`.
// Two-tab sync tests require pages sharing one browser context (BroadcastChannel).

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // journeys create real DB state; keep ordering deterministic
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
