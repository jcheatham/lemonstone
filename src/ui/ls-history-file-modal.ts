// <ls-history-file-modal> — read-only viewer for a file's decrypted content
// as of a specific commit (History panel: click a changed file to inspect
// it). Encrypted zones aren't diffable via raw git history, so this decrypts
// on the fly using whichever zone identities are currently unlocked.
//
// Dismissable via Close button, Escape key, or clicking the backdrop.

const style = `
  :host {
    position: fixed;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.7);
    z-index: 250;
    font-family: var(--ls-font-ui, system-ui, sans-serif);
  }
  :host(.visible) { display: flex; }

  .panel {
    background: var(--ls-color-bg-overlay, #1e1e2e);
    border: 1px solid var(--ls-color-border, #333);
    border-radius: 8px;
    padding: 20px;
    width: min(760px, 92vw);
    height: min(80vh, 640px);
    box-shadow: 0 24px 48px rgba(0,0,0,0.55);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 15px;
    font-family: var(--ls-font-mono, monospace);
    color: var(--ls-color-fg, #e0e0e0);
    word-break: break-all;
    flex-shrink: 0;
  }
  .meta {
    margin: 0 0 12px;
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 12px;
    font-family: var(--ls-font-mono, monospace);
    flex-shrink: 0;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--ls-color-bg-input, #0f0f1a);
    border: 1px solid var(--ls-color-border, #333);
    border-radius: 4px;
    padding: 12px;
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--ls-font-mono, monospace);
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--ls-color-fg, #e0e0e0);
  }
  .status {
    color: var(--ls-color-fg-muted, #64748b);
    font-style: italic;
    font-size: 13px;
  }
  .status.error { color: #f87171; font-style: normal; }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
    flex-shrink: 0;
  }
  button {
    background: rgba(255,255,255,0.06);
    color: var(--ls-color-fg, #e0e0e0);
    border: 1px solid var(--ls-color-border, #333);
    padding: 7px 14px;
    border-radius: 4px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button.primary {
    background: var(--ls-color-accent, #7c6af7);
    color: white;
    border: none;
  }
`;

export class LSHistoryFileModal extends HTMLElement {
  #shadow: ShadowRoot;
  #title!: HTMLElement;
  #meta!: HTMLElement;
  #body!: HTMLElement;
  #copyBtn!: HTMLButtonElement;
  #content: string | null = null;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    this.#buildDOM();

    this.addEventListener("click", (e) => {
      if (e.composedPath()[0] === this) this.hide();
    });
    this.#shadow.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") { ke.preventDefault(); this.hide(); }
    });
  }

  #buildDOM(): void {
    const panel = document.createElement("div");
    panel.className = "panel";

    this.#title = document.createElement("h2");
    this.#meta = document.createElement("div");
    this.#meta.className = "meta";

    this.#body = document.createElement("div");
    this.#body.className = "body";

    const actions = document.createElement("div");
    actions.className = "actions";
    this.#copyBtn = document.createElement("button");
    this.#copyBtn.textContent = "Copy content";
    this.#copyBtn.addEventListener("click", () => {
      if (this.#content !== null) navigator.clipboard.writeText(this.#content).catch(console.error);
    });
    const closeBtn = document.createElement("button");
    closeBtn.className = "primary";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => this.hide());
    actions.append(this.#copyBtn, closeBtn);

    panel.append(this.#title, this.#meta, this.#body, actions);
    this.#shadow.appendChild(panel);
  }

  /** Show a loading state immediately, before the decrypted content arrives. */
  showLoading(path: string, metaText: string): void {
    this.#title.textContent = path;
    this.#meta.textContent = metaText;
    this.#content = null;
    this.#copyBtn.disabled = true;
    this.#body.innerHTML = "";
    const status = document.createElement("div");
    status.className = "status";
    status.textContent = "Decrypting…";
    this.#body.appendChild(status);
    this.classList.add("visible");
  }

  /** Populate with decrypted text content (or null if the file didn't exist
   *  in that commit). Must be called after `showLoading`. */
  setContent(content: string | null): void {
    this.#content = content;
    this.#copyBtn.disabled = content === null;
    this.#body.innerHTML = "";
    if (content === null) {
      const status = document.createElement("div");
      status.className = "status";
      status.textContent = "This file didn't exist as of this commit.";
      this.#body.appendChild(status);
      return;
    }
    const pre = document.createElement("pre");
    pre.textContent = content;
    this.#body.appendChild(pre);
  }

  /** Show an error in place of content (e.g. still locked). */
  setError(message: string): void {
    this.#content = null;
    this.#copyBtn.disabled = true;
    this.#body.innerHTML = "";
    const status = document.createElement("div");
    status.className = "status error";
    status.textContent = message;
    this.#body.appendChild(status);
  }

  hide(): void {
    this.classList.remove("visible");
  }
}

customElements.define("ls-history-file-modal", LSHistoryFileModal);
