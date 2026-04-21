import { describe, it, expect, beforeEach } from "vitest";
import { WikilinkResolver } from "../src/vault/wikilink-resolver.ts";

describe("WikilinkResolver", () => {
  let r: WikilinkResolver;

  beforeEach(() => {
    r = new WikilinkResolver();
    r.addPath("notes/My Project.md");
    r.addPath("notes/meeting notes.md");
    r.addPath("daily/2026-04-20.md");
    r.addPath("archive/My Project.md"); // same basename, different dir
  });

  it("resolves by exact basename (case-sensitive)", () => {
    expect(r.resolve("My Project")).toBe("notes/My Project.md");
  });

  it("resolves case-insensitively when exact match fails", () => {
    expect(r.resolve("my project")).toBe("notes/My Project.md");
  });

  it("returns null for unresolved link", () => {
    expect(r.resolve("Nonexistent Note")).toBeNull();
  });

  it("resolves a path with extension correctly", () => {
    expect(r.resolve("2026-04-20")).toBe("daily/2026-04-20.md");
  });

  it("removePath stops resolution", () => {
    r.removePath("notes/meeting notes.md");
    expect(r.resolve("meeting notes")).toBeNull();
  });

  it("renamePath updates resolution", () => {
    r.renamePath("daily/2026-04-20.md", "daily/2026-04-21.md");
    expect(r.resolve("2026-04-20")).toBeNull();
    expect(r.resolve("2026-04-21")).toBe("daily/2026-04-21.md");
  });

  it("allPaths returns all registered paths", () => {
    const paths = r.allPaths;
    expect(paths).toContain("notes/My Project.md");
    expect(paths).toContain("daily/2026-04-20.md");
  });
});
