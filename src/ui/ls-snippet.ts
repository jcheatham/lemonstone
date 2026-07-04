// <ls-snippet> — editor + sandboxed preview for an HTML/JS snippet (.html note).
//
//   • Source pane: CodeMirror 6 with HTML (embedded JS/CSS) highlighting.
//   • Preview pane: the opaque-origin snippet sandbox (SnippetSandbox).
//   • Layout: split (source | preview) on desktop, toggle on narrow widths.
//   • Re-run is explicit (Run button / Mod-Enter / switching to Preview on
//     mobile) — never live-on-keystroke.
//   • Console/Issues panel: captured console.*, runtime errors, and CSP
//     violations from the sandbox, collapsible, filterable.
//
// Emits an "input" CustomEvent { content, path } (same shape as <ls-editor>) so
// ls-app's autosave pipeline persists edits. See docs/snippets.md.

import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { createSnippetEditorExtensions } from "./codemirror/index.ts";
import { SnippetSandbox, type SnippetDiagnostic, type SnippetConsoleEntry } from "../snippet/snippet-sandbox.ts";
import { parseConnectSrc, originOf } from "../snippet/network-policy.ts";

const NARROW_PX = 640;
const MAX_CONSOLE_ROWS = 300;

const template = document.createElement("template");
template.innerHTML = `
<style>
  :host { display: flex; flex-direction: column; height: 100%; width: 100%; min-height: 0; }
  .bar {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; border-bottom: 1px solid var(--ls-color-border, #2a2a3a);
    flex-shrink: 0; font-size: 12px; color: var(--ls-color-fg-muted, #94a3b8);
  }
  .bar .spacer { flex: 1; }
  .seg { display: none; border: 1px solid var(--ls-color-border, #2a2a3a); border-radius: 5px; overflow: hidden; }
  .seg button { font: inherit; font-size: 12px; padding: 3px 12px; border: 0; cursor: pointer;
    background: transparent; color: var(--ls-color-fg-muted, #94a3b8); }
  .seg button.active { background: var(--ls-color-accent, #6366f1); color: #fff; }
  :host(.narrow) .seg { display: inline-flex; }
  button.action {
    font: inherit; font-size: 12px; padding: 4px 12px; cursor: pointer;
    background: var(--ls-color-accent, #6366f1); color: #fff; border: none; border-radius: 4px;
  }
  button.action:hover { filter: brightness(1.1); }
  button.ghost {
    font: inherit; font-size: 12px; padding: 4px 10px; cursor: pointer;
    background: transparent; color: var(--ls-color-fg-muted, #94a3b8);
    border: 1px solid var(--ls-color-border, #2a2a3a); border-radius: 4px;
    display: inline-flex; align-items: center; gap: 6px;
  }
  button.ghost:hover { color: var(--ls-color-fg, #e2e8f0); }
  .badge { min-width: 16px; text-align: center; padding: 0 5px; border-radius: 8px;
    font-size: 11px; background: #3a1a1a; color: #f87171; display: none; }
  .badge.show { display: inline-block; }

  .split { flex: 1; display: grid; grid-template-columns: 1fr 1fr; min-height: 0; }
  .pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .source { border-right: 1px solid var(--ls-color-border, #2a2a3a); }
  .cm-host { flex: 1; min-height: 0; overflow: hidden; }
  .cm-host .cm-editor { height: 100%; }
  .preview { background: #fff; overflow: auto; }
  .preview-host { flex: 0 0 auto; }

  /* Narrow: single column, one pane shown at a time. */
  :host(.narrow) .split { grid-template-columns: 1fr; }
  :host(.narrow) .source { border-right: 0; }
  :host(.narrow.show-preview) .source { display: none; }
  :host(.narrow.show-source) .preview { display: none; }

  .console { flex-shrink: 0; display: none; flex-direction: column;
    border-top: 1px solid var(--ls-color-border, #2a2a3a); background: #0b0b12; max-height: 40%; }
  .console.show { display: flex; }
  .console-head { display: flex; align-items: center; gap: 8px; padding: 4px 10px;
    font-size: 11px; color: #8aa; border-bottom: 1px solid #1c1c28; flex-shrink: 0; }
  .console-head .spacer { flex: 1; }
  .console-head button { font: inherit; font-size: 11px; background: transparent; border: 0;
    color: #8aa; cursor: pointer; padding: 2px 6px; border-radius: 3px; }
  .console-head button.on { color: #cdd; background: #1c1c28; }
  .console-head button:hover { color: #cdd; }
  .console-list { overflow: auto; padding: 4px 0; font: 12px ui-monospace, monospace; color: #cdd; }
  .console-list .row { padding: 1px 12px; white-space: pre-wrap; border-left: 2px solid transparent; }
  .console-list .row.warn  { color: #fcd34d; }
  .console-list .row.error, .console-list .row.csp { color: #f87171; border-left-color: #f87171; }
  .console-list .row.log, .console-list .row.info, .console-list .row.debug { color: #93c5fd; }
  .console-list.errors-only .row:not(.error):not(.csp):not(.warn) { display: none; }
  .empty { color: #556; padding: 6px 12px; font-style: italic; }

  .consent { display: none; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 8px 12px; font-size: 12px; flex-shrink: 0;
    background: #3a2f1a; color: #fcd34d; border-bottom: 1px solid #4a3a1a; }
  .consent.show { display: flex; }
  .consent .origins { font-family: ui-monospace, monospace; color: #fde68a; }
  .consent .spacer { flex: 1; }
  .consent button { font: inherit; font-size: 12px; padding: 3px 12px; cursor: pointer; border-radius: 4px; }
  .consent button.allow { background: #fcd34d; color: #1a1400; border: none; }
  .consent button.deny { background: transparent; color: #fcd34d; border: 1px solid #7a6a2a; }
</style>
<div class="bar">
  <span class="seg">
    <button type="button" data-mode="source" class="active">Source</button>
    <button type="button" data-mode="preview">Preview</button>
  </span>
  <button type="button" class="action run">Run ▷</button>
  <span class="hint">Edit, then Run (⌘⏎)</span>
  <span class="spacer"></span>
  <button type="button" class="ghost toggle-console">Console <span class="badge">0</span></button>
</div>
<div class="consent">
  <span>🔌 This snippet requests network access to <span class="origins"></span></span>
  <span class="spacer"></span>
  <button type="button" class="allow">Allow</button>
  <button type="button" class="deny">Not now</button>
</div>
<div class="split">
  <div class="pane source"><div class="cm-host"></div></div>
  <div class="pane preview"><div class="preview-host"></div></div>
</div>
<div class="console">
  <div class="console-head">
    <button type="button" class="filter-all on">All</button>
    <button type="button" class="filter-errors">Errors</button>
    <span class="spacer"></span>
    <span class="count">0 messages</span>
    <button type="button" class="clear">Clear</button>
  </div>
  <div class="console-list"><div class="empty">No output yet.</div></div>
</div>
`;

