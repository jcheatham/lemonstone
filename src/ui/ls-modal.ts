import {
  requestDeviceCode,
  pollForToken,
} from "../auth/index.ts";

const template = document.createElement("template");
template.innerHTML = `
<style>
  :host {
    display: block;
    background: var(--ls-color-bg-elevated, #242438);
    border: 1px solid var(--ls-color-border, #444);
    border-radius: 8px;
    padding: 32px;
    min-width: 360px;
    max-width: 440px;
    font-family: var(--ls-font-ui, system-ui, sans-serif);
    color: var(--ls-color-fg, #e0e0e0);
  }
  h2 { margin: 0 0 16px; font-size: 20px; }
  p { margin: 0 0 12px; line-height: 1.5; font-size: 14px; color: var(--ls-color-fg-subtle, #aaa); }
  #user-code {
    font-size: 28px;
    font-family: monospace;
    letter-spacing: 4px;
    text-align: center;
    padding: 12px;
    background: var(--ls-color-bg, #1a1a2e);
    border-radius: 6px;
    margin: 16px 0;
    user-select: all;
  }
  button {
    width: 100%;
    padding: 10px;
    border: none;
    border-radius: 6px;
    background: var(--ls-color-accent, #7c6af7);
    color: #fff;
    font-size: 15px;
    cursor: pointer;
  }
  button:hover { opacity: 0.9; }
  #status { margin-top: 12px; font-size: 13px; text-align: center; }
  #error { color: #f87171; }
</style>
<h2>Connect GitHub</h2>
<p>Lemonstone stores your notes in a GitHub repository you own. Click below to start the one-time authorization.</p>
<div id="start-view">
  <button id="start-btn">Connect GitHub</button>
</div>
<div id="code-view" hidden>
  <p>Visit <a id="verify-link" href="#" target="_blank" rel="noopener noreferrer"></a> and enter this code:</p>
  <div id="user-code"></div>
  <p id="status">Waiting for authorization…</p>
</div>
<div id="error" hidden></div>
`;

export class LSModal extends HTMLElement {
  connectedCallback(): void {
    const shadow = this.attachShadow({ mode: "open" });
    shadow.appendChild(template.content.cloneNode(true));

    shadow
      .getElementById("start-btn")!
      .addEventListener("click", () => this.#startDeviceFlow(shadow));
  }

  async #startDeviceFlow(shadow: ShadowRoot): Promise<void> {
    const startView = shadow.getElementById("start-view")!;
    const codeView = shadow.getElementById("code-view")!;
    const errorEl = shadow.getElementById("error")!;

    try {
      const dc = await requestDeviceCode();

      startView.hidden = true;
      codeView.hidden = false;
      shadow.getElementById("user-code")!.textContent = dc.userCode;
      const link = shadow.getElementById("verify-link") as HTMLAnchorElement;
      link.href = dc.verificationUri;
      link.textContent = dc.verificationUri;

      // Open the verification page automatically.
      window.open(dc.verificationUri, "_blank", "noopener,noreferrer");

      await this.#poll(shadow, dc.deviceCode, dc.interval);
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = `Error: ${(err as Error).message}`;
    }
  }

  async #poll(
    shadow: ShadowRoot,
    deviceCode: string,
    intervalSeconds: number
  ): Promise<void> {
    const statusEl = shadow.getElementById("status")!;
    let interval = intervalSeconds * 1000;

    // Placeholder repo info — will be collected after auth in a follow-up step.
    const installationId = 0;
    const repoFullName = "";
    const repoDefaultBranch = "main";

    while (true) {
      await sleep(interval);
      const result = await pollForToken(
        deviceCode,
        installationId,
        repoFullName,
        repoDefaultBranch
      );

      if (result.status === "pending") continue;
      if (result.status === "slow_down") {
        interval += 5000;
        continue;
      }
      if (result.status === "expired") {
        statusEl.textContent = "Code expired. Please refresh and try again.";
        return;
      }
      if (result.status === "denied") {
        statusEl.textContent = "Authorization denied.";
        return;
      }
      if (result.status === "success") {
        statusEl.textContent = "Authorized! Setting up your vault…";
        this.dispatchEvent(
          new CustomEvent("auth:success", {
            bubbles: true,
            composed: true,
            detail: result.payload,
          })
        );
        return;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

customElements.define("ls-modal", LSModal);
