// <ls-s3-tree> — lazy-expand S3 object browser, structurally parallel to
// <ls-file-tree> but backed by a live remote listing rather than local
// IndexedDB: each "folder" (S3 common-prefix) is collapsed by default and
// its contents are fetched only when the user expands it — one level at a
// time, never recursive — since every expand is a real, potentially
// billable S3 API call.
//
// Row actions use a single "…" button + <ls-context-menu>, matching
// <ls-file-tree>'s convention rather than separate icon buttons per action.
//
// Dumb/presentational: no S3Client/VaultService imports. The parent supplies
// each prefix's listing via setNode() as fetches resolve, and reacts to the
// events below to know what to fetch next.
//
// Events (bubbles, composed):
//   s3-expand         — detail: { prefix } — user expanded a folder with no
//                        cached listing yet; parent should fetch it and call setNode
//   s3-load-more      — detail: { prefix, continuationToken } — user asked for
//                        the next page of an already-loaded folder
//   s3-open           — detail: { key } — user clicked an object row
//   s3-upload-request — detail: { prefix } — "Upload here" chosen for a folder row
//   s3-new-folder-request — detail: { prefix } — "New folder here" chosen for a folder row
//   s3-rename-request — detail: { key, kind, size? } — "Rename" chosen for any row
//   s3-delete-request — detail: { key, kind } — "Delete" chosen for any row

import "./ls-context-menu.ts";
import type { LSContextMenu, ContextMenuGroup } from "./ls-context-menu.ts";

export interface S3TreeEntry {
  key: string; // full S3 key (objects) or full prefix (folders), always includes the parent path
  kind: "object" | "prefix";
  size?: number;
  lastModified?: number;
}

export interface S3TreeNodeState {
  entries: S3TreeEntry[];
  continuationToken?: string;
  loading?: boolean;
  error?: string;
}

const style = `
  :host { display: block; font-size: 13px; color: var(--ls-color-fg, #e0e0e0); }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-radius: 3px;
  }
  .row:hover { background: rgba(255,255,255,0.05); }
  .row:hover .row-menu-btn { opacity: 1; }
  .row.disabled { cursor: default; color: var(--ls-color-fg-muted, #64748b); }
  .row.disabled:hover { background: none; }
  .arrow { font-size: 9px; display: inline-block; transition: transform 0.15s; flex-shrink: 0; width: 10px; }
  .arrow.collapsed { transform: rotate(-90deg); }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-size: 11px; color: var(--ls-color-fg-muted, #64748b); flex-shrink: 0; }
  .icon { flex-shrink: 0; opacity: 0.7; }
  .row-menu-btn {
    background: none;
    border: none;
    color: var(--ls-color-fg-muted, #94a3b8);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 4px;
    opacity: 0;
    border-radius: 3px;
    flex-shrink: 0;
    font-family: inherit;
  }
  .row-menu-btn:hover { background: rgba(255,255,255,0.1); color: var(--ls-color-fg, #e0e0e0); }
  @media (hover: none) {
    .row-menu-btn { opacity: 1; }
  }
  .children {
    margin-left: 14px;
    border-left: 1px solid var(--ls-color-border, #2a2a3e);
    padding-left: 4px;
  }
  .error-text { color: #f87171; font-size: 12px; padding: 4px 8px; }
  .empty-text { color: var(--ls-color-fg-muted, #64748b); font-size: 12px; padding: 4px 8px; font-style: italic; }
`;