type Entry = { cls: string; text: string };

export class LSSnippet extends HTMLElement {
  #shadow!: ShadowRoot;
  #view: EditorView | null = null;
  #sandbox: SnippetSandbox | null = null;
  #ro: ResizeObserver | null = null;

  #path = "";
  #pendingValue = "";
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

  #entries: Entry[] = [];
  #filter: "all" | "errors" = "all";
  #consoleOpen = false;
  #mode: "source" | "preview" = "source";

  #grantedOrigins: string[] = [];
  #requested: string[] = [];
  #pendingUngranted: string[] = [];

  set path(p: string) { this.#path = p; }
  get path(): string { return this.#path; }

  /** Origins the user has granted this snippet (loaded from local config by
   *  ls-app). Setting it re-runs so a fresh grant takes effect immediately. */
  set grantedOrigins(v: string[]) {
    this.#grantedOrigins = v ?? [];
    if (this.#view) this.#run();
  }
  get grantedOrigins(): string[] { return this.#grantedOrigins; }
  set value(v: string) {
    if (!this.#view) { this.#pendingValue = v; return; }
    const cur = this.#view.state.doc.toString();
    if (cur === v) return;
    this.#view.dispatch({ changes: { from: 0, to: cur.length, insert: v }, selection: { anchor: 0 } });
  }
  get value(): string { return this.#view?.state.doc.toString() ?? this.#pendingValue; }

  connectedCallback(): void {
    this.#shadow = this.attachShadow({ mode: "open" });
    this.#shadow.appendChild(template.content.cloneNode(true));

    this.#view = new EditorView({
      state: EditorState.create({
        doc: this.#pendingValue,
        extensions: createSnippetEditorExtensions({
          onDocChange: (c) => this.#onDocChange(c),
          onRun: () => this.#run(),
        }),
      }),
      parent: this.#shadow.querySelector(".cm-host")!,
    });
    this.#pendingValue = "";

    this.#sandbox = new SnippetSandbox(this.#shadow.querySelector(".preview-host")!, {
      onHeight: (px) => { if (this.#sandbox) this.#sandbox.element.style.height = px + "px"; },
      onConsole: (e) => this.#addConsole(e),
      onDiagnostic: (e) => this.#addDiagnostic(e),
    });

    this.#wireControls();

    this.#ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? this.clientWidth;
      this.#setNarrow(w < NARROW_PX);
    });
    this.#ro.observe(this);
    this.#setNarrow(this.clientWidth < NARROW_PX);

    this.#run();
  }

  disconnectedCallback(): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#ro?.disconnect();
    this.#sandbox?.destroy();
    this.#sandbox = null;
    this.#view?.destroy();
    this.#view = null;
  }

  focus(): void { this.#view?.focus(); }

  // ── Controls ───────────────────────────────────────────────────────────────

  #wireControls(): void {
    this.#shadow.querySelector(".run")!.addEventListener("click", () => this.#run());
    this.#shadow.querySelectorAll<HTMLButtonElement>(".seg button").forEach((btn) => {
      btn.addEventListener("click", () => this.#setMode(btn.dataset["mode"] as "source" | "preview"));
    });
    this.#shadow.querySelector(".toggle-console")!.addEventListener("click", () => this.#toggleConsole());
    this.#shadow.querySelector(".filter-all")!.addEventListener("click", () => this.#setFilter("all"));
    this.#shadow.querySelector(".filter-errors")!.addEventListener("click", () => this.#setFilter("errors"));
    this.#shadow.querySelector(".clear")!.addEventListener("click", () => this.#clearConsole());
    this.#shadow.querySelector(".consent .allow")!.addEventListener("click", () => this.#grant());
    this.#shadow.querySelector(".consent .deny")!.addEventListener("click", () => this.#hideConsent());
  }

