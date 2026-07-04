import { defineConfig, devices } from "@playwright/test";

// E2E config. Today it covers the snippet sandbox (the one feature with
// security-critical browser behavior that unit tests in happy-dom cannot
// exercise — real CSP enforcement, opaque-origin isolation, per-snippet
// connect-src). M11 can broaden testDir coverage to the whole app.
//
// Tests drive the dev-only harness pages (spike-snippet.html /
// spike-snippet-view.html), which are served by `npm run dev` and excluded from
// the production build.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "line" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173/spike-snippet.html",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
