// <ls-s3-card-create-modal> — the "Insert S3 vault…" macro's UI.
//
// An S3 vault is a self-contained, passphrase-encrypted blob embedded in
// note content (see src/s3/card.ts) — no zone, no manifest. Two steps:
//
//   1. "details" — bucket, region, display name, and AWS credential fields.
//      On submit fires `s3-card-details-submit` — the caller runs the
//      connection test against these (not-yet-persisted) values and, on
//      success, calls `showPassphraseStep()`; on failure, `setError(...)`.
//   2. "passphrase" — choose a passphrase to protect the vault. On submit
//      fires `s3-card-passphrase-submit` with BOTH the passphrase and the
//      step-1 details (so the caller has everything needed to encode the
//      blob in one place) — the caller encodes it, inserts it into the
//      editor, and calls `hide()`/`setError()`.
//
// Mirrors <ls-encrypt-folder-modal>'s overlay/panel/lifecycle shape
// (show/hide/setBusy/setError), so all async orchestration stays in ls-app.ts.

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
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 24px 48px rgba(0,0,0,0.55);
  }
  h2 { margin: 0 0 8px; font-size: 17px; color: var(--ls-color-fg, #e0e0e0); }
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
  input {
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
  input:focus { border-color: var(--ls-color-accent, #7c6af7); }
  .field { margin-bottom: 2px; }
  .error { margin-top: 4px; color: #f87171; font-size: 12px; display: none; white-space: pre-wrap; }
  .error.visible { display: block; }
  .step { display: none; }
  .step.active { display: block; }
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

const MIN_PASSPHRASE_LEN = 12;

export interface S3CardDetails {
  displayName: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export class LSS3CardCreateModal extends HTMLElement {
  #shadow: ShadowRoot;
  #panel!: HTMLElement;

  // Details step
  #displayName!: HTMLInputElement;
  #bucket!: HTMLInputElement;
  #region!: HTMLInputElement;
  #accessKeyId!: HTMLInputElement;
  #secretAccessKey!: HTMLInputElement;
  #sessionToken!: HTMLInputElement;
  #detailsError!: HTMLElement;
  #detailsSubmit!: HTMLButtonElement;
  #detailsCancel!: HTMLButtonElement;

  // Passphrase step
  #pass1!: HTMLInputElement;
  #pass2!: HTMLInputElement;
  #passError!: HTMLElement;
  #passSubmit!: HTMLButtonElement;
  #passCancel!: HTMLButtonElement;
  #lastDetails: S3CardDetails | null = null;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    this.#panel = document.createElement("div");
    this.#panel.className = "panel";
    this.#shadow.appendChild(this.#panel);
    this.#buildDetailsStep();
    this.#buildPassphraseStep();
  }

  // ── Details step ─────────────────────────────────────────────────────────

  #buildDetailsStep(): void {
    const step = document.createElement("div");
    step.className = "step";
    step.dataset["step"] = "details";

    const h2 = document.createElement("h2");
    h2.textContent = "Insert an S3 vault";
    const lead = document.createElement("p");
    lead.textContent =
      "Enter the bucket and an AWS credential scoped to it. We'll test the " +
      "connection before anything is encrypted or inserted.";

    const nameField = this.#field("Display name", (input) => {
      this.#displayName = input;
      input.placeholder = "my-bucket";
      input.autocomplete = "off";
    });
    const bucketField = this.#field("Bucket name", (input) => {
      this.#bucket = input;
      input.placeholder = "my-bucket";
      input.autocomplete = "off";
    });
    const regionField = this.#field("Region", (input) => {
      this.#region = input;
      input.placeholder = "us-east-1";
      input.autocomplete = "off";
    });
    const keyField = this.#field("Access key ID", (input) => {
      this.#accessKeyId = input;
      input.autocomplete = "off";
    });
    const secretField = this.#field("Secret access key", (input) => {
      this.#secretAccessKey = input;
      input.type = "password";
      input.autocomplete = "off";
    });
    const tokenField = this.#field("Session token (optional, for STS credentials)", (input) => {
      this.#sessionToken = input;
      input.type = "password";
      input.autocomplete = "off";
    });

    this.#detailsError = document.createElement("div");
    this.#detailsError.className = "error";

    const actions = document.createElement("div");
    actions.className = "actions";
    this.#detailsCancel = document.createElement("button");
    this.#detailsCancel.className = "secondary";
    this.#detailsCancel.textContent = "Cancel";
    this.#detailsCancel.addEventListener("click", () => this.#cancel());
    this.#detailsSubmit = document.createElement("button");
    this.#detailsSubmit.textContent = "Test connection & continue";
    this.#detailsSubmit.addEventListener("click", () => this.#submitDetailsStep());
    actions.append(this.#detailsCancel, this.#detailsSubmit);

    step.append(
      h2, lead,
      nameField, bucketField, regionField, keyField, secretField, tokenField,
      this.#detailsError, actions
    );
    this.#panel.appendChild(step);
  }

  #field(labelText: string, configure: (input: HTMLInputElement) => void): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    configure(input);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.#submitDetailsStep();
    });
    wrap.append(label, input);
    return wrap;
  }

  #submitDetailsStep(): void {
    this.#detailsError.classList.remove("visible");
    const displayName = this.#displayName.value.trim();
    const bucket = this.#bucket.value.trim();
    const region = this.#region.value.trim();
    const accessKeyId = this.#accessKeyId.value.trim();
    const secretAccessKey = this.#secretAccessKey.value;
    const sessionToken = this.#sessionToken.value.trim() || undefined;

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      this.setError("Bucket, region, access key, and secret key are all required.");
      return;
    }

    this.#lastDetails = { displayName: displayName || bucket, bucket, region, accessKeyId, secretAccessKey, sessionToken };
    this.dispatchEvent(
      new CustomEvent("s3-card-details-submit", { bubbles: true, composed: true, detail: this.#lastDetails })
    );
  }

  // ── Passphrase step ──────────────────────────────────────────────────────

  #buildPassphraseStep(): void {
    const step = document.createElement("div");
    step.className = "step";
    step.dataset["step"] = "passphrase";

    const h2 = document.createElement("h2");
    h2.textContent = "Protect this vault";
    const lead = document.createElement("p");
    lead.textContent =
      "Choose a passphrase for this vault. Anyone with the note text and this " +
      "passphrase can use the credential, so treat it like a real secret — " +
      "share it out of band, never alongside the note itself.";
    const warning = document.createElement("div");
    warning.className = "warning";
    warning.innerHTML =
      "<strong>No recovery.</strong> If you forget this passphrase, the vault " +
      "becomes permanently unreadable (the bucket itself is unaffected — " +
      "you'd just need to create a new vault). There is no reset link, no " +
      "customer support.";

    const label1 = document.createElement("label");
    label1.textContent = `Passphrase (${MIN_PASSPHRASE_LEN}+ characters)`;
    this.#pass1 = document.createElement("input");
    this.#pass1.type = "password";
    this.#pass1.autocomplete = "new-password";

    const label2 = document.createElement("label");
    label2.textContent = "Confirm passphrase";
    this.#pass2 = document.createElement("input");
    this.#pass2.type = "password";
    this.#pass2.autocomplete = "new-password";
    this.#pass2.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.#submitPassphraseStep();
    });

    this.#passError = document.createElement("div");
    this.#passError.className = "error";

    const actions = document.createElement("div");
    actions.className = "actions";
    this.#passCancel = document.createElement("button");
    this.#passCancel.className = "secondary";
    this.#passCancel.textContent = "Cancel";
    this.#passCancel.addEventListener("click", () => this.#cancel());
    this.#passSubmit = document.createElement("button");
    this.#passSubmit.textContent = "Create vault";
    this.#passSubmit.addEventListener("click", () => this.#submitPassphraseStep());
    actions.append(this.#passCancel, this.#passSubmit);

    step.append(h2, lead, warning, label1, this.#pass1, label2, this.#pass2, this.#passError, actions);
    this.#panel.appendChild(step);
  }

  #submitPassphraseStep(): void {
    this.#passError.classList.remove("visible");
    const p1 = this.#pass1.value;
    const p2 = this.#pass2.value;
    if (p1.length < MIN_PASSPHRASE_LEN) {
      this.setError(`Passphrase must be at least ${MIN_PASSPHRASE_LEN} characters.`);
      return;
    }
    if (p1 !== p2) {
      this.setError("Passphrases don't match.");
      return;
    }
    if (!this.#lastDetails) {
      this.setError("Something went wrong — please start over.");
      return;
    }
    this.dispatchEvent(
      new CustomEvent("s3-card-passphrase-submit", {
        bubbles: true, composed: true,
        detail: { passphrase: p1, ...this.#lastDetails },
      })
    );
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  #cancel(): void {
    this.hide();
    this.dispatchEvent(new CustomEvent("s3-card-cancel", { bubbles: true, composed: true }));
  }

  #showStep(name: "details" | "passphrase"): void {
    for (const el of this.#shadow.querySelectorAll<HTMLElement>(".step")) {
      el.classList.toggle("active", el.dataset["step"] === name);
    }
  }

  show(): void {
    this.classList.add("visible");
    this.#displayName.value = "";
    this.#bucket.value = "";
    this.#region.value = "";
    this.#accessKeyId.value = "";
    this.#secretAccessKey.value = "";
    this.#sessionToken.value = "";
    this.#detailsError.classList.remove("visible");
    this.#detailsSubmit.disabled = false;
    this.#detailsCancel.disabled = false;
    this.#detailsSubmit.textContent = "Test connection & continue";
    this.#lastDetails = null;
    this.#showStep("details");
    requestAnimationFrame(() => this.#bucket.focus());
  }

  /** Advance from the details step to the passphrase step (after a successful connection test). */
  showPassphraseStep(): void {
    this.#pass1.value = "";
    this.#pass2.value = "";
    this.#passError.classList.remove("visible");
    this.#passSubmit.disabled = false;
    this.#passCancel.disabled = false;
    this.#passSubmit.textContent = "Create vault";
    this.#showStep("passphrase");
    requestAnimationFrame(() => this.#pass1.focus());
  }

  hide(): void {
    this.classList.remove("visible");
  }

  setBusy(message: string): void {
    this.#detailsSubmit.disabled = true;
    this.#detailsCancel.disabled = true;
    this.#passSubmit.disabled = true;
    this.#passCancel.disabled = true;
    this.#passSubmit.textContent = message;
  }

  setError(message: string): void {
    const activeStep = this.#shadow.querySelector<HTMLElement>(".step.active")?.dataset["step"];
    if (activeStep === "details") {
      this.#detailsError.textContent = message;
      this.#detailsError.classList.add("visible");
      this.#detailsSubmit.disabled = false;
      this.#detailsCancel.disabled = false;
      this.#detailsSubmit.textContent = "Test connection & continue";
    } else {
      this.#passError.textContent = message;
      this.#passError.classList.add("visible");
      this.#passSubmit.disabled = false;
      this.#passCancel.disabled = false;
      this.#passSubmit.textContent = "Create vault";
    }
  }
}

customElements.define("ls-s3-card-create-modal", LSS3CardCreateModal);