  #setNarrow(narrow: boolean): void {
    this.classList.toggle("narrow", narrow);
    if (narrow) this.#applyMode();
  }

  #setMode(mode: "source" | "preview"): void {
    this.#mode = mode;
    this.#applyMode();
    this.#shadow.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) =>
      b.classList.toggle("active", b.dataset["mode"] === mode));
    // Switching to Preview should reflect the current source.
    if (mode === "preview") this.#run();
    else requestAnimationFrame(() => this.#view?.focus());
  }

  #applyMode(): void {
    this.classList.toggle("show-source", this.#mode === "source");
    this.classList.toggle("show-preview", this.#mode === "preview");
  }

  #run(): void {
    // Fresh run ⇒ fresh output; late messages from a superseded run are already
    // dropped by SnippetSandbox's runId filter.
    this.#clearConsole();
    this.#requested = parseConnectSrc(this.value);
    // Only origins that are BOTH declared in the current source AND granted
    // reach the sandbox — editing the meta to add an origin re-triggers consent.
    const granted = this.#requested.filter((o) => this.#grantedOrigins.includes(o));
    this.#sandbox?.render(this.value, granted);
    this.#renderConsent(this.#requested.filter((o) => !this.#grantedOrigins.includes(o)));
  }

  #renderConsent(ungranted: string[]): void {
    this.#pendingUngranted = ungranted;
    const banner = this.#shadow.querySelector(".consent")!;
    if (ungranted.length === 0) { banner.classList.remove("show"); return; }
    this.#shadow.querySelector(".consent .origins")!.textContent = ungranted.join(", ");
    banner.classList.add("show");
  }

  #hideConsent(): void {
    this.#shadow.querySelector(".consent")!.classList.remove("show");
  }

  #grant(): void {
    const origins = this.#pendingUngranted;
    this.#hideConsent();
    if (origins.length === 0) return;
    // ls-app persists the grant (per path, local) and sets grantedOrigins back,
    // which re-runs with the new connect-src.
    this.dispatchEvent(new CustomEvent("snippet-grant-request", {
      bubbles: true, composed: true, detail: { path: this.#path, origins },
    }));
  }

  #onDocChange(content: string): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.dispatchEvent(new CustomEvent("input", {
        bubbles: true, composed: true, detail: { content, path: this.#path },
      }));
    }, 400);
  }

  // ── Console panel ────────────────────────────────────────────────────────

  #addConsole(e: SnippetConsoleEntry): void {
    this.#push(e.level, `console.${e.level}: ${e.args.join(" ")}`);
  }
  #addDiagnostic(e: SnippetDiagnostic): void {
    let text = `${e.kind}: ${e.message}${e.detail ? " — " + e.detail : ""}`;
    // For blocked network, teach the declaration/grant mechanism.
    if (e.kind === "csp" && /connect-src/.test(e.message) && e.detail) {
      const origin = originOf(e.detail);
      if (origin && !this.#requested.includes(origin)) {
        text += `  ⟶ add "${origin}" to <meta name="lemonstone-connect-src"> to request access`;
      } else if (origin) {
        text += `  ⟶ declared but not granted — Run and choose Allow`;
      }
    }
    this.#push(e.kind, text);
    // Auto-open the panel the first time something goes wrong.
    if (!this.#consoleOpen) this.#toggleConsole(true);
  }

  #push(cls: string, text: string): void {
    this.#entries.push({ cls, text });
    if (this.#entries.length > MAX_CONSOLE_ROWS) this.#entries.shift();
    this.#renderConsole();
  }

  #errorCount(): number {
    return this.#entries.filter((e) => e.cls === "error" || e.cls === "csp").length;
  }

  #renderConsole(): void {
    const list = this.#shadow.querySelector(".console-list")!;
    list.classList.toggle("errors-only", this.#filter === "errors");
    if (this.#entries.length === 0) {
      list.innerHTML = `<div class="empty">No output yet.</div>`;
    } else {
      list.innerHTML = "";
      for (const e of this.#entries) {
        const row = document.createElement("div");
        row.className = "row " + e.cls;
        row.textContent = e.text;
        list.appendChild(row);
      }
      list.scrollTop = list.scrollHeight;
    }
    this.#shadow.querySelector(".count")!.textContent = `${this.#entries.length} message${this.#entries.length === 1 ? "" : "s"}`;
    const errs = this.#errorCount();
    const badge = this.#shadow.querySelector(".badge")!;
    badge.textContent = String(errs);
    badge.classList.toggle("show", errs > 0);
  }

  #clearConsole(): void {
    this.#entries = [];
    this.#renderConsole();
  }

  #setFilter(f: "all" | "errors"): void {
    this.#filter = f;
    this.#shadow.querySelector(".filter-all")!.classList.toggle("on", f === "all");
    this.#shadow.querySelector(".filter-errors")!.classList.toggle("on", f === "errors");
    this.#renderConsole();
  }

  #toggleConsole(force?: boolean): void {
    this.#consoleOpen = force ?? !this.#consoleOpen;
    this.#shadow.querySelector(".console")!.classList.toggle("show", this.#consoleOpen);
    this.#shadow.querySelector(".toggle-console")!.classList.toggle("on", this.#consoleOpen);
  }
}

customElements.define("ls-snippet", LSSnippet);
