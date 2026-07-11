import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The app's CSP is a static <meta> tag (index.html) baked at build time —
// GitHub Pages has no server to send dynamic CSP headers, and there's no
// runtime mechanism to widen it. This test pins the connect-src allowlist so
// a future edit can't silently drop an origin the app depends on.
describe("index.html CSP", () => {
  const html = readFileSync(resolve(__dirname, "../index.html"), "utf8");
  const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);

  it("has a Content-Security-Policy meta tag", () => {
    expect(cspMatch).not.toBeNull();
  });

  it("allows connect-src to the origins the app depends on", () => {
    const csp = cspMatch![1]!;
    const connectSrc = csp.match(/connect-src ([^;]+);/)?.[1];
    expect(connectSrc).toBeDefined();
    const origins = connectSrc!.split(/\s+/);
    expect(origins).toContain("'self'");
    expect(origins).toContain("https://api.github.com");
    expect(origins).toContain("https://github.com");
    expect(origins).toContain("https://cors.isomorphic-git.org");
    expect(origins).toContain("https://*.amazonaws.com");
  });
});
