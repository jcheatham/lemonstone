// E2E for <ls-file-tree>'s context menu (right-click / long-press / "..."),
// the categorized command menu it builds from the app's command registry,
// and drag-to-move. Playwright CSS locators pierce open shadow roots, so we
// assert on shadow-DOM internals directly. The harness
// (tests/e2e/fixtures/file-tree-harness.html) mounts a fixed
// note/folder/zone/command fixture — see
// tests/e2e/fixtures/file-tree-harness.ts.
import { test, expect, devices } from "@playwright/test";

test.describe("ls-file-tree context menu", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/tests/e2e/fixtures/file-tree-harness.html");
    await expect(page.locator("ls-file-tree")).toBeVisible();
  });

  test("right-click on a file shows only File-category items", async ({ page }) => {
    await page.locator("ls-file-tree .file-item").first().click({ button: "right" });
    const menu = page.locator("ls-file-tree ls-context-menu .menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".group-header")).toHaveText(["File"]);
    await expect(menu.locator(".menu-item")).toHaveText(["Rename", "Move file…", "Delete file"]);
  });

  test("right-click on a folder shows Create and Folder groups", async ({ page }) => {
    await page.locator('ls-file-tree .folder-label[data-folder-label="projects"]').click({ button: "right" });
    const menu = page.locator("ls-file-tree ls-context-menu .menu");
    await expect(menu.locator(".group-header")).toHaveText(["Create", "Folder"]);
    await expect(menu.locator(".menu-item")).toHaveText([
      "New note here",
      "New canvas here",
      "New snippet here",
      "New folder here",
      "Rename",
      "Rename folder…",
      "Move folder…",
      "Delete folder…",
      "Encrypt folder…",
    ]);
  });

  test("the folder row has no '+' button — creation lives in the context menu", async ({ page }) => {
    const label = page.locator('ls-file-tree .folder-label[data-folder-label="projects"]');
    await expect(label.locator(".new-btn")).toHaveCount(0);
    await expect(label.locator(".row-menu-btn")).toHaveCount(1);
  });

  test("the header '+' still opens the root-level new-file menu", async ({ page }) => {
    await page.locator("ls-file-tree .tree-header button").click();
    await expect(page.locator("ls-file-tree .new-menu")).toHaveClass(/visible/);
  });

  test("choosing 'Rename' from a folder's menu starts inline rename", async ({ page }) => {
    await page.locator('ls-file-tree .folder-label[data-folder-label="projects"]').click({ button: "right" });
    // Exact match — the same menu also has a "Rename folder…" registry item.
    await page.locator("ls-file-tree ls-context-menu .menu-item", { hasText: /^Rename$/ }).click();
    await expect(page.locator("ls-file-tree .rename-input")).toBeVisible();
  });

  test("choosing 'New note here' starts an inline create row", async ({ page }) => {
    await page.locator('ls-file-tree .folder-label[data-folder-label="projects"]').click({ button: "right" });
    await page.locator("ls-file-tree ls-context-menu .menu-item", { hasText: "New note here" }).click();
    await expect(page.locator("ls-file-tree .new-row input")).toBeVisible();
  });

  test("choosing a registry command fires file-command with the clicked target, not the active note", async ({ page }) => {
    await page.locator('ls-file-tree .folder-label[data-folder-label="projects"]').click({ button: "right" });
    await page.locator("ls-file-tree ls-context-menu .menu-item", { hasText: "Delete folder…" }).click();
    await expect(page.locator("#log")).toContainText(
      'file-command: {"id":"delete-folder","path":"projects","kind":"folder"}'
    );
  });

  test("the '...' button opens the same menu as right-click", async ({ page }) => {
    const row = page.locator("ls-file-tree .file-item").first();
    await row.hover();
    await row.locator(".row-menu-btn").click();
    await expect(page.locator("ls-file-tree ls-context-menu .menu")).toBeVisible();
    await expect(page.locator("ls-file-tree ls-context-menu .menu-item")).toHaveText([
      "Rename",
      "Move file…",
      "Delete file",
    ]);
  });

  test("Escape and outside click both dismiss the menu", async ({ page }) => {
    const menu = page.locator("ls-file-tree ls-context-menu");
    await page.locator("ls-file-tree .file-item").first().click({ button: "right" });
    await expect(menu).toHaveClass(/open/);
    await page.keyboard.press("Escape");
    await expect(menu).not.toHaveClass(/open/);

    await page.locator("ls-file-tree .file-item").first().click({ button: "right" });
    await expect(menu).toHaveClass(/open/);
    // The outside-click dismiss listener is registered a tick after open()
    // (so the opening click itself doesn't immediately self-close the menu —
    // see ls-context-menu.ts). A real click always lands well after that
    // tick; a synthetic click fired immediately can race it, so give it a
    // moment here.
    await page.waitForTimeout(50);
    await page.mouse.click(5, 690);
    await expect(menu).not.toHaveClass(/open/);
  });

  test("row menu button is hover-revealed on desktop, always visible on touch", async ({ page, browser, browserName }) => {
    const btn = page.locator("ls-file-tree .file-item").first().locator(".row-menu-btn");
    await expect(btn).toHaveCSS("opacity", "0");
    await page.locator("ls-file-tree .file-item").first().hover();
    await expect(btn).toHaveCSS("opacity", "1");

    test.skip(browserName === "firefox", "Firefox doesn't support mobile-device context emulation");
    const touchContext = await browser.newContext({ ...devices["iPhone 13"] });
    const touchPage = await touchContext.newPage();
    await touchPage.goto("/tests/e2e/fixtures/file-tree-harness.html");
    await expect(
      touchPage.locator("ls-file-tree .file-item").first().locator(".row-menu-btn")
    ).toHaveCSS("opacity", "1");
    await touchContext.close();
  });
});

