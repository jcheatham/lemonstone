// Message protocol for the snippet sandbox.
//
// Topology (see docs/snippets.md):
//
//   top app window  ──postMessage──▶  outer sandbox.html  ──srcdoc──▶  inner snippet frame
//        ▲                                   │  ▲                              │
//        └───────── relays diagnostics ──────┘  └──── diagnostics/height ──────┘
//
// Both iframe boundaries are opaque origins (sandbox="allow-scripts" without
// allow-same-origin), so postMessage `origin` is "null" and cannot be named as
// a targetOrigin. We therefore validate the *source window identity* on each
// hop and carry a shared `nonce` so a co-embedded hostile frame can't spoof the
// app→host channel. `runId` lets receivers drop late messages from a torn-down
// run.

/** App → outer host: render this snippet with this network policy. */
export interface RenderRequest {
  type: "ls-snippet-render";
  nonce: string;
  runId: number;
  /** Raw snippet HTML (may be a full document or a fragment). */
  html: string;
  /**
   * Origins allowed in the sandbox's `connect-src`. Empty ⇒ `'none'`.
   * Never `"*"` — callers pass explicit origins the user has granted.
   */
  connectSrc: string[];
}

/** Outer host → app: the host booted and is ready to receive renders. */
export interface ReadyMessage {
  type: "ls-snippet-ready";
  nonce: string;
}

/** Outer host → app: the inner content reported its height (px). */
export interface HeightMessage {
  type: "ls-snippet-height";
  nonce: string;
  runId: number;
  height: number;
}

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

/** Outer host → app: a captured console.* call from the snippet. */
export interface ConsoleMessage {
  type: "ls-snippet-console";
  nonce: string;
  runId: number;
  level: ConsoleLevel;
  /** Pre-formatted, cloneable argument strings. */
  args: string[];
}

/** Outer host → app: a runtime error or CSP violation inside the snippet. */
export interface DiagnosticMessage {
  type: "ls-snippet-error";
  nonce: string;
  runId: number;
  kind: "error" | "unhandledrejection" | "csp";
  message: string;
  /** For csp: the blocked URI. For error: source:line if available. */
  detail?: string;
}

export type HostToApp =
  | ReadyMessage
  | HeightMessage
  | ConsoleMessage
  | DiagnosticMessage;

/**
 * Messages the inner snippet frame posts up to the outer host. These omit the
 * `nonce` (the host validates them by child-window identity, not the shared
 * app secret) and are re-stamped and relayed to the app by the host.
 */
export type InnerToHost =
  | Omit<HeightMessage, "nonce">
  | Omit<ConsoleMessage, "nonce">
  | Omit<DiagnosticMessage, "nonce">;
