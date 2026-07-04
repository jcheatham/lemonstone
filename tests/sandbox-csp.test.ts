import { describe, it, expect } from "vitest";
import { buildSandboxCsp, buildSnippetDocument } from "../src/snippet/sandbox-csp.ts";

describe("buildSandboxCsp", () => {
  it("denies network by default", () => {
    const csp = buildSandboxCsp();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline' 'unsafe-eval'");
  });

  it("widens connect-src to explicitly granted origins", () => {
    const csp = buildSandboxCsp(["https://api.example.com", "https://x.test"]);
    expect(csp).toContain("connect-src https://api.example.com https://x.test");
  });

  it("never allows a wildcard origin", () => {
    const csp = buildSandboxCsp(["*", "https://ok.test", ""]);
    expect(csp).toContain("connect-src https://ok.test");
    expect(csp).not.toContain("*");
  });

  it("falls back to 'none' when only invalid origins are given", () => {
    expect(buildSandboxCsp(["*", ""])).toContain("connect-src 'none'");
  });
});

describe("buildSnippetDocument", () => {
  const csp = "default-src 'none'";
  const boot = "/*BOOT*/";

  it("injects CSP meta and bootstrap as the first head children", () => {
    const out = buildSnippetDocument(
      "<!doctype html><html><head><title>t</title></head><body>hi</body></html>",
      csp,
      boot
    );
    const headStart = out.indexOf("<head>") + "<head>".length;
    const injected = out.slice(headStart);
    // CSP meta comes before the snippet's own <title>.
    expect(injected.indexOf("Content-Security-Policy")).toBeLessThan(injected.indexOf("<title>"));
    expect(injected).toContain("/*BOOT*/");
    // single quotes are not escaped by the attribute encoder
    expect(out).toContain(`content="default-src 'none'"`);
  });

  it("adds a head when the document has <html> but none", () => {
    const out = buildSnippetDocument("<html><body>x</body></html>", csp, boot);
    expect(out).toContain("<head>");
    expect(out).toContain("Content-Security-Policy");
    expect(out.indexOf("<head>")).toBeLessThan(out.indexOf("<body>"));
  });

  it("wraps a bare fragment in a minimal document", () => {
    const out = buildSnippetDocument("<button>go</button>", csp, boot);
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain("Content-Security-Policy");
    expect(out).toContain("<button>go</button>");
  });

  it("escapes quotes in the CSP attribute value", () => {
    const out = buildSnippetDocument("<div></div>", `connect-src "evil"`, boot);
    expect(out).toContain("&quot;evil&quot;");
    expect(out).not.toContain('content="connect-src "evil""');
  });

  it("handles head tags with attributes", () => {
    const out = buildSnippetDocument(
      '<html><head lang="en"><meta charset="utf-8"></head><body></body></html>',
      csp,
      boot
    );
    const headStart = out.indexOf('<head lang="en">') + '<head lang="en">'.length;
    expect(out.slice(headStart).indexOf("Content-Security-Policy"))
      .toBeLessThan(out.slice(headStart).indexOf('<meta charset="utf-8">'));
  });
});
