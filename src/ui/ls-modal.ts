// <ls-modal> — GitHub PAT auth flow.
//
// Step 1: Token entry + validation
// Step 2: Repository entry
//
// Events (bubbles, composed):
//   auth-complete — detail: { tokens: AuthPayload } — caller persists and
//                   registers the vault (multi-vault aware).

import { validatePAT, fetchRepo, buildPATAuthPayload } from "../auth/index.ts";
import type { GitHubUser } from "../auth/index.ts";

const style = `
  :host {
    display: block;
    background: var(--ls-color-bg-elevated, #242438);
    border: 1px solid var(--ls-color-border, #444);
    border-radius: 8px;
    padding: 32px;
    min-width: 360px;
    max-width: 460px;
    font-family: var(--ls-font-ui, system-ui, sans-serif);
    color: var(--ls-color-fg, #e0e0e0);
  }
  h2 { margin: 0 0 8px; font-size: 20px; }
  .subtitle { margin: 0 0 20px; font-size: 13px; color: var(--ls-color-fg-muted, #94a3b8); line-height: 1.5; }
  label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 5px; color: var(--ls-color-fg-muted, #94a3b8); letter-spacing: 0.04em; text-transform: uppercase; }
  input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    background: var(--ls-color-bg, #1a1a2e);
    border: 1px solid var(--ls-color-border, #444);
    border-radius: 6px;
    color: var(--ls-color-fg, #e0e0e0);
    font-size: 14px;
    font-family: inherit;
    outline: none;
  }
  input:focus { border-color: var(--ls-color-accent, #7c6af7); }
  input.error { border-color: #f87171; }
  .field { margin-bottom: 16px; }
  .hint { margin-top: 4px; font-size: 11px; color: var(--ls-color-fg-muted, #64748b); }
  a { color: var(--ls-color-accent, #7c6af7); }
  .btn {
    display: block;
    width: 100%;
    padding: 10px;
    border: none;
    border-radius: 6px;
    background: var(--ls-color-accent, #7c6af7);
    color: #fff;
    font-size: 15px;
    font-family: inherit;
    cursor: pointer;
    margin-top: 4px;
  }
  .btn:hover { opacity: 0.9; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn-secondary {
    background: transparent;
    border: 1px solid var(--ls-color-border, #444);
    color: var(--ls-color-fg-muted, #94a3b8);
    margin-top: 8px;
  }
  .status { margin-top: 12px; font-size: 13px; color: var(--ls-color-fg-muted, #94a3b8); min-height: 18px; }
  .error-msg { color: #f87171; }
  .success-msg { color: #86efac; }
  .user-badge {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: rgba(134,239,172,0.08);
    border: 1px solid rgba(134,239,172,0.2);
    border-radius: 6px;
    margin-bottom: 16px;
  }
  .user-badge img { width: 28px; height: 28px; border-radius: 50%; }
  .user-badge span { font-size: 13px; color: #86efac; }
  .step { display: none; }
  .step.active { display: block; }
`;

export class LSModal extends HTMLElement {
  #shadow!: ShadowRoot;
  #user: GitHubUser | null = null;
  #token = "";

  connectedCallback(): void {
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    this.#renderStep1();
  }

