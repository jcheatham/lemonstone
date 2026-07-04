// Parsing + validation for a snippet's declared network needs.
//
// A snippet requests network access in its own <head>:
//   <meta name="lemonstone-connect-src" content="https://api.example.com https://x.test">
//
// The declaration is only a *request*. The user grants it locally (per path);
// only granted origins reach the sandbox's connect-src. See docs/snippets.md.

/**
 * Extract the origins a snippet declares in `lemonstone-connect-src` meta tags.
 * Content is whitespace-separated. Invalid tokens (wildcards, non-http(s)/ws
 * schemes, unparseable) are dropped. Result is normalized + de-duplicated.
 */
export function parseConnectSrc(html: string): string[] {
  const out = new Set<string>();
  // Strip HTML comments first so the commented-out example in the starter
  // template (and any other commented declaration) is NOT treated as a request.
  const live = html.replace(/<!--[\s\S]*?-->/g, "");
  const metaTag = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaTag.exec(live)) !== null) {
    const tag = m[0];
    if (!/name\s*=\s*["']lemonstone-connect-src["']/i.test(tag)) continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (!content) continue;
    for (const token of content[1]!.split(/\s+/)) {
      const origin = normalizeOrigin(token);
      if (origin) out.add(origin);
    }
  }
  return [...out];
}

const ALLOWED_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);

/**
 * Validate one declared origin. Returns the normalized origin (scheme + host +
 * port, no path) or null if it's a wildcard, a bad scheme, or unparseable.
 * Wildcards are rejected outright so grants stay specific.
 */
export function normalizeOrigin(token: string): string | null {
  const t = token.trim();
  if (!t || t.includes("*")) return null;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) return null;
  if (url.origin === "null") return null;
  return url.origin;
}

/** Origin of a blocked URI (from a CSP violation), or null. */
export function originOf(uri: string): string | null {
  try {
    return new URL(uri).origin;
  } catch {
    return null;
  }
}
