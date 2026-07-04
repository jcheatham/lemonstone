// Parent-side (main-thread) handle to a snippet sandbox. Creates the outer
// `<iframe sandbox="allow-scripts">` pointing at sandbox.html, ships render
// requests to it, and surfaces height/console/diagnostics via callbacks.
//
// The app never touches the untrusted code directly — it only ever exchanges
// structured-cloned messages with the opaque-origin host.

import type { HostToApp, RenderRequest, ConsoleLevel } from "./protocol.ts";

export interface SnippetDiagnostic {
  kind: "error" | "unhandledrejection" | "csp";
  message: string;
  detail?: string;
}
export interface SnippetConsoleEntry {
  level: ConsoleLevel;
  args: string[];
}

export interface SnippetSandboxOptions {
  onReady?: () => void;
  onConsole?: (e: SnippetConsoleEntry) => void;
  onDiagnostic?: (e: SnippetDiagnostic) => void;
  onHeight?: (px: number) => void;
  /** Where sandbox.html is served. Defaults to the Vite base path. */
  base?: string;
}

export class SnippetSandbox {
  readonly #iframe: HTMLIFrameElement;
  readonly #nonce: string;
  readonly #opts: SnippetSandboxOptions;
  readonly #onMessage: (e: MessageEvent) => void;
  #runId = 0;
  #ready = false;
  #pending: RenderRequest | null = null;

  constructor(container: HTMLElement, opts: SnippetSandboxOptions = {}) {
    this.#opts = opts;
    this.#nonce = makeNonce();

    const base = opts.base ?? import.meta.env.BASE_URL;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("title", "snippet sandbox");
    iframe.src = base + "sandbox.html";
    iframe.style.cssText = "display:block;border:0;width:100%;";
    this.#iframe = iframe;

    this.#onMessage = (e) => this.#handle(e);
    window.addEventListener("message", this.#onMessage);
    container.appendChild(iframe);
  }

  get element(): HTMLIFrameElement {
    return this.#iframe;
  }

  /**
   * Render (or re-run) a snippet. `connectSrc` is the list of granted origins
   * for the snippet's `connect-src`; empty ⇒ no network.
   */
  render(html: string, connectSrc: string[] = []): void {
    const req: RenderRequest = {
      type: "ls-snippet-render",
      nonce: this.#nonce,
      runId: ++this.#runId,
      html,
      connectSrc,
    };
    if (this.#ready) this.#post(req);
    else this.#pending = req; // queue until the host announces readiness
  }

  destroy(): void {
    window.removeEventListener("message", this.#onMessage);
    this.#iframe.remove();
  }

  #post(req: RenderRequest): void {
    this.#iframe.contentWindow?.postMessage(req, "*");
  }

  #handle(e: MessageEvent): void {
    if (e.source !== this.#iframe.contentWindow) return; // only our host
    const data = e.data as HostToApp | null;
    if (!data || typeof (data as { type?: unknown }).type !== "string") return;

    if (data.type === "ls-snippet-ready") {
      this.#ready = true;
      this.#opts.onReady?.();
      if (this.#pending) {
        this.#post(this.#pending);
        this.#pending = null;
      }
      return;
    }

    if (data.nonce !== this.#nonce) return; // spoof guard
    if (data.runId !== this.#runId) return; // stale run

    switch (data.type) {
      case "ls-snippet-height":
        this.#opts.onHeight?.(data.height);
        break;
      case "ls-snippet-console":
        this.#opts.onConsole?.({ level: data.level, args: data.args });
        break;
      case "ls-snippet-error":
        this.#opts.onDiagnostic?.({
          kind: data.kind,
          message: data.message,
          detail: data.detail,
        });
        break;
    }
  }
}

function makeNonce(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