  /** Reset the modal back to its initial empty state so it's ready for the
   *  next add-vault attempt. Safe to call any time — if the shadow isn't
   *  attached yet, connectedCallback's #renderStep1 already handled it. */
  reset(): void {
    if (!this.#shadow) return;
    this.#user = null;
    this.#token = "";
    this.#renderStep1();
  }

  // ── Step 1: Token entry ──────────────────────────────────────────────────

  #renderStep1(): void {
    this.#shadow.querySelectorAll(".step").forEach((el) => el.remove());

    const step = document.createElement("div");
    step.className = "step active";

    step.innerHTML = `
      <h2>Connect GitHub</h2>
      <p class="subtitle">Lemonstone stores your notes in a GitHub repository you own.
        Create a Personal Access Token so Lemonstone can read and write your notes.</p>
    `;

    const tokenLink = document.createElement("p");
    tokenLink.className = "subtitle";
    const a = document.createElement("a");
    a.href = "https://github.com/settings/tokens/new?scopes=repo&description=Lemonstone";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Generate a token on GitHub →";
    tokenLink.appendChild(a);
    step.appendChild(tokenLink);

    const field = document.createElement("div");
    field.className = "field";
    const lbl = document.createElement("label");
    lbl.textContent = "Personal Access Token";
    const input = document.createElement("input");
    input.type = "password";
    input.placeholder = "ghp_…";
    input.autocomplete = "off";
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = 'Requires "repo" scope. The token is stored encrypted on your device.';
    field.append(lbl, input, hint);
    step.appendChild(field);

    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Verify token";

    const status = document.createElement("div");
    status.className = "status";

    step.append(btn, status);
    this.#shadow.appendChild(step);

    const go = async (): Promise<void> => {
      const token = input.value.trim();
      if (!token) return;
      btn.disabled = true;
      input.classList.remove("error");
      status.textContent = "Verifying…";
      status.className = "status";
      try {
        const user = await validatePAT(token);
        this.#token = token;
        this.#user = user;
        this.#renderStep2();
      } catch (err) {
        input.classList.add("error");
        status.className = "status error-msg";
        status.textContent = (err as Error).message;
        btn.disabled = false;
      }
    };

    btn.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go().catch(console.error); });
  }

  // ── Step 2: Repo entry ───────────────────────────────────────────────────

  #renderStep2(): void {
    this.#shadow.querySelectorAll(".step").forEach((el) => el.remove());

    const step = document.createElement("div");
    step.className = "step active";

    const h2 = document.createElement("h2");
    h2.textContent = "Choose your notes repo";
    step.appendChild(h2);

    if (this.#user) {
      const badge = document.createElement("div");
      badge.className = "user-badge";
      const img = document.createElement("img");
      img.src = this.#user.avatar_url;
      img.alt = this.#user.login;
      const nameSpan = document.createElement("span");
      nameSpan.textContent = `Signed in as ${this.#user.name ?? this.#user.login}`;
      badge.append(img, nameSpan);
      step.appendChild(badge);
    }

    const subtitle = document.createElement("p");
    subtitle.className = "subtitle";
    subtitle.textContent = "Enter the full name of the GitHub repository that will store your notes. It must exist and your token must have access to it.";
    step.appendChild(subtitle);

    const field = document.createElement("div");
    field.className = "field";
    const lbl = document.createElement("label");
    lbl.textContent = "Repository";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = `${this.#user?.login ?? "owner"}/my-notes`;
    input.autocomplete = "off";
    if (this.#user) input.value = `${this.#user.login}/`;
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Format: owner/repo-name. The repo should contain (or will contain) your .md files.";
    field.append(lbl, input, hint);
    step.appendChild(field);

    const connectBtn = document.createElement("button");
    connectBtn.className = "btn";
    connectBtn.textContent = "Connect";
    const backBtn = document.createElement("button");
    backBtn.className = "btn btn-secondary";
    backBtn.textContent = "← Back";

    const status = document.createElement("div");
    status.className = "status";

    step.append(connectBtn, backBtn, status);
    this.#shadow.appendChild(step);

    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });

    backBtn.addEventListener("click", () => this.#renderStep1());

    const go = async (): Promise<void> => {
      const repoName = input.value.trim();
      if (!repoName || !repoName.includes("/")) {
        input.classList.add("error");
        status.className = "status error-msg";
        status.textContent = "Enter the repo as owner/repo-name.";
        return;
      }
      connectBtn.disabled = true;
      backBtn.disabled = true;
      input.classList.remove("error");
      status.className = "status";
      status.textContent = "Connecting…";
      try {
        const repo = await fetchRepo(this.#token, repoName);
        const tokens = buildPATAuthPayload(this.#token, repo.full_name, repo.default_branch);
        status.className = "status success-msg";
        status.textContent = "Connected! Loading your vault…";
        this.dispatchEvent(
          new CustomEvent("auth-complete", {
            bubbles: true,
            composed: true,
            detail: { tokens },
          })
        );
      } catch (err) {
        input.classList.add("error");
        status.className = "status error-msg";
        status.textContent = (err as Error).message;
        connectBtn.disabled = false;
        backBtn.disabled = false;
      }
    };

    connectBtn.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go().catch(console.error); });
  }
}

customElements.define("ls-modal", LSModal);
