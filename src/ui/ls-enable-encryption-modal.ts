// <ls-encrypt-folder-modal> — set up an encryption zone for a selected folder.
//
// The user names the folder prefix (via setPrefix before show()), picks a
// passphrase, and confirms. Warnings about loss-of-passphrase = loss-of-data
// are explicit. On submit fires `zone-create` with detail { prefix, passphrase }.
// Parent runs the zone-creation flow and handles modal lifecycle.

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
    width: min(480px, 92vw);
    box-shadow: 0 24px 48px rgba(0,0,0,0.55);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 17px;
    color: var(--ls-color-fg, #e0e0e0);
  }
  p {
    margin: 0 0 12px;
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 13px;
    line-height: 1.5;
  }
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
  label {
    display: block;
    font-size: 12px;
    color: var(--ls-color-fg-muted, #64748b);
    margin-bottom: 4px;
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
    margin-bottom: 10px;
  }
  input[type="password"]:focus { border-color: var(--ls-color-accent, #7c6af7); }
  .strength {
    font-size: 11px;
    margin-top: -6px;
    margin-bottom: 10px;
    color: var(--ls-color-fg-muted, #64748b);
  }
  .error {
    margin-top: 4px;
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
  button:disabled { opacity: 0.5; cursor: default; }
  button.secondary {
    background: rgba(255,255,255,0.06);
    color: var(--ls-color-fg, #e0e0e0);
    border: 1px solid var(--ls-color-border, #333);
  }
`;

const MIN_LEN = 12;

export class LSEncryptFolderModal extends HTMLElement {
  #shadow: ShadowRoot;
  #title!: HTMLElement;
  #lead!: HTMLElement;
  #pass1!: HTMLInputElement;
  #pass2!: HTMLInputElement;
  #strength!: HTMLElement;
  #error!: HTMLElement;
  #submit!: HTMLButtonElement;
  #cancel!: HTMLButtonElement;
  #prefix: string = "";

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    this.#buildDOM();
  }

  #buildDOM(): void {
    const panel = document.createElement("div");
    panel.className = "panel";

    this.#title = document.createElement("h2");
    this.#title.textContent = "Encrypt folder";

    this.#lead = document.createElement("p");
    this.#lead.textContent =
      "Choose a passphrase. Every file under this folder will be encrypted " +
      "and future files added to it will be encrypted too. Folder and file " +
      "names remain visible in git.";

    const warning = document.createElement("div");
    warning.className = "warning";
    warning.innerHTML =
      "<strong>No recovery.</strong> If you forget this passphrase, the files " +
      "in this folder are permanently unreadable. There is no reset link, no " +
      "customer support, no server-side backup. Save it somewhere safe.";

    const label1 = document.createElement("label");
    label1.textContent = `Passphrase (${MIN_LEN}+ characters)`;
    this.#pass1 = document.createElement("input");
    this.#pass1.type = "password";
    this.#pass1.autocomplete = "new-password";
    this.#pass1.addEventListener("input", () => this.#updateStrength());

    this.#strength = document.createElement("div");
    this.#strength.className = "strength";

    const label2 = document.createElement("label");
    label2.textContent = "Confirm passphrase";
    this.#pass2 = document.createElement("input");
    this.#pass2.type = "password";
    this.#pass2.autocomplete = "new-password";
    this.#pass2.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.#attemptSubmit();
    });

    this.#error = document.createElement("div");
    this.#error.className = "error";

    const actions = document.createElement("div");
    actions.className = "actions";

    this.#cancel = document.createElement("button");
    this.#cancel.className = "secondary";
    this.#cancel.textContent = "Cancel";
    this.#cancel.addEventListener("click", () => this.hide());

    this.#submit = document.createElement("button");
    this.#submit.textContent = "Encrypt folder";
    this.#submit.addEventListener("click", () => this.#attemptSubmit());

    actions.append(this.#cancel, this.#submit);

    panel.append(this.#title, this.#lead, warning, label1, this.#pass1, this.#strength, label2, this.#pass2, this.#error, actions);
    this.#shadow.appendChild(panel);
  }

  /** Set the folder prefix this modal will create a zone for. Must end in "/". */
  setPrefix(prefix: string): void {
    this.#prefix = prefix;
    this.#title.textContent = `Encrypt folder: ${prefix}`;
  }

  show(): void {
    this.classList.add("visible");
    this.#pass1.value = "";
    this.#pass2.value = "";
    this.#strength.textContent = "";
    this.#error.classList.remove("visible");
    this.#submit.disabled = false;
    this.#submit.textContent = "Encrypt folder";
    requestAnimationFrame(() => this.#pass1.focus());
  }

  hide(): void {
    this.classList.remove("visible");
  }

  setBusy(message: string): void {
    this.#submit.disabled = true;
    this.#cancel.disabled = true;
    this.#submit.textContent = message;
  }

  setError(message: string): void {
    this.#error.textContent = message;
    this.#error.classList.add("visible");
    this.#submit.disabled = false;
    this.#cancel.disabled = false;
    this.#submit.textContent = "Encrypt folder";
  }

  #updateStrength(): void {
    const v = this.#pass1.value;
    if (!v) { this.#strength.textContent = ""; return; }
    if (v.length < MIN_LEN) {
      this.#strength.textContent = `Too short (${v.length}/${MIN_LEN})`;
      this.#strength.style.color = "#f87171";
      return;
    }
    const hasUpper = /[A-Z]/.test(v);
    const hasLower = /[a-z]/.test(v);
    const hasDigit = /[0-9]/.test(v);
    const hasSymbol = /[^A-Za-z0-9]/.test(v);
    const variety = Number(hasUpper) + Number(hasLower) + Number(hasDigit) + Number(hasSymbol);
    if (v.length >= 20 || variety >= 3) {
      this.#strength.textContent = "Strong passphrase.";
      this.#strength.style.color = "#86efac";
    } else {
      this.#strength.textContent = "Okay — longer or more varied is better.";
      this.#strength.style.color = "#fcd34d";
    }
  }

  #attemptSubmit(): void {
    this.#error.classList.remove("visible");
    const p1 = this.#pass1.value;
    const p2 = this.#pass2.value;
    if (p1.length < MIN_LEN) {
      this.setError(`Passphrase must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (p1 !== p2) {
      this.setError("Passphrases don't match.");
      return;
    }
    if (!this.#prefix) {
      this.setError("No folder selected.");
      return;
    }
    this.dispatchEvent(new CustomEvent("zone-create", {
      bubbles: true,
      composed: true,
      detail: { prefix: this.#prefix, passphrase: p1 },
    }));
  }
}

customElements.define("ls-encrypt-folder-modal", LSEncryptFolderModal);
