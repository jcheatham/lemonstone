// <ls-s3-card-accept-modal> — "activate" an S3 vault found in note
// content. Mirrors <ls-share-accept-modal> almost exactly: prompts for the
// passphrase, decrypts locally, and fires `s3-card-accept` with the decoded
// payload so the caller can re-verify the connection and cache it for this
// device. The passphrase never leaves this component/the caller's memory.

import { decodeS3Card, type S3CardPayload } from "../s3/card.ts";

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
    width: min(440px, 92vw);
    box-shadow: 0 24px 48px rgba(0,0,0,0.55);
  }
  h2 { margin: 0 0 8px; font-size: 17px; color: var(--ls-color-fg, #e0e0e0); }
  p { margin: 0 0 14px; color: var(--ls-color-fg-muted, #64748b); font-size: 13px; line-height: 1.5; }
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
  .error { margin-top: 8px; color: #f87171; font-size: 12px; display: none; white-space: pre-wrap; }
  .error.visible { display: block; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
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
  button:disabled { opacity: 0.5; cursor: default; }
  button.secondary {
    background: rgba(255,255,255,0.06);
    color: var(--ls-color-fg, #e0e0e0);
    border: 1px solid var(--ls-color-border, #333);
  }
`;

export class LSS3CardAcceptModal extends HTMLElement {
  #shadow: ShadowRoot;
  #input!: HTMLInputElement;
  #error!: HTMLElement;
  #submit!: HTMLButtonElement;
  #cancel!: HTMLButtonElement;
  #blob = "";

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    this.#buildDOM();

    this.addEventListener("click", (e) => {
      if (e.composedPath()[0] === this) this.#dismiss();
    });
    this.#shadow.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") { ke.preventDefault(); this.#dismiss(); }
    });
  }

  #buildDOM(): void {
    const panel = document.createElement("div");
    panel.className = "panel";

    const title = document.createElement("h2");
    title.textContent = "S3 vault";

    const info = document.createElement("p");
    info.textContent =
      "This note contains an encrypted S3 vault. Enter its passphrase " +
      "to grant this device access to the bucket. The passphrase is only " +
      "used locally — it isn't sent anywhere.";

    this.#input = document.createElement("input");
    this.#input.type = "password";
    this.#input.placeholder = "Passphrase";
    this.#input.autocomplete = "off";
    this.#input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.#attemptDecode();
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
    this.#submit.textContent = "Grant access";
    this.#submit.addEventListener("click", () => this.#attemptDecode());

    actions.append(this.#cancel, this.#submit);
    panel.append(title, info, this.#input, this.#error, actions);
    this.#shadow.appendChild(panel);
  }

  setBlob(blob: string): void { this.#blob = blob; }

  show(): void {
    this.classList.add("visible");
    this.#input.value = "";
    this.#input.disabled = false;
    this.#error.classList.remove("visible");
    this.#submit.disabled = false;
    this.#submit.textContent = "Grant access";
    this.#cancel.disabled = false;
    requestAnimationFrame(() => this.#input.focus());
  }

  hide(): void { this.classList.remove("visible"); }

  setError(message: string): void {
    this.#error.textContent = message;
    this.#error.classList.add("visible");
    this.#submit.disabled = false;
    this.#submit.textContent = "Grant access";
    this.#cancel.disabled = false;
    this.#input.select();
  }

  setBusy(busy: boolean): void {
    this.#submit.disabled = busy;
    this.#submit.textContent = busy ? "Verifying…" : "Grant access";
    this.#cancel.disabled = busy;
    this.#input.disabled = busy;
  }

  async #attemptDecode(): Promise<void> {
    const passphrase = this.#input.value;
    if (!passphrase) return;
    if (!this.#blob) { this.setError("No vault data present."); return; }
    this.#error.classList.remove("visible");
    this.setBusy(true);
    try {
      const payload = await decodeS3Card(this.#blob, passphrase);
      this.dispatchEvent(new CustomEvent("s3-card-accept", {
        bubbles: true,
        composed: true,
        detail: { payload } as { payload: S3CardPayload },
      }));
    } catch (err) {
      const msg = (err as Error).message === "wrong passphrase"
        ? "Wrong passphrase — try again."
        : `Could not open this card: ${(err as Error).message}`;
      this.setError(msg);
    } finally {
      this.setBusy(false);
    }
  }

  #dismiss(): void {
    if (this.#submit.disabled) return; // mid-decrypt
    this.hide();
    this.dispatchEvent(new CustomEvent("s3-card-accept-cancel", { bubbles: true, composed: true }));
  }
}

customElements.define("ls-s3-card-accept-modal", LSS3CardAcceptModal);
