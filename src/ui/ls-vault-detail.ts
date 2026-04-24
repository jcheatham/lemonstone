// <ls-vault-detail> — main-pane detail card for the Vaults category.
//
// The subnav holds a list of vaults; clicking a row selects one, and this
// pane renders its details + actions. When no vault exists, shows an
// empty state with a prominent "+ Add vault" call-to-action.
//
// Events (bubbles, composed):
//   vault-switch — detail: { vaultId }
//   vault-rename — detail: { vaultId; label }
//   vault-remove — detail: { vaultId }
//   vault-share  — detail: { vaultId }
//   vault-add    — user asked to add a new vault

import type { VaultRecord } from "../vault/manifest.ts";

const style = `
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: auto;
    padding: 24px 32px;
    font-family: var(--ls-font-ui, system-ui, sans-serif);
    color: var(--ls-color-fg, #e0e0e0);
    font-size: 13px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 16px;
    text-align: center;
    color: var(--ls-color-fg-muted, #64748b);
  }
  .empty h2 { margin: 0; font-size: 18px; color: var(--ls-color-fg, #e0e0e0); }
  .empty p { margin: 0; line-height: 1.5; max-width: 360px; }
  .empty button.primary, .detail button.primary {
    background: var(--ls-color-accent, #7c6af7);
    color: white;
    border: none;
    padding: 10px 18px;
    font-size: 14px;
    font-family: inherit;
    border-radius: 5px;
    cursor: pointer;
  }
  .empty button.primary:hover, .detail button.primary:hover { opacity: 0.9; }

  .detail h2 {
    margin: 0 0 4px;
    font-size: 22px;
    color: var(--ls-color-fg, #e0e0e0);
    word-break: break-word;
  }
  .repo {
    font-family: var(--ls-font-mono, monospace);
    font-size: 13px;
    color: var(--ls-color-fg-muted, #64748b);
    margin-bottom: 20px;
    word-break: break-all;
  }
  .meta {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    margin-bottom: 24px;
    font-size: 12px;
    color: var(--ls-color-fg-muted, #64748b);
  }
  .meta dt { color: var(--ls-color-fg-muted, #64748b); }
  .meta dd {
    margin: 0;
    color: var(--ls-color-fg, #e0e0e0);
    font-family: var(--ls-font-mono, monospace);
    font-size: 12px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 20px;
  }
  .actions button {
    background: rgba(255,255,255,0.06);
    color: var(--ls-color-fg, #e0e0e0);
    border: 1px solid var(--ls-color-border, #2a2a3e);
    padding: 8px 14px;
    font-size: 13px;
    font-family: inherit;
    border-radius: 4px;
    cursor: pointer;
  }
  .actions button:hover { background: rgba(255,255,255,0.1); }
  .actions button.primary {
    background: var(--ls-color-accent, #7c6af7);
    color: white;
    border-color: var(--ls-color-accent, #7c6af7);
  }
  .actions button.danger:hover { color: #f87171; border-color: #f87171; }

  .current-chip {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ls-color-accent, #7c6af7);
    background: rgba(124,106,247,0.1);
    padding: 2px 8px;
    border-radius: 3px;
    margin-left: 8px;
    vertical-align: middle;
  }

`;

