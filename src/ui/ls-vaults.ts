// <ls-vaults> — drill-in panel for the Vaults category.
//
// Contains a vault list + a footer "+ Add vault" action. Clicking a row
// fires `vault-select` (not `vault-switch`) — the main pane's detail card
// then displays actions for the selected vault.
//
// Events (bubbles, composed):
//   vault-select — detail: { vaultId }
//   vault-add    — user asked to add a new vault

import type { VaultRecord } from "../vault/manifest.ts";

const style = `
  :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; font-size: 13px; }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ls-color-fg-muted, #64748b);
    flex-shrink: 0;
  }
  .header button {
    background: none;
    border: none;
    color: var(--ls-color-fg-muted, #64748b);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 2px;
    border-radius: 3px;
    font-family: inherit;
  }
  .header button:hover { color: var(--ls-color-fg, #e0e0e0); background: rgba(255,255,255,0.07); }
  .list { flex: 1; overflow-y: auto; padding: 4px 0 8px; }
  .empty-hint {
    padding: 16px 12px;
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 12px;
    font-style: italic;
  }
  .row {
    display: flex;
    align-items: center;
    padding: 6px 12px;
    gap: 8px;
    cursor: pointer;
    color: var(--ls-color-fg, #e0e0e0);
    border-left: 2px solid transparent;
    min-height: 34px;
  }
  .row:hover { background: rgba(255,255,255,0.04); }
  .row.selected {
    border-left-color: var(--ls-color-accent, #7c6af7);
    background: rgba(124,106,247,0.08);
  }
  .label-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .label {
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .repo {
    font-size: 11px;
    color: var(--ls-color-fg-muted, #64748b);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .current-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ls-color-accent, #7c6af7);
    flex-shrink: 0;
  }
`;

export class LSVaults extends HTMLElement {
  #shadow: ShadowRoot;
  #vaults: VaultRecord[] = [];
  #currentId: string | null = null;
  #selectedId: string | null = null;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
  }

  connectedCallback(): void { this.#render(); }

  get vaults(): VaultRecord[] { return this.#vaults; }
  set vaults(v: VaultRecord[]) { this.#vaults = v; this.#render(); }

  get currentId(): string | null { return this.#currentId; }
  set currentId(v: string | null) { this.#currentId = v; this.#render(); }

  /** UI selection (not "current vault"). Drives which row is highlighted
   *  and which vault the main pane's detail card shows. */
  get selectedId(): string | null { return this.#selectedId; }
  set selectedId(v: string | null) { this.#selectedId = v; this.#render(); }

  #render(): void {
    const root = this.#shadow;
    for (const child of [...root.children]) {
      if (child.tagName !== "STYLE") child.remove();
    }

    const header = document.createElement("div");
    header.className = "header";
    const title = document.createElement("span");
    title.textContent = "Vaults";
    const add = document.createElement("button");
    add.textContent = "+";
    add.title = "Add vault";
    add.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("vault-add", { bubbles: true, composed: true }));
    });
    header.append(title, add);
    root.appendChild(header);

    const list = document.createElement("div");
    list.className = "list";

    if (this.#vaults.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "No vaults yet.";
      list.appendChild(hint);
    } else {
      for (const v of this.#vaults) list.appendChild(this.#row(v));
    }

    root.appendChild(list);
  }

  #row(v: VaultRecord): HTMLElement {
    const row = document.createElement("div");
    row.className = "row" + (v.id === this.#selectedId ? " selected" : "");
    row.addEventListener("click", () => {
      this.#selectedId = v.id;
      this.#render();
      this.dispatchEvent(new CustomEvent("vault-select", {
        bubbles: true, composed: true, detail: { vaultId: v.id },
      }));
    });

    const labelWrap = document.createElement("div");
    labelWrap.className = "label-wrap";
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = v.label;
    const repo = document.createElement("div");
    repo.className = "repo";
    repo.textContent = v.repoFullName;
    labelWrap.append(label, repo);
    row.appendChild(labelWrap);

    if (v.id === this.#currentId) {
      const dot = document.createElement("span");
      dot.className = "current-dot";
      dot.title = "Current vault";
      row.appendChild(dot);
    }

    return row;
  }
}

customElements.define("ls-vaults", LSVaults);
