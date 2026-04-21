// <ls-app> — root shell. Owns the sidebar, editor pane, and overlays.
//
// Wires together:
//   <ls-file-tree>, <ls-editor>, <ls-backlinks>, <ls-outline>,
//   <ls-command-palette>, <ls-switcher>, hash router, vaultService.

import { isAuthenticated } from "../auth/index.ts";
import { vaultService } from "../vault/index.ts";
import { currentRoute, navigateTo, navigateHome } from "./router.ts";
import type { Route } from "./router.ts";
import { parseHeadings } from "./ls-outline.ts";
import "./ls-modal.ts";
import "./ls-file-tree.ts";
import "./ls-backlinks.ts";
import "./ls-outline.ts";
import "./ls-command-palette.ts";
import "./ls-switcher.ts";
import "./ls-editor.ts";
import type { LSFileTree } from "./ls-file-tree.ts";
import type { LSBacklinks } from "./ls-backlinks.ts";
import type { LSOutline } from "./ls-outline.ts";
import type { LSCommandPalette } from "./ls-command-palette.ts";
import type { LSSwitcher } from "./ls-switcher.ts";
import type { LSEditor } from "./ls-editor.ts";

const style = `
  :host {
    display: flex;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    font-family: var(--ls-font-ui, system-ui, sans-serif);
    background: var(--ls-color-bg, #1a1a2e);
    color: var(--ls-color-fg, #e0e0e0);
  }
  #sidebar {
    width: 240px;
    min-width: 180px;
    max-width: 400px;
    border-right: 1px solid var(--ls-color-border, #2a2a3e);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--ls-color-bg-sidebar, #16162a);
  }
  #sidebar-top {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  #sidebar-panels {
    flex-shrink: 0;
    max-height: 40vh;
    overflow-y: auto;
  }
  #main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }
  #editor-wrap {
    flex: 1;
    overflow: hidden;
    position: relative;
  }
  ls-editor {
    display: block;
    height: 100%;
  }
  #welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--ls-color-fg-muted, #64748b);
  }
  #welcome h2 { margin: 0; font-size: 20px; color: var(--ls-color-fg, #e0e0e0); }
  #welcome p { margin: 0; font-size: 13px; }
  #welcome kbd {
    background: rgba(255,255,255,0.08);
    border: 1px solid var(--ls-color-border, #333);
    border-radius: 4px;
    padding: 1px 6px;
    font-family: var(--ls-font-mono, monospace);
    font-size: 12px;
  }
  #status-bar {
    height: 24px;
    padding: 0 10px;
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-top: 1px solid var(--ls-color-border, #2a2a3e);
    background: var(--ls-color-bg-subtle, #0f0f1a);
    color: var(--ls-color-fg-muted, #64748b);
    flex-shrink: 0;
  }
  .status-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--ls-color-fg-muted, #64748b);
    flex-shrink: 0;
  }
  .status-dot.syncing { background: #f59e0b; }
  .status-dot.ok { background: #86efac; }
  .status-dot.error { background: #f87171; }
  .status-dot.conflict { background: #f59e0b; }
  #auth-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  #auth-overlay.visible { display: flex; }

  /* Conflict banner */
  #conflict-banner {
    display: none;
    padding: 6px 14px;
    background: rgba(245,158,11,0.12);
    border-bottom: 1px solid #f59e0b;
    font-size: 12px;
    color: #f59e0b;
    gap: 8px;
    align-items: center;
  }
  #conflict-banner.visible { display: flex; }
  #conflict-banner button {
    margin-left: auto;
    background: none;
    border: 1px solid #f59e0b;
    color: #f59e0b;
    border-radius: 4px;
    padding: 1px 8px;
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
  }
  #conflict-banner button:hover { background: rgba(245,158,11,0.15); }
`;

export class LSApp extends HTMLElement {
  #shadow!: ShadowRoot;
  #authOverlay!: HTMLElement;
  #editorWrap!: HTMLElement;
  #statusDot!: HTMLElement;
  #statusText!: HTMLElement;
  #conflictBanner!: HTMLElement;
  #fileTree!: LSFileTree;
  #backlinks!: LSBacklinks;
  #outline!: LSOutline;
  #palette!: LSCommandPalette;
  #switcher!: LSSwitcher;
  #editor: LSEditor | null = null;
  #activePath = "";
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

  connectedCallback(): void {
    this.#shadow = this.attachShadow({ mode: "open" });

    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);

