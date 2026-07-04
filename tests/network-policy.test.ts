import { describe, it, expect } from "vitest";
import { parseConnectSrc, normalizeOrigin, originOf } from "../src/snippet/network-policy.ts";
import { snippetTemplate } from "../src/snippet/template.ts";

describe("normalizeOrigin", () => {
  it("normalizes a plain https origin", () => {
    expect(normalizeOrigin("https://api.example.com")).toBe("https://api.example.com");
  });
  it("strips path/query to the origin", () => {
    expect(normalizeOrigin("https://api.example.com/v1/things?x=1")).toBe("https://api.example.com");
  });
  it("keeps an explicit port", () => {
    expect(normalizeOrigin("http://localhost:8080")).toBe("http://localhost:8080");
  });
  it("accepts ws/wss", () => {
    expect(normalizeOrigin("wss://socket.example.com")).toBe("wss://socket.example.com");
  });
  it("rejects wildcards", () => {
    expect(normalizeOrigin("*")).toBeNull();
    expect(normalizeOrigin("https://*.example.com")).toBeNull();
  });
  it("rejects disallowed schemes and junk", () => {
    expect(normalizeOrigin("data:text/html,x")).toBeNull();
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeOrigin("not a url")).toBeNull();
    expect(normalizeOrigin("")).toBeNull();
  });
});

describe("parseConnectSrc", () => {
  it("returns [] when no declaration is present", () => {
    expect(parseConnectSrc("<!doctype html><html><head></head><body></body></html>")).toEqual([]);
  });

  it("parses a space-separated list", () => {
    const html = `<meta name="lemonstone-connect-src" content="https://api.example.com https://x.test">`;
    expect(parseConnectSrc(html).sort()).toEqual(["https://api.example.com", "https://x.test"]);
  });

  it("ignores a commented-out declaration (e.g. the starter template example)", () => {
    const html = `<head><!-- <meta name="lemonstone-connect-src" content="https://api.example.com"> --></head>`;
    expect(parseConnectSrc(html)).toEqual([]);
  });

  it("drops invalid origins but keeps valid ones", () => {
    const html = `<meta name="lemonstone-connect-src" content="* https://ok.test bogus">`;
    expect(parseConnectSrc(html)).toEqual(["https://ok.test"]);
  });

  it("de-duplicates and merges multiple declarations", () => {
    const html =
      `<meta name="lemonstone-connect-src" content="https://a.test https://a.test">` +
      `<meta name="lemonstone-connect-src" content="https://b.test">`;
    expect(parseConnectSrc(html).sort()).toEqual(["https://a.test", "https://b.test"]);
  });

  it("is case-insensitive on the tag/attribute and handles attribute order", () => {
    const html = `<META CONTENT="https://c.test" NAME="lemonstone-connect-src">`;
    expect(parseConnectSrc(html)).toEqual(["https://c.test"]);
  });

  it("a freshly-scaffolded snippet requests nothing", () => {
    expect(parseConnectSrc(snippetTemplate("My Tool"))).toEqual([]);
  });
});

describe("originOf", () => {
  it("extracts the origin from a blocked URI", () => {
    expect(originOf("https://api.example.com/zen")).toBe("https://api.example.com");
  });
  it("returns null for junk", () => {
    expect(originOf("not-a-uri")).toBeNull();
  });
});