test.describe("ls-file-tree drag-to-move", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/tests/e2e/fixtures/file-tree-harness.html");
    await expect(page.locator("ls-file-tree")).toBeVisible();
  });

  async function dragTo(
    page: import("@playwright/test").Page,
    from: import("@playwright/test").Locator,
    to: import("@playwright/test").Locator
  ): Promise<void> {
    const fromBox = (await from.boundingBox())!;
    const toBox = (await to.boundingBox())!;
    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 10 });
    await page.waitForTimeout(50);
    // A trailing jiggle past the drop point — some browsers need a couple of
    // pixels of post-dragover movement before they'll fire `drop`.
    await page.mouse.move(toBox.x + toBox.width / 2 + 1, toBox.y + toBox.height / 2 + 1, { steps: 2 });
    await page.mouse.up();
  }

  test("dragging a root file onto a folder moves it there", async ({ page }) => {
    await dragTo(
      page,
      page.locator('ls-file-tree .file-item[data-path="inbox.md"]'),
      page.locator('ls-file-tree .folder-label[data-folder-label="projects"]')
    );
    await expect(page.locator("#log")).toContainText(
      'file-rename: {"oldPath":"inbox.md","newPath":"projects/inbox.md"}'
    );
  });

  test("dragging a folder to the empty background moves it to the vault root", async ({ page }) => {
    await dragTo(
      page,
      page.locator('ls-file-tree .folder-label[data-folder-label="projects/secret"]'),
      page.locator("ls-file-tree .tree-scroll")
    );
    await expect(page.locator("#log")).toContainText(
      'folder-rename: {"oldPath":"projects/secret","newPath":"secret"}'
    );
  });

  test("dropping a folder onto its own descendant is a no-op", async ({ page }) => {
    // (Dropping a folder exactly onto itself has zero net displacement, which
    // is indistinguishable from a plain click — real browsers treat that as
    // toggling collapse, not a drag — so it isn't exercised as a drag here.
    // #isValidDropTarget's self-check is covered by unit-level reasoning:
    // it's the same string-prefix guard as the descendant check below.)
    await dragTo(
      page,
      page.locator('ls-file-tree .folder-label[data-folder-label="projects"]'),
      page.locator('ls-file-tree .folder-label[data-folder-label="projects/lemonstone"]')
    );
    await expect(page.locator("#log")).toBeEmpty();
  });

  test("dropping a file back onto its current parent is a no-op", async ({ page }) => {
    await dragTo(
      page,
      page.locator('ls-file-tree .file-item[data-path="projects/lemonstone/todo.md"]'),
      page.locator('ls-file-tree .folder-label[data-folder-label="projects/lemonstone"]')
    );
    await expect(page.locator("#log")).toBeEmpty();
  });
});
