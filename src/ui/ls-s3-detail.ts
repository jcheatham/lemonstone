// <ls-s3-detail> — main-pane view for a browsed S3 vault card, parallel to
// <ls-vault-detail>. Hosts an internal <ls-s3-tree>; events from that tree
// bubble+compose straight through this element's shadow boundary, so the
// parent only needs one listener.
//
// Events (bubbles, composed):
//   s3-refresh            — refresh button clicked
//   s3-upload-request     — header "Upload" button (prefix: "") OR forwarded
//                           from a folder row's "upload here" (prefix: that folder)
//   s3-new-folder-request — header "New folder" button (prefix: "") OR forwarded
//                           from a folder row's "new folder here" (prefix: that folder)
//   s3-expand, s3-load-more, s3-open, s3-rename-request, s3-delete-request
//                         — forwarded from the internal tree

import "./ls-s3-tree.ts";
import type { LSS3Tree, S3TreeEntry, S3TreeNodeState } from "./ls-s3-tree.ts";

const style = `
  :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; font-family: var(--ls-font-ui, system-ui, sans-serif); }
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--ls-color-border, #2a2a3e);
    flex-shrink: 0;
  }
  .title { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .name { font-size: 16px; font-weight: 600; color: var(--ls-color-fg, #e0e0e0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: 12px; color: var(--ls-color-fg-muted, #64748b); font-family: var(--ls-font-mono, monospace); }
  button {
    background: rgba(255,255,255,0.06);
    color: var(--ls-color-fg, #e0e0e0);
    border: 1px solid var(--ls-color-border, #2a2a3e);
    padding: 6px 12px;
    font-size: 12px;
    font-family: inherit;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
  }
  button:hover { background: rgba(255,255,255,0.1); }
  button.primary { background: var(--ls-color-accent, #7c6af7); border-color: var(--ls-color-accent, #7c6af7); color: white; }
  .body { flex: 1; overflow-y: auto; padding: 12px 8px; }
`;

export class LSS3Detail extends HTMLElement {
  #shadow: ShadowRoot;
  #tree: LSS3Tree;
  #nameEl!: HTMLElement;
  #subEl!: HTMLElement;
  #body!: HTMLElement;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);

    const header = document.createElement("div");
    header.className = "header";
    const title = document.createElement("div");
    title.className = "title";
    this.#nameEl = document.createElement("div");
    this.#nameEl.className = "name";
    this.#subEl = document.createElement("div");
    this.#subEl.className = "sub";
    title.append(this.#nameEl, this.#subEl);
    const newFolder = document.createElement("button");
    newFolder.textContent = "New folder";
    newFolder.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("s3-new-folder-request", { bubbles: true, composed: true, detail: { prefix: "" } }));
    });
    const upload = document.createElement("button");
    upload.className = "primary";
    upload.textContent = "Upload";
    upload.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("s3-upload-request", { bubbles: true, composed: true, detail: { prefix: "" } }));
    });
    const refresh = document.createElement("button");
    refresh.textContent = "Refresh";
    refresh.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("s3-refresh", { bubbles: true, composed: true }));
    });
    header.append(title, newFolder, upload, refresh);

    this.#body = document.createElement("div");
    this.#body.className = "body";
    this.#tree = document.createElement("ls-s3-tree") as LSS3Tree;
    this.#body.appendChild(this.#tree);

    this.#shadow.append(header, this.#body);
  }

  setCard(displayName: string, bucket: string, region: string): void {
    this.#nameEl.textContent = displayName;
    this.#subEl.textContent = `${bucket} · ${region}`;
  }

  reset(): void { this.#tree.reset(); }
  setNode(prefix: string, state: S3TreeNodeState): void { this.#tree.setNode(prefix, state); }
  appendNode(prefix: string, more: S3TreeEntry[], continuationToken: string | undefined): void {
    this.#tree.appendNode(prefix, more, continuationToken);
  }
}

customElements.define("ls-s3-detail", LSS3Detail);