function humanSize(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** Last non-empty path segment of a prefix or key, for display. */
function baseName(pathLike: string): string {
  const trimmed = pathLike.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

export class LSS3Tree extends HTMLElement {
  #shadow: ShadowRoot;
  #nodes = new Map<string, S3TreeNodeState>();
  /** Prefixes the user has chosen to expand — positive tracking (rather than
   *  a "collapsed" set) so "expanded but data hasn't arrived yet" has an
   *  unambiguous visual state (show a Loading row) instead of being
   *  indistinguishable from "never expanded." */
  #expanded = new Set<string>();
  #ctxMenu!: LSContextMenu;
  #ctxMenuTarget: S3TreeEntry | null = null;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    this.#buildContextMenu();
  }

  #buildContextMenu(): void {
    this.#ctxMenu = document.createElement("ls-context-menu") as LSContextMenu;
    this.#ctxMenu.addEventListener("menu-select", (e) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      const target = this.#ctxMenuTarget;
      this.#ctxMenuTarget = null;
      if (!target) return;
      if (id === "upload") {
        this.dispatchEvent(new CustomEvent("s3-upload-request", {
          bubbles: true, composed: true, detail: { prefix: target.key },
        }));
      } else if (id === "new-folder") {
        this.dispatchEvent(new CustomEvent("s3-new-folder-request", {
          bubbles: true, composed: true, detail: { prefix: target.key },
        }));
      } else if (id === "rename") {
        this.dispatchEvent(new CustomEvent("s3-rename-request", {
          bubbles: true, composed: true, detail: { key: target.key, kind: target.kind, size: target.size },
        }));
      } else if (id === "delete") {
        this.dispatchEvent(new CustomEvent("s3-delete-request", {
          bubbles: true, composed: true, detail: { key: target.key, kind: target.kind },
        }));
      }
    });
    this.#shadow.appendChild(this.#ctxMenu);
  }

  connectedCallback(): void { this.#render(); }

  /** Reset all cached listings/expand state — call when switching cards or refreshing from scratch. */
  reset(): void {
    this.#nodes.clear();
    this.#expanded.clear();
    this.#render();
  }

  /** Set (or replace) the listing for a prefix ("" = root). Triggers a re-render. */
  setNode(prefix: string, state: S3TreeNodeState): void {
    this.#nodes.set(prefix, state);
    this.#render();
  }

  /** Append additional entries to an already-loaded node (pagination). */
  appendNode(prefix: string, more: S3TreeEntry[], continuationToken: string | undefined): void {
    const existing = this.#nodes.get(prefix);
    this.#nodes.set(prefix, {
      entries: [...(existing?.entries ?? []), ...more],
      continuationToken,
      loading: false,
      error: undefined,
    });
    this.#render();
  }

  #render(): void {
    for (const child of [...this.#shadow.children]) {
      if (child.tagName !== "STYLE" && child !== this.#ctxMenu) child.remove();
    }
    const root = this.#nodes.get("");
    if (!root) {
      const loading = document.createElement("div");
      loading.className = "empty-text";
      loading.textContent = "Loading…";
      this.#shadow.appendChild(loading);
      return;
    }
    this.#shadow.appendChild(this.#renderNode("", root));
  }

  #renderNode(prefix: string, node: S3TreeNodeState): HTMLElement {
    const wrap = document.createElement("div");
    if (node.entries.length === 0 && !node.loading && !node.error) {
      const empty = document.createElement("div");
      empty.className = "empty-text";
      empty.textContent = "Empty folder";
      wrap.appendChild(empty);
    }
    for (const entry of node.entries) {
      wrap.appendChild(entry.kind === "prefix" ? this.#folderRow(entry) : this.#objectRow(entry));
    }
    if (node.error) {
      const err = document.createElement("div");
      err.className = "error-text";
      err.textContent = node.error;
      wrap.appendChild(err);
    }
    if (node.continuationToken) {
      const more = document.createElement("div");
      more.className = "row";
      more.textContent = "Load more…";
      more.addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("s3-load-more", {
          bubbles: true, composed: true, detail: { prefix, continuationToken: node.continuationToken },
        }));
      });
      wrap.appendChild(more);
    }
    return wrap;
  }

  /** Single "…" button opening a context menu, shared by folder/object rows. */
  #menuButton(entry: S3TreeEntry): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "row-menu-btn";
    btn.title = "More actions";
    btn.textContent = "⋯";
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.#ctxMenuTarget = entry;
      const groups: ContextMenuGroup[] = entry.kind === "prefix"
        ? [{
            category: "Folder",
            items: [
              { id: "upload", label: "Upload here" },
              { id: "new-folder", label: "New folder here" },
              { id: "rename", label: "Rename" },
              { id: "delete", label: "Delete", destructive: true },
            ],
          }]
        : [{
            category: "File",
            items: [
              { id: "rename", label: "Rename" },
              { id: "delete", label: "Delete", destructive: true },
            ],
          }];
      const r = btn.getBoundingClientRect();
      this.#ctxMenu.open(r.left, r.bottom, groups);
    });
    return btn;
  }

  #folderRow(entry: S3TreeEntry): HTMLElement {
    const isExpanded = this.#expanded.has(entry.key);
    const container = document.createElement("div");

    const row = document.createElement("div");
    row.className = "row";
    const arrow = document.createElement("span");
    arrow.className = "arrow" + (isExpanded ? "" : " collapsed");
    arrow.textContent = "▾";
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = "📁";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = baseName(entry.key) + "/";
    row.append(arrow, icon, name, this.#menuButton(entry));
    row.addEventListener("click", () => {
      const willExpand = !this.#expanded.has(entry.key);
      if (willExpand) {
        this.#expanded.add(entry.key);
      } else {
        this.#expanded.delete(entry.key);
      }
      const hasData = this.#nodes.has(entry.key);
      this.#render();
      if (willExpand && !hasData) {
        this.dispatchEvent(new CustomEvent("s3-expand", {
          bubbles: true, composed: true, detail: { prefix: entry.key },
        }));
      }
    });
    container.appendChild(row);

    const node = this.#nodes.get(entry.key);
    if (isExpanded) {
      const childrenWrap = document.createElement("div");
      childrenWrap.className = "children";
      if (node?.loading) {
        const loading = document.createElement("div");
        loading.className = "empty-text";
        loading.textContent = "Loading…";
        childrenWrap.appendChild(loading);
      } else if (node) {
        childrenWrap.appendChild(this.#renderNode(entry.key, node));
      }
      container.appendChild(childrenWrap);
    }
    return container;
  }

  #objectRow(entry: S3TreeEntry): HTMLElement {
    const row = document.createElement("div");
    row.className = "row";
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = "📄";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = baseName(entry.key);
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = humanSize(entry.size);
    row.append(icon, name, meta, this.#menuButton(entry));
    row.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("s3-open", { bubbles: true, composed: true, detail: { key: entry.key } }));
    });
    return row;
  }
}

customElements.define("ls-s3-tree", LSS3Tree);