    this.#buildLayout();
    this.#registerCommands();
    this.#wireVaultEvents();
    this.#init().catch(console.error);
  }

  disconnectedCallback(): void {
    window.removeEventListener("route", this.#onRoute);
  }

  hideAuthOverlay(): void {
    this.#authOverlay.classList.remove("visible");
  }

  // ── Build DOM ─────────────────────────────────────────────────────────────

  #buildLayout(): void {
    // Sidebar
    const sidebar = document.createElement("div");
    sidebar.id = "sidebar";

    const sidebarTop = document.createElement("div");
    sidebarTop.id = "sidebar-top";

    this.#fileTree = document.createElement("ls-file-tree") as LSFileTree;
    this.#fileTree.style.cssText = "flex:1;min-height:0;overflow:hidden;";
    this.#fileTree.addEventListener("file-open", (e) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      navigateTo(path);
    });
    this.#fileTree.addEventListener("file-new", (e) => {
      const { folder } = (e as CustomEvent<{ folder: string }>).detail;
      this.#newNote(folder);
    });

    sidebarTop.appendChild(this.#fileTree);
    sidebar.appendChild(sidebarTop);

    const sidebarPanels = document.createElement("div");
    sidebarPanels.id = "sidebar-panels";

    this.#outline = document.createElement("ls-outline") as LSOutline;
    this.#outline.addEventListener("outline-jump", (e) => {
      const { line } = (e as CustomEvent<{ line: number }>).detail;
      this.#editor?.scrollToLine(line);
    });

    this.#backlinks = document.createElement("ls-backlinks") as LSBacklinks;
    this.#backlinks.addEventListener("file-open", (e) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      navigateTo(path);
    });

    sidebarPanels.append(this.#outline, this.#backlinks);
    sidebar.appendChild(sidebarPanels);

    // Main area
    const main = document.createElement("div");
    main.id = "main";

    // Conflict banner
    this.#conflictBanner = document.createElement("div");
    this.#conflictBanner.id = "conflict-banner";
    this.#conflictBanner.innerHTML =
      "<span>⚡ This note has a merge conflict. Resolve it in the editor.</span>";
    const resolveBtn = document.createElement("button");
    resolveBtn.textContent = "Mark resolved";
    resolveBtn.addEventListener("click", () => this.#resolveConflict());
    this.#conflictBanner.appendChild(resolveBtn);
    main.appendChild(this.#conflictBanner);

    this.#editorWrap = document.createElement("div");
    this.#editorWrap.id = "editor-wrap";
    main.appendChild(this.#editorWrap);

    // Show welcome screen initially
    this.#showWelcome();

    // Status bar
    const statusBar = document.createElement("div");
    statusBar.id = "status-bar";
    this.#statusDot = document.createElement("div");
    this.#statusDot.className = "status-dot";
    this.#statusText = document.createElement("span");
    this.#statusText.textContent = "Ready";
    statusBar.append(this.#statusDot, this.#statusText);
    main.appendChild(statusBar);

    // Auth overlay
    this.#authOverlay = document.createElement("div");
    this.#authOverlay.id = "auth-overlay";
    const modal = document.createElement("ls-modal");
    modal.id = "auth-modal";
    modal.addEventListener("auth-complete", () => this.hideAuthOverlay());
    this.#authOverlay.appendChild(modal);

    // Palette + switcher (appended to shadow root, not inside a flex child)
    this.#palette = document.createElement("ls-command-palette") as LSCommandPalette;
    this.#palette.addEventListener("palette-command", (e) => {
      this.#onPaletteCommand((e as CustomEvent<{ id: string }>).detail.id);
    });

    this.#switcher = document.createElement("ls-switcher") as LSSwitcher;
    this.#switcher.addEventListener("file-open", (e) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      navigateTo(path);
    });

    this.#shadow.append(sidebar, main, this.#authOverlay, this.#palette, this.#switcher);

    // Hash router
    window.addEventListener("route", this.#onRoute as EventListener);
  }

  #showWelcome(): void {
    this.#editorWrap.innerHTML = "";
    this.#editor = null;
    const welcome = document.createElement("div");
    welcome.id = "welcome";
    welcome.innerHTML = `
      <h2>Lemonstone</h2>
      <p>Select a note from the sidebar or press <kbd>Ctrl+P</kbd> to jump to one.</p>
      <p>Press <kbd>Ctrl+Shift+P</kbd> for commands.</p>
    `;
    this.#editorWrap.appendChild(welcome);
  }

  #mountEditor(path: string, content: string): void {
    this.#editorWrap.innerHTML = "";
    const ed = document.createElement("ls-editor") as LSEditor;
    ed.path = path;
    ed.value = content;
    ed.addEventListener("input", (e) => {
      const { content: c, path: p } = (e as CustomEvent<{ content: string; path: string }>).detail;
      this.#onEditorInput(c, p);
    });
    this.#editorWrap.appendChild(ed);
    this.#editor = ed;
    requestAnimationFrame(() => ed.focus());
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  async #init(): Promise<void> {
    const authed = await isAuthenticated();
    if (!authed) {
      this.#authOverlay.classList.add("visible");
      return;
    }
    await this.#loadNoteList();
    // Route to current hash.
    const route = currentRoute();
    await this.#handleRoute(route);
  }

  // ── Vault event wiring ────────────────────────────────────────────────────

  #wireVaultEvents(): void {
    vaultService.addEventListener("vault:ready", () => {
      this.#loadNoteList().catch(console.error);
      this.#setStatus("ok", "Ready");
    });

    vaultService.addEventListener("note:changed", () => {
      this.#loadNoteList().catch(console.error);
    });

    vaultService.addEventListener("note:deleted", () => {
      this.#loadNoteList().catch(console.error);
    });

    vaultService.addEventListener("vault:synced", () => {
      this.#setStatus("ok", "Synced");
      // Reload active note if it changed.
      if (this.#activePath) this.#reloadActiveNote().catch(console.error);
    });

    vaultService.addEventListener("vault:syncError", (e) => {
      const msg = (e as CustomEvent<{ message?: string }>).detail?.message ?? "Sync error";
      this.#setStatus("error", msg);
    });

    vaultService.addEventListener("vault:conflictDetected", (e) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      if (path === this.#activePath) {
        this.#conflictBanner.classList.add("visible");
      }
    });

    // Sync-in-progress indicator (synthetic: watch for repeated syncStarted events).
    vaultService.addEventListener("vault:synced", () => {
      setTimeout(() => {
        if (this.#statusDot.classList.contains("syncing")) {
          this.#setStatus("ok", "Synced");
        }
      }, 200);
    });
  }

  #setStatus(state: "ok" | "syncing" | "error" | "conflict", text: string): void {
    this.#statusDot.className = `status-dot ${state}`;
    this.#statusText.textContent = text;
  }

  // ── Note list ─────────────────────────────────────────────────────────────

  async #loadNoteList(): Promise<void> {
    const notes = await vaultService.listNotes();
    const paths = notes.map((n) => n.path);
    this.#fileTree.notes = paths;
    this.#fileTree.activePath = this.#activePath;
    this.#switcher.notes = paths;
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  #onRoute = async (e: Event): Promise<void> => {
    await this.#handleRoute((e as CustomEvent<Route>).detail);
  };

  async #handleRoute(route: Route): Promise<void> {
    if (route.type === "home") {
      this.#activePath = "";
      this.#showWelcome();
      this.#fileTree.activePath = "";
      this.#outline.headings = [];
      this.#backlinks.links = [];
      this.#conflictBanner.classList.remove("visible");
      return;
    }
    await this.#openNote(route.path);
  }

  async #openNote(path: string): Promise<void> {
    this.#activePath = path;
    this.#fileTree.activePath = path;
    this.#conflictBanner.classList.remove("visible");

    let content = "";
    try {
      const note = await vaultService.readNote(path);
      content = note ?? "";
    } catch {
      content = "";
    }

    this.#mountEditor(path, content);
    this.#updateSidebarPanels(path, content);
  }

  async #reloadActiveNote(): Promise<void> {
    if (!this.#activePath || !this.#editor) return;
    try {
      const note = await vaultService.readNote(this.#activePath);
      if (note !== null && note !== this.#editor.value) {
        this.#editor.value = note;
        this.#updateSidebarPanels(this.#activePath, note);
      }
    } catch { /* ignore */ }
  }

  #updateSidebarPanels(path: string, content: string): void {
    this.#outline.headings = parseHeadings(content);
    this.#backlinks.path = path;
    const incoming = vaultService.getBacklinks(path);
    this.#backlinks.links = incoming;
  }

  // ── Editor input → save ───────────────────────────────────────────────────

  #onEditorInput(content: string, path: string): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#setStatus("syncing", "Saving…");
    this.#saveTimer = setTimeout(async () => {
      this.#saveTimer = null;
      try {
        await vaultService.writeNote(path, content);
        this.#setStatus("ok", "Saved");
        this.#updateSidebarPanels(path, content);
      } catch (err) {
        this.#setStatus("error", "Save failed");
        console.error(err);
      }
    }, 500);
  }

  // ── New note ──────────────────────────────────────────────────────────────

  async #newNote(folder: string): Promise<void> {
    const base = `Untitled-${Date.now()}`;
    const path = folder ? `${folder}/${base}.md` : `${base}.md`;
    await vaultService.writeNote(path, `# ${base}\n\n`);
    navigateTo(path);
  }

  // ── Conflict resolution ───────────────────────────────────────────────────

  #resolveConflict(): void {
    if (!this.#activePath) return;
    vaultService.resolveConflict(this.#activePath).catch(console.error);
    this.#conflictBanner.classList.remove("visible");
  }

  // ── Command palette ───────────────────────────────────────────────────────

  #registerCommands(): void {
    this.#palette.register({ id: "new-note", label: "New note", description: "Create a new note", shortcut: "Ctrl+N" });
    this.#palette.register({ id: "quick-open", label: "Quick open note", description: "Jump to a note by name", shortcut: "Ctrl+P" });
    this.#palette.register({ id: "go-home", label: "Go to home", description: "Show the welcome screen" });
    this.#palette.register({ id: "sync", label: "Sync now", description: "Push and pull from GitHub" });
  }

  #onPaletteCommand(id: string): void {
    switch (id) {
      case "new-note":
        this.#newNote("").catch(console.error);
        break;
      case "quick-open":
        this.#switcher.open();
        break;
      case "go-home":
        navigateHome();
        break;
      case "sync":
        this.#setStatus("syncing", "Syncing…");
        vaultService.sync().catch((err) => {
          this.#setStatus("error", "Sync failed");
          console.error(err);
        });
        break;
    }
  }
}

customElements.define("ls-app", LSApp);