function formatAgo(ms: number): string {
  if (ms < 30_000) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export interface VaultDetailSnapshot {
  record: VaultRecord;
  isCurrent: boolean;
  /** Last-synced timestamp (ms) for the displayed vault, or null if unknown. */
  lastSyncAt: number | null;
  /** Number of encryption zones configured in the displayed vault, or 0. */
  zoneCount: number;
  /** Number of currently-locked zones. */
  lockedZoneCount: number;
}

export class LSVaultDetail extends HTMLElement {
  #shadow: ShadowRoot;
  #snapshot: VaultDetailSnapshot | null = null;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
  }

  connectedCallback(): void { this.#render(); }

  /** Render the detail for a specific vault. Pass null to show the empty state. */
  setSnapshot(snapshot: VaultDetailSnapshot | null): void {
    this.#snapshot = snapshot;
    this.#render();
  }

  #render(): void {
    for (const child of [...this.#shadow.children]) {
      if (child.tagName !== "STYLE") child.remove();
    }
    if (!this.#snapshot) {
      this.#renderEmpty();
      return;
    }
    this.#renderDetail(this.#snapshot);
  }

  #renderEmpty(): void {
    const empty = document.createElement("div");
    empty.className = "empty";
    const h = document.createElement("h2");
    h.textContent = "No vault yet";
    const p = document.createElement("p");
    p.textContent =
      "Connect your first GitHub repository to start keeping notes, or open " +
      "an encrypted share link someone sent you.";
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "+ Add vault";
    btn.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("vault-add", { bubbles: true, composed: true }));
    });
    empty.append(h, p, btn);
    this.#shadow.appendChild(empty);
  }

  #renderDetail(snap: VaultDetailSnapshot): void {
    const root = document.createElement("div");
    root.className = "detail";
    root.style.cssText = "display:flex;flex-direction:column;flex:1;";

    const title = document.createElement("h2");
    title.textContent = snap.record.label;
    if (snap.isCurrent) {
      const chip = document.createElement("span");
      chip.className = "current-chip";
      chip.textContent = "Current";
      title.appendChild(chip);
    }
    root.appendChild(title);

    const repo = document.createElement("div");
    repo.className = "repo";
    repo.textContent = snap.record.repoFullName;
    root.appendChild(repo);

    const dl = document.createElement("dl");
    dl.className = "meta";
    const rows: Array<[string, string]> = [
      ["Default branch", snap.record.repoDefaultBranch],
      ["Last opened", new Date(snap.record.lastOpenedAt).toLocaleString()],
      [
        "Last synced",
        snap.lastSyncAt
          ? `${formatAgo(Date.now() - snap.lastSyncAt)} (${new Date(snap.lastSyncAt).toLocaleString()})`
          : snap.isCurrent ? "not yet this session" : "—",
      ],
    ];
    if (snap.zoneCount > 0) {
      rows.push([
        "Encryption zones",
        `${snap.zoneCount} (${snap.lockedZoneCount} locked)`,
      ]);
    }
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      dl.append(dt, dd);
    }
    root.appendChild(dl);

    const actions = document.createElement("div");
    actions.className = "actions";

    const switchBtn = document.createElement("button");
    switchBtn.className = "primary";
    switchBtn.textContent = snap.isCurrent ? "Open files" : "Switch to this vault";
    switchBtn.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("vault-switch", {
        bubbles: true, composed: true, detail: { vaultId: snap.record.id },
      }));
    });

    const rename = document.createElement("button");
    rename.textContent = "Rename";
    rename.addEventListener("click", () => {
      const next = prompt(`Rename "${snap.record.label}" to:`, snap.record.label);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === snap.record.label) return;
      this.dispatchEvent(new CustomEvent("vault-rename", {
        bubbles: true, composed: true, detail: { vaultId: snap.record.id, label: trimmed },
      }));
    });

    const share = document.createElement("button");
    share.textContent = "Create share link";
    share.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("vault-share", {
        bubbles: true, composed: true, detail: { vaultId: snap.record.id },
      }));
    });

    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      if (!confirm(
        `Remove vault "${snap.record.label}" (${snap.record.repoFullName})?\n\n` +
        `Its local cache and auth will be deleted. The remote GitHub repo is unchanged.`,
      )) return;
      this.dispatchEvent(new CustomEvent("vault-remove", {
        bubbles: true, composed: true, detail: { vaultId: snap.record.id },
      }));
    });

    actions.append(switchBtn, rename, share, remove);
    root.appendChild(actions);

    this.#shadow.appendChild(root);
  }
}

customElements.define("ls-vault-detail", LSVaultDetail);
