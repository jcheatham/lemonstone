// E2E for the opaque-origin snippet sandbox itself (raw harness). These assert
// the security-critical browser behaviors that happy-dom can't: real CSP
// enforcement, resource blocking, and cross-origin isolation. Run in Chromium
// and WebKit (see playwright.config.ts). See docs/snippets.md.
import { test, expect } from "@playwright/test";

const log = "#log";

test.describe("snippet sandbox", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/spike-snippet.html");
    await expect(page.locator(log)).toContainText("host ready");
  });

  test("runs a self-contained tool and captures console", async ({ page }) => {
    await page.click("#btn-tool");
    await expect(page.locator(log)).toContainText("tool booted");
    await expect(page.locator(log)).toContainText("crypto?");
  });

  test("blocks an external <script src>", async ({ page }) => {
    await page.click("#btn-ext");
    // A CSP violation is surfaced (script-src / default-src).
    await expect(page.locator(log)).toContainText("csp");
    await expect(page.locator(log)).toContainText(/script-src|default-src/);
  });

  test("blocks an ungranted fetch via connect-src", async ({ page }) => {
    await page.click("#btn-fetch-deny");
    await expect(page.locator(log)).toContainText("connect-src");
  });

  test("allows a granted fetch (per-snippet connect-src widening)", async ({ page }) => {
    // Mock the granted origin so the test is hermetic and offline-safe.
    await page.route("https://api.github.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/plain", body: "MOCKED ZEN" })
    );
    await page.click("#btn-fetch-allow");
    await expect(page.locator(log)).toContainText("MOCKED ZEN");
    // And it must NOT have been a connect-src violation.
    await expect(page.locator(log)).not.toContainText("csp: connect-src");
  });

  test("cannot reach the parent window, storage, or cookies", async ({ page }) => {
    await page.click("#btn-probe");
    await expect(page.locator(log)).toContainText("parent.SECRET_TOKEN BLOCKED");
    await expect(page.locator(log)).toContainText(/localStorage BLOCKED|indexedDB BLOCKED/);
  });
});
