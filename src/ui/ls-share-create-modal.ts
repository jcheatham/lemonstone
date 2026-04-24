// <ls-share-create-modal> — password-entry + link-display for creating a
// shareable vault URL.
//
// Flow: caller sets the source vault via setVault() then show()s the modal.
// The user enters a password twice; we build the encrypted link and reveal
// it with a Copy button. On dismiss, the modal resets.

import { encodeShareLink } from "../vault/share-link.ts";
import { loadTokens } from "../auth/token-store.ts";
import { dbNameFor } from "../vault/manifest.ts";

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
    width: min(520px, 94vw);
    box-shadow: 0 24px 48px rgba(0,0,0,0.55);
  }
  h2 { margin: 0 0 6px; font-size: 17px; color: var(--ls-color-fg, #e0e0e0); }
  p { margin: 0 0 12px; color: var(--ls-color-fg-muted, #64748b); font-size: 13px; line-height: 1.5; }
  .warning {
    background: rgba(245,158,11,0.12);
    border: 1px solid #f59e0b;
    color: #fcd34d;
    padding: 10px 12px;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.5;
    margin-bottom: 14px;
  }
  label { display: block; font-size: 12px; color: var(--ls-color-fg-muted, #64748b); margin-bottom: 4px; }
  input[type="password"], input[type="text"], textarea {
    width: 100%;
    box-sizing: border-box;
    background: var(--ls-color-bg-input, #0f0f1a);
    border: 1px solid var(--ls-color-border, #333);
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--ls-color-fg, #e0e0e0);
    font: inherit;
    font-size: 13px;
    outline: none;
    caret-color: var(--ls-color-accent, #7c6af7);
    margin-bottom: 10px;
  }
  textarea {
    min-height: 80px;
    font-family: var(--ls-font-mono, monospace);
    font-size: 11px;
    word-break: break-all;
    white-space: pre-wrap;
    resize: vertical;
  }
  input:focus, textarea:focus { border-color: var(--ls-color-accent, #7c6af7); }
  .error { margin-top: 4px; color: #f87171; font-size: 12px; display: none; }
  .error.visible { display: block; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
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
  .phase { display: none; }
  .phase.active { display: block; }
`;

const MIN_PW_LEN = 10;

export class LSShareCreateModal extends HTMLElement {
  #shadow: ShadowRoot;
  #vaultId = "";
  #repoFullName = "";
  #repoDefaultBranch = "";

  // Phase 1: password entry.
  #pass1!: HTMLInputElement;
  #pass2!: HTMLInputElement;
  #pwError!: HTMLElement;
  #submit!: HTMLButtonElement;
  #cancel!: HTMLButtonElement;
  #p1!: HTMLElement;

  // Phase 2: link display.
  #linkOutput!: HTMLTextAreaElement;
  #copyBtn!: HTMLButtonElement;
  #doneBtn!: HTMLButtonElement;
  #p2!: HTMLElement;
  #title!: HTMLElement;
  #lead!: HTMLElement;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    this.#buildDOM();

    this.addEventListener("click", (e) => {
      // Shadow DOM retargets e.target to the host for listeners outside the
      // shadow, so `e.target === this` is true even for clicks on inputs
      // inside the panel. `composedPath()[0]` gives the real innermost
      // target — if that's the host itself, the click was on the backdrop.
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

    // ── Phase 1: password
    this.#p1 = document.createElement("div");
    this.#p1.className = "phase active";

    this.#title = document.createElement("h2");
    this.#title.textContent = "Create share link";
    this.#lead = document.createElement("p");
    this.#lead.textContent =
      "Choose a password. The recipient needs both the link (you can share " +
      "it anywhere) and the password (share it out-of-band, e.g. a different app).";

    const warn = document.createElement("div");
    warn.className = "warning";
    warn.innerHTML =
      "<strong>Sharing this link grants full access to the repo.</strong> " +
      "The receiver can read, write, and delete notes. If the password leaks, " +
      "anyone with the link can do the same. Revoke the token on GitHub to " +
      "cut off access.";

    const lbl1 = document.createElement("label");
    lbl1.textContent = `Password (${MIN_PW_LEN}+ characters)`;
    this.#pass1 = document.createElement("input");
    this.#pass1.type = "password";
    this.#pass1.autocomplete = "new-password";

    const lbl2 = document.createElement("label");
    lbl2.textContent = "Confirm password";
    this.#pass2 = document.createElement("input");
    this.#pass2.type = "password";
    this.#pass2.autocomplete = "new-password";
    this.#pass2.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.#attemptCreate();
    });

    this.#pwError = document.createElement("div");
    this.#pwError.className = "error";

    const actions = document.createElement("div");
    actions.className = "actions";
    this.#cancel = document.createElement("button");
    this.#cancel.className = "secondary";
    this.#cancel.textContent = "Cancel";
    this.#cancel.addEventListener("click", () => this.#dismiss());
    this.#submit = document.createElement("button");
    this.#submit.textContent = "Create link";
    this.#submit.addEventListener("click", () => this.#attemptCreate());
    actions.append(this.#cancel, this.#submit);

    this.#p1.append(this.#title, this.#lead, warn, lbl1, this.#pass1, lbl2, this.#pass2, this.#pwError, actions);

    // ── Phase 2: link display
    this.#p2 = document.createElement("div");
    this.#p2.className = "phase";

    const p2Title = document.createElement("h2");
    p2Title.textContent = "Share link ready";
    const p2Lead = document.createElement("p");
    p2Lead.textContent =
      "Copy the URL below and send it to the recipient. Send the password " +
      "separately. The URL doesn't work without the password.";

    const lblLink = document.createElement("label");
    lblLink.textContent = "Share URL";
    this.#linkOutput = document.createElement("textarea");
    this.#linkOutput.readOnly = true;
    this.#linkOutput.rows = 4;
    this.#linkOutput.addEventListener("focus", () => this.#linkOutput.select());

    const actions2 = document.createElement("div");
    actions2.className = "actions";
    this.#copyBtn = document.createElement("button");
    this.#copyBtn.className = "secondary";
    this.#copyBtn.textContent = "Copy";
    this.#copyBtn.addEventListener("click", () => this.#copyLink());
    this.#doneBtn = document.createElement("button");
    this.#doneBtn.textContent = "Done";
    this.#doneBtn.addEventListener("click", () => this.#dismiss());
    actions2.append(this.#copyBtn, this.#doneBtn);

    this.#p2.append(p2Title, p2Lead, lblLink, this.#linkOutput, actions2);

    panel.append(this.#p1, this.#p2);
    this.#shadow.appendChild(panel);
  }

  setVault(vault: { id: string; label: string; repoFullName: string; repoDefaultBranch: string }): void {
    this.#vaultId = vault.id;
    this.#repoFullName = vault.repoFullName;
    this.#repoDefaultBranch = vault.repoDefaultBranch;
    this.#title.textContent = `Share "${vault.label}"`;
    this.#lead.textContent =
      `Create a link that grants access to ${vault.repoFullName}. The recipient ` +
      `needs both the link and the password you set here (shared separately).`;
  }

  show(): void {
    this.classList.add("visible");
    this.#p1.classList.add("active");
    this.#p2.classList.remove("active");
    this.#pass1.value = "";
    this.#pass2.value = "";
    this.#pwError.classList.remove("visible");
    this.#linkOutput.value = "";
    this.#submit.disabled = false;
    this.#submit.textContent = "Create link";
    this.#cancel.disabled = false;
    requestAnimationFrame(() => this.#pass1.focus());
  }

  hide(): void { this.classList.remove("visible"); }

  async #attemptCreate(): Promise<void> {
    this.#pwError.classList.remove("visible");
    const p1 = this.#pass1.value;
    const p2 = this.#pass2.value;
    if (p1.length < MIN_PW_LEN) {
      this.#showPwError(`Password must be at least ${MIN_PW_LEN} characters.`);
      return;
    }
    if (p1 !== p2) {
      this.#showPwError("Passwords don't match.");
      return;
    }
    if (!this.#vaultId) {
      this.#showPwError("No vault selected.");
      return;
    }
    this.#submit.disabled = true;
    this.#submit.textContent = "Encrypting…";
    this.#cancel.disabled = true;
    try {
      const tokens = await loadTokens(dbNameFor(this.#vaultId));
      if (!tokens) throw new Error("No stored PAT for this vault.");
      const blob = await encodeShareLink(
        {
          version: 1,
          repoFullName: this.#repoFullName,
          repoDefaultBranch: this.#repoDefaultBranch,
          accessToken: tokens.accessToken,
        },
        p1,
      );
      const url = `${location.origin}${location.pathname}#/share/${blob}`;
      this.#linkOutput.value = url;
      this.#p1.classList.remove("active");
      this.#p2.classList.add("active");
      requestAnimationFrame(() => this.#linkOutput.select());
    } catch (err) {
      this.#showPwError(`Could not build link: ${(err as Error).message}`);
    } finally {
      this.#submit.disabled = false;
      this.#submit.textContent = "Create link";
      this.#cancel.disabled = false;
    }
  }

  async #copyLink(): Promise<void> {
    const prev = this.#copyBtn.textContent;
    try {
      await navigator.clipboard.writeText(this.#linkOutput.value);
      this.#copyBtn.textContent = "Copied";
    } catch {
      this.#copyBtn.textContent = "Copy failed";
    }
    setTimeout(() => { this.#copyBtn.textContent = prev; }, 2000);
  }

  #showPwError(msg: string): void {
    this.#pwError.textContent = msg;
    this.#pwError.classList.add("visible");
  }

  #dismiss(): void {
    if (this.#submit.disabled) return; // mid-encrypt
    this.hide();
  }
}

customElements.define("ls-share-create-modal", LSShareCreateModal);
