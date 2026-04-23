// <ls-vaults> — drill-in panel for the Vaults category.
//
// Lists configured vaults, shows which is current, and exposes per-vault
// actions (switch / rename / remove) plus an Add-vault footer button.
//
// Events (bubbles, composed):
//   vault-switch — detail: { vaultId }
//   vault-remove — detail: { vaultId }
//   vault-rename — detail: { vaultId, label }
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
  .row.current {
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
  .actions { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s; flex-shrink: 0; }
  .row:hover .actions, .row.current .actions { opacity: 1; }
  .actions button {
    background: none;
    border: none;
    color: var(--ls-color-fg-muted, #64748b);
    cursor: pointer;
    padding: 3px 6px;
    font-size: 11px;
    border-radius: 3px;
  }
  .actions button:hover { color: var(--ls-color-fg, #e0e0e0); background: rgba(255,255,255,0.08); }
  .add-btn {
    margin: 6px 12px 10px;
    padding: 8px 10px;
    background: var(--ls-color-accent, #7c6af7);
    color: white;
    border: none;
    border-radius: 5px;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
  }
  .add-btn:hover { opacity: 0.9; }
  .current-badge {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ls-color-accent, #7c6af7);
    flex-shrink: 0;
  }
`;

export class LSVaults extends HTMLElement {
  #shadow: ShadowRoot;
  #vaults: VaultRecord[] = [];
  #currentId: string | null = null;

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

  #render(): void {
    const root = this.#shadow;
    // Remove previous contents (keep style element).
    for (const child of [...root.children]) {
      if (child.tagName !== "STYLE") child.remove();
    }

    const header = document.createElement("div");
    header.className = "header";
    header.textContent = "Vaults";
    root.appendChild(header);

    const list = document.createElement("div");
    list.className = "list";

    if (this.#vaults.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "No vaults yet. Add one below.";
      list.appendChild(hint);
    } else {
      for (const v of this.#vaults) {
        list.appendChild(this.#row(v));
      }
    }

    root.appendChild(list);

    const add = document.createElement("button");
    add.className = "add-btn";
    add.textContent = "+ Add vault";
    add.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("vault-add", { bubbles: true, composed: true }));
    });
    root.appendChild(add);
  }

  #row(v: VaultRecord): HTMLElement {
    const row = document.createElement("div");
    row.className = "row" + (v.id === this.#currentId ? " current" : "");
    row.addEventListener("click", () => {
      this.dispatchEvent(
        new CustomEvent("vault-switch", {
          bubbles: true, composed: true, detail: { vaultId: v.id },
        }),
      );
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
      const badge = document.createElement("span");
      badge.className = "current-badge";
      badge.textContent = "Current";
      row.appendChild(badge);
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    const rename = document.createElement("button");
    rename.title = "Rename";
    rename.textContent = "Rename";
    rename.addEventListener("click", (e) => {
      e.stopPropagation();
      const next = prompt(`Rename "${v.label}" to:`, v.label);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === v.label) return;
      this.dispatchEvent(
        new CustomEvent("vault-rename", {
          bubbles: true, composed: true, detail: { vaultId: v.id, label: trimmed },
        }),
      );
    });

    const remove = document.createElement("button");
    remove.title = "Remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm(
        `Remove vault "${v.label}" (${v.repoFullName})?\n\n` +
        `Its local cache and auth will be deleted. The remote GitHub repo is unchanged.`,
      )) return;
      this.dispatchEvent(
        new CustomEvent("vault-remove", {
          bubbles: true, composed: true, detail: { vaultId: v.id },
        }),
      );
    });

    actions.append(rename, remove);
    row.appendChild(actions);
    return row;
  }
}

customElements.define("ls-vaults", LSVaults);
