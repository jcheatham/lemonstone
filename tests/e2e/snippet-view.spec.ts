// E2E for the <ls-snippet> view (CodeMirror editor + preview + console +
// network consent). Playwright CSS locators pierce the open shadow root, so we
// can assert on the component's internals directly. The harness
// (tests/e2e/fixtures/snippet-view-harness.html) default-mounts a snippet that declares
// connect-src https://api.github.com with no grant. See docs/snippets.md.
import { test, expect } from "@playwright/test";

test.describe("ls-snippet view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/tests/e2e/fixtures/snippet-view-harness.html");
    await expect(page.locator("ls-snippet")).toBeVisible();
  });

  test("mounts a CodeMirror source editor and a preview iframe", async ({ page }) => {
    await expect(page.locator("ls-snippet .cm-editor")).toBeVisible();
    await expect(page.locator("ls-snippet .preview-host iframe")).toBeAttached();
  });

  test("renders the snippet's DOM at a nonzero, content-fitted height", async ({ page }) => {
    // Regression guard: the inner (srcdoc) frame must be grown to fit its
    // content, not left at height:0 — otherwise scripts run but nothing shows.
    const outer = page.frameLocator("ls-snippet .preview-host iframe");
    // The snippet's own markup is visible inside the nested frame…
    await expect(outer.frameLocator("iframe").locator("h1")).toBeVisible();
    // …and the inner frame element itself has real height.
    const innerFrameEl = outer.locator("iframe");
    const box = await innerFrameEl.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(20);
  });

  test("captures console output from the running snippet", async ({ page }) => {
    await expect(page.locator("ls-snippet .console-list")).toContainText("net demo loaded");
  });

  test("prompts for consent when a snippet declares an ungranted origin", async ({ page }) => {
    await expect(page.locator("ls-snippet .consent")).toHaveClass(/show/);
    await expect(page.locator("ls-snippet .consent .origins")).toContainText("api.github.com");
    // Blocked until granted.
    await expect(page.locator("ls-snippet .console-list")).toContainText("connect-src");
  });

  test("granting network access re-runs and allows the fetch", async ({ page }) => {
    await page.route("https://api.github.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/plain", body: "MOCKED ZEN" })
    );
    await page.locator("ls-snippet .consent .allow").click();
    await expect(page.locator("ls-snippet .consent")).not.toHaveClass(/show/);
    await expect(page.locator("ls-snippet .console-list")).toContainText("FETCH_OK: MOCKED ZEN");
  });

  test("collapses to a Source/Preview toggle when narrow", async ({ page }) => {
    await page.evaluate(() => (window as unknown as { setW: (w: number) => void }).setW(480));
    await expect(page.locator("ls-snippet")).toHaveClass(/narrow/);
    await expect(page.locator("ls-snippet .seg")).toBeVisible();
    await page.locator('ls-snippet .seg button[data-mode="preview"]').click();
    await expect(page.locator("ls-snippet")).toHaveClass(/show-preview/);
  });
});
