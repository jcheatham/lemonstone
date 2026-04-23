// <ls-unlock-modal> — passphrase entry to unlock an encrypted zone.
//
// Shown lazily: the first time the user tries to read/write a file that
// falls inside a locked zone, the app intercepts the resulting
// ZoneLockedError, sets the zone prefix on this modal, and shows it.
//
// Events (bubbles, composed):
//   vault-unlock        — detail: { passphrase, zoneId } — submit
//   vault-unlock-cancel — detail: { zoneId } — user dismissed without unlocking
//
// Dismissable via Cancel button, Escape key, or clicking the backdrop.

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
    padding: 24px;
    width: min(420px, 90vw);
    box-shadow: 0 24px 48px rgba(0,0,0,0.55);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 17px;
    color: var(--ls-color-fg, #e0e0e0);
  }
  p {
    margin: 0 0 16px;
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 13px;
    line-height: 1.5;
  }
  input[type="password"] {
    width: 100%;
    box-sizing: border-box;
    background: var(--ls-color-bg-input, #0f0f1a);
    border: 1px solid var(--ls-color-border, #333);
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--ls-color-fg, #e0e0e0);
    font: inherit;
    font-size: 14px;
    outline: none;
    caret-color: var(--ls-color-accent, #7c6af7);
  }
  input[type="password"]:focus { border-color: var(--ls-color-accent, #7c6af7); }
  .error {
    margin-top: 8px;
    color: #f87171;
    font-size: 12px;
    display: none;
  }
  .error.visible { display: block; }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  button {
    background: var(--ls-color-accent, #7c6af7);
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button.secondary {
    background: rgba(255,255,255,0.06);
    color: var(--ls-color-fg, #e0e0e0);
    border: 1px solid var(--ls-color-border, #333);
  }
`;

export class LSUnlockModal extends HTMLElement {
  #shadow: ShadowRoot;
  #title!: HTMLElement;
  #input!: HTMLInputElement;
  #error!: HTMLElement;
  #submit!: HTMLButtonElement;
  #cancel!: HTMLButtonElement;
  #zoneId: string | null = null;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    this.#buildDOM();

    // Backdrop click (click on the host itself, not the panel) dismisses.
    this.addEventListener("click", (e) => {
      if (e.target === this) this.#dismiss();
    });
    // Escape closes from anywhere inside the modal — including when focus
    // is on the password input.
    this.#shadow.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") { ke.preventDefault(); this.#dismiss(); }
    });
  }

  #buildDOM(): void {
    const panel = document.createElement("div");
    panel.className = "panel";

    this.#title = document.createElement("h2");
    this.#title.textContent = "Unlock folder";

    const info = document.createElement("p");
    info.textContent =
      "Enter the passphrase for this folder. The passphrase is never sent " +
      "anywhere — decryption happens locally.";

    this.#input = document.createElement("input");
    this.#input.type = "password";
    this.#input.placeholder = "Passphrase";
    this.#input.autocomplete = "current-password";
    this.#input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.#submitPassphrase();
    });

    this.#error = document.createElement("div");
    this.#error.className = "error";

    const actions = document.createElement("div");
    actions.className = "actions";

    this.#cancel = document.createElement("button");
    this.#cancel.className = "secondary";
    this.#cancel.textContent = "Cancel";
    this.#cancel.addEventListener("click", () => this.#dismiss());

    this.#submit = document.createElement("button");
    this.#submit.textContent = "Unlock";
    this.#submit.addEventListener("click", () => this.#submitPassphrase());

    actions.append(this.#cancel, this.#submit);

    panel.append(this.#title, info, this.#input, this.#error, actions);
    this.#shadow.appendChild(panel);
  }

  /** Identify the zone this modal is unlocking. Sets the title to include the folder prefix. */
  setZone(zoneId: string, prefix: string): void {
    this.#zoneId = zoneId;
    this.#title.textContent = `Unlock ${prefix}`;
  }

  show(): void {
    this.classList.add("visible");
    this.#input.value = "";
    this.#input.disabled = false;
    this.#error.classList.remove("visible");
    this.#submit.disabled = false;
    requestAnimationFrame(() => this.#input.focus());
  }

  hide(): void {
    this.classList.remove("visible");
  }

  setError(message: string): void {
    this.#error.textContent = message;
    this.#error.classList.add("visible");
    this.#input.select();
    this.#submit.disabled = false;
  }

  setBusy(busy: boolean): void {
    this.#submit.disabled = busy;
    this.#submit.textContent = busy ? "Unlocking…" : "Unlock";
    this.#cancel.disabled = busy;
    this.#input.disabled = busy;
  }

  #submitPassphrase(): void {
    const passphrase = this.#input.value;
    if (!passphrase) return;
    if (!this.#zoneId) {
      this.setError("No zone selected. Close and retry.");
      return;
    }
    this.#error.classList.remove("visible");
    this.dispatchEvent(new CustomEvent("vault-unlock", {
      bubbles: true,
      composed: true,
      detail: { passphrase, zoneId: this.#zoneId },
    }));
  }

  #dismiss(): void {
    if (this.#submit.disabled) return; // mid-unlock; wait for it to finish
    const zoneId = this.#zoneId;
    this.hide();
    this.dispatchEvent(new CustomEvent("vault-unlock-cancel", {
      bubbles: true,
      composed: true,
      detail: { zoneId },
    }));
  }
}

customElements.define("ls-unlock-modal", LSUnlockModal);
