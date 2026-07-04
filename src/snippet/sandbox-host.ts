// Outer sandbox host — the module loaded by `sandbox.html`.
//
// This document is served from our origin with NO Content-Security-Policy of
// its own. That is safe ONLY because it is exclusively loaded inside an
// `<iframe sandbox="allow-scripts">` (without allow-same-origin), giving it an
// opaque origin with no access to the GitHub token, IndexedDB, OPFS, cookies,
// or the parent DOM.
//
// It is a stable relay: it never overwrites itself. Each render creates a fresh
// inner <iframe> whose `srcdoc` carries the per-snippet CSP <meta> (which
// inherits this document's unrestricted policy and tightens from there — the
// mechanism that lets one static file yield a different connect-src per
// snippet). A fresh frame per run gives each snippet a clean JS environment.
//
// See docs/snippets.md.

import { buildSandboxCsp, buildSnippetDocument } from "./sandbox-csp.ts";
import { innerBootstrap } from "./inner-bootstrap.ts";
import type {
  RenderRequest,
  ReadyMessage,
  HostToApp,
  InnerToHost,
} from "./protocol.ts";

let nonce: string | null = null;
let currentRunId = -1;
let inner: HTMLIFrameElement | null = null;

function toApp(msg: HostToApp): void {
  // Opaque origin ⇒ we cannot name a targetOrigin; the app validates the reply
  // by our contentWindow identity and the shared nonce.
  parent.postMessage(msg, "*");
}

function render(req: RenderRequest): void {
  nonce = req.nonce;
  currentRunId = req.runId;
  const csp = buildSandboxCsp(req.connectSrc);
  const doc = buildSnippetDocument(req.html, csp, innerBootstrap(req.runId));

  const next = document.createElement("iframe");
  // Redundant with the inherited sandbox flags, but explicit for clarity: the
  // inner frame can run scripts and nothing else.
  next.setAttribute("sandbox", "allow-scripts");
  next.setAttribute("scrolling", "no");
  next.style.cssText =
    "display:block;border:0;width:100%;height:0;overflow:hidden;background:#fff;color-scheme:light;";
  next.srcdoc = doc;
  document.body.appendChild(next);

  const prev = inner;
  inner = next;
  if (prev) prev.remove();
}

window.addEventListener("message", (e: MessageEvent) => {
  const data = e.data as { type?: unknown } | null;
  if (!data || typeof data.type !== "string") return;

  // App → host: render requests, only from our embedder.
  if (e.source === window.parent && data.type === "ls-snippet-render") {
    render(e.data as RenderRequest);
    return;
  }

  // Inner → host: diagnostics, only from the current inner frame.
  if (inner && e.source === inner.contentWindow && nonce != null) {
    const m = e.data as InnerToHost;
    if (m.runId !== currentRunId) return; // drop late messages from a superseded run
    // Grow the inner frame to fit its content so the snippet is actually
    // visible. (The app separately sizes the OUTER iframe from the relayed
    // height.) Without this the inner frame stays height:0 and renders blank.
    if (m.type === "ls-snippet-height") {
      inner.style.height = m.height + "px";
    }
    toApp({ ...(m as object), nonce } as HostToApp);
  }
});

// Announce readiness so the app can flush any queued render.
const ready: ReadyMessage = { type: "ls-snippet-ready", nonce: "" };
parent.postMessage(ready, "*");
