// Pure builders for the per-snippet sandbox document. No DOM, no globals —
// unit-testable in isolation. See docs/snippets.md for the security model.

/**
 * Build the sandbox document's `Content-Security-Policy` value.
 *
 * The inner snippet frame is served (via srcdoc) with an *unrestricted* base
 * policy inherited from the outer host, so this meta policy is purely
 * tightening. It is the ONLY thing standing between the snippet and the
 * network, so `connect-src` defaults to `'none'` and only widens to the exact
 * origins the user has granted.
 *
 * @param connectSrc explicit origins to allow for fetch/XHR/WebSocket. Empty ⇒
 *   `'none'`. Callers must pass real origins (e.g. "https://api.example.com");
 *   `"*"` is rejected to keep grants specific.
 */
export function buildSandboxCsp(connectSrc: readonly string[] = []): string {
  const origins = connectSrc.filter((o) => o && o !== "*");
  const connect = origins.length ? origins.join(" ") : "'none'";
  return [
    "default-src 'none'",
    // Untrusted code runs at an opaque origin with no access to the token,
    // IndexedDB, OPFS, or the parent DOM, so inline/eval is acceptable here and
    // nowhere else in the app.
    "script-src 'unsafe-inline' 'unsafe-eval'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    `connect-src ${connect}`,
    // Belt-and-suspenders: the sandbox attribute already blocks these, but a
    // snippet that tries them should fail loudly via securitypolicyviolation.
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/**
 * Assemble the full HTML document string that will be written into the inner
 * frame's `srcdoc`. Injects, as the first children of `<head>`:
 *   1. the per-snippet CSP `<meta>` (must precede any resource-loading element)
 *   2. the diagnostics bootstrap `<script>` (must run before snippet scripts)
 *
 * Snippet files are typically *full* documents (doctype + html + head + body),
 * so we inject into the existing head rather than wrapping — wrapping a full
 * document inside another body produces invalid nesting.
 */
export function buildSnippetDocument(
  snippetHtml: string,
  cspContent: string,
  bootstrapScript: string
): string {
  const head =
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(cspContent)}">` +
    `<script>${bootstrapScript}</script>`;

  const html = snippetHtml ?? "";

  // Case 1: existing <head …> — insert immediately after it.
  const headOpen = /<head\b[^>]*>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + head + html.slice(at);
  }

  // Case 2: <html …> but no head — add a head right after it.
  const htmlOpen = /<html\b[^>]*>/i.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return html.slice(0, at) + `<head>${head}</head>` + html.slice(at);
  }

  // Case 3: a bare fragment — wrap it in a minimal document.
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"
  );
}
