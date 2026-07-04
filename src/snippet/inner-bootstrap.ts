// The diagnostics runtime injected as an inline <script> at the top of every
// snippet document (see buildSnippetDocument). It runs INSIDE the inner frame
// at an opaque origin, before any snippet script, and forwards console output,
// runtime errors, CSP violations, and content height up to the outer host via
// postMessage.
//
// It cannot import anything (it executes in a freshly-written srcdoc document),
// so it is authored here as a self-contained function and serialized with
// `.toString()`. `runId` is injected at call sites so the host can drop late
// messages from a superseded run.

function innerRuntime(RUN_ID: number): void {
  const MAX_COUNTED = 500; // cap console/error volume so a runaway loop can't flood
  let counted = 0;

  function rawPost(msg: Record<string, unknown>): void {
    try {
      parent.postMessage({ ...msg, runId: RUN_ID }, "*");
    } catch {
      /* structured-clone failure or torn-down parent — ignore */
    }
  }
  function post(msg: Record<string, unknown>): void {
    if (counted > MAX_COUNTED) return;
    counted++;
    if (counted > MAX_COUNTED) {
      rawPost({
        type: "ls-snippet-console",
        level: "warn",
        args: ["[lemonstone] diagnostic output capped for this run"],
      });
      return;
    }
    rawPost(msg);
  }

  function fmt(v: unknown): string {
    try {
      if (v === null) return "null";
      const t = typeof v;
      if (t === "undefined") return "undefined";
      if (t === "string") return v as string;
      if (t === "number" || t === "boolean" || t === "bigint") return String(v);
      if (t === "symbol") return String(v);
      if (t === "function") return "[Function " + ((v as () => void).name || "anonymous") + "]";
      const node = v as { nodeName?: unknown };
      if (typeof node.nodeName === "string") return "<" + node.nodeName.toLowerCase() + ">";
      const seen = new WeakSet<object>();
      const json = JSON.stringify(v, (_k, val) => {
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        return typeof val === "bigint" ? String(val) : val;
      });
      return json ?? String(v);
    } catch {
      return "[Unserializable]";
    }
  }
  function trunc(s: string): string {
    return s.length > 2000 ? s.slice(0, 2000) + "…" : s;
  }

  const levels: Array<"log" | "info" | "warn" | "error" | "debug"> = [
    "log", "info", "warn", "error", "debug",
  ];
  for (const level of levels) {
    const c = console as unknown as Record<string, (...a: unknown[]) => void>;
    const orig = c[level];
    c[level] = function (...args: unknown[]): void {
      post({ type: "ls-snippet-console", level, args: args.map((a) => trunc(fmt(a))) });
      if (orig) {
        try { orig.apply(console, args); } catch { /* ignore */ }
      }
    };
  }

  window.addEventListener("error", (e: ErrorEvent) => {
    post({
      type: "ls-snippet-error",
      kind: "error",
      message: trunc(String(e.message || (e.error && e.error.toString()) || "Error")),
      detail: e.filename ? e.filename + ":" + e.lineno + ":" + e.colno : undefined,
    });
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    let m = "Unhandled promise rejection";
    try { m = trunc(fmt(e.reason)); } catch { /* ignore */ }
    post({ type: "ls-snippet-error", kind: "unhandledrejection", message: m });
  });
  document.addEventListener("securitypolicyviolation", (e: SecurityPolicyViolationEvent) => {
    post({
      type: "ls-snippet-error",
      kind: "csp",
      message: e.violatedDirective || "content-security-policy",
      detail: e.blockedURI || undefined,
    });
  });

  // Height reporting — debounced to one message per frame.
  let scheduled = 0;
  function reportHeight(): void {
    if (scheduled) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      const bodyH = document.body ? document.body.scrollHeight : 0;
      const height = Math.max(document.documentElement.scrollHeight, bodyH);
      rawPost({ type: "ls-snippet-height", height });
    });
  }
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => reportHeight());
    const observe = (): void => {
      ro.observe(document.documentElement);
      if (document.body) ro.observe(document.body);
      reportHeight();
    };
    if (document.body) observe();
    else window.addEventListener("DOMContentLoaded", observe);
  }
  window.addEventListener("load", reportHeight);
}

/** Serialized inner runtime, IIFE-wrapped with `runId` baked in. */
export function innerBootstrap(runId: number): string {
  return "(" + innerRuntime.toString() + ")(" + JSON.stringify(runId) + ");";
}
