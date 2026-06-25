import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config for VallaPOS — the first end-to-end smoke harness.
 *
 * These tests are NOT run by `npm test` (Vitest, unit-only). Run them with
 * `npm run test:e2e` against a running app. See `e2e/README.md` for the full
 * prerequisites (seed the DB, start the app, install the chromium browser).
 *
 * The app must already be running and reachable at `E2E_BASE_URL` (default
 * http://localhost:3000) — start it with `npm run dev` (or point at a deployed
 * URL). We intentionally do NOT spawn a `webServer` here: the app needs a live
 * Postgres + seeded login that this harness can't provision, so the runner
 * assumes the operator has stood the app up themselves.
 */

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  // CI gets retries + serial run; locally fail fast and run in parallel.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // Generous but bounded: the critical path signs in, rings up, and checks out.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    // Gitignored (see .gitignore). `open: "never"` so a CI/headless run never
    // tries to launch a browser to show the report.
    ["html", { outputFolder: ".playwright/report", open: "never" }],
  ],
  // Per-test artifacts (traces/screenshots/videos) — gitignored.
  outputDir: "./test-results",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
