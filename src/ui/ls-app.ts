import { isAuthenticated } from "../auth/index.ts";
import "./ls-modal.ts";

const template = document.createElement("template");
template.innerHTML = `
<style>
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
    min-width: 240px;
    border-right: 1px solid var(--ls-color-border, #333);
    display: flex;
    flex-direction: column;
  }
  #main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  #status-bar {
    height: 24px;
    padding: 0 8px;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid var(--ls-color-border, #333);
    background: var(--ls-color-bg-subtle, #111);
  }
  #auth-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  #auth-overlay.visible {
    display: flex;
  }
</style>
<div id="sidebar">
  <slot name="file-tree"></slot>
</div>
<div id="main">
  <slot name="editor"></slot>
  <div id="status-bar">
    <span id="sync-status">Offline</span>
  </div>
</div>
<div id="auth-overlay">
  <ls-modal id="auth-modal"></ls-modal>
</div>
`;

export class LSApp extends HTMLElement {
  #authOverlay!: HTMLElement;

  connectedCallback(): void {
    const shadow = this.attachShadow({ mode: "open" });
    shadow.appendChild(template.content.cloneNode(true));
    this.#authOverlay = shadow.getElementById("auth-overlay")!;
    this.#init().catch(console.error);
  }

  async #init(): Promise<void> {
    const authed = await isAuthenticated();
    if (!authed) {
      this.#authOverlay.classList.add("visible");
    }
  }

  hideAuthOverlay(): void {
    this.#authOverlay.classList.remove("visible");
  }
}

customElements.define("ls-app", LSApp);
