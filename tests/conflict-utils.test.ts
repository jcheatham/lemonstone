import { describe, it, expect } from "vitest";
import { makeConflictPath, isConflictPath } from "../src/sync/conflict-utils.ts";

const TS = new Date("2026-04-20T14:22:00.000Z");

describe("makeConflictPath", () => {
  it("appends conflict tag before extension for a note", () => {
    expect(makeConflictPath("notes/project.md", TS)).toBe(
      "notes/project.conflict-2026-04-20T14-22-00Z.md"
    );
  });

  it("handles a file at vault root (no directory)", () => {
    expect(makeConflictPath("readme.md", TS)).toBe(
      "readme.conflict-2026-04-20T14-22-00Z.md"
    );
  });

  it("handles a canvas file", () => {
    expect(makeConflictPath("projects/q2-plan.canvas", TS)).toBe(
      "projects/q2-plan.conflict-2026-04-20T14-22-00Z.canvas"
    );
  });

  it("handles a png attachment", () => {
    expect(makeConflictPath("attachments/diagram.png", TS)).toBe(
      "attachments/diagram.conflict-2026-04-20T14-22-00Z.png"
    );
  });

  it("handles a file with no extension", () => {
    expect(makeConflictPath("notes/README", TS)).toBe(
      "notes/README.conflict-2026-04-20T14-22-00Z"
    );
  });

  it("handles a file that starts with a dot (hidden file)", () => {
    // lastDot is at index 0 — treated as no extension
    expect(makeConflictPath(".obsidian", TS)).toBe(
      ".obsidian.conflict-2026-04-20T14-22-00Z"
    );
  });

  it("replaces colons with dashes in the ISO string", () => {
    const result = makeConflictPath("a.md", TS);
    expect(result).not.toContain(":");
  });

  it("strips milliseconds from the ISO timestamp", () => {
    const withMs = new Date("2026-04-20T14:22:00.123Z");
    const result = makeConflictPath("a.md", withMs);
    expect(result).toBe("a.conflict-2026-04-20T14-22-00Z.md");
  });

  it("two different timestamps produce different conflict paths", () => {
    const t1 = new Date("2026-04-20T10:00:00Z");
    const t2 = new Date("2026-04-20T12:30:00Z");
    expect(makeConflictPath("notes/a.md", t1)).not.toBe(
      makeConflictPath("notes/a.md", t2)
    );
  });

  it("preserves deep directory nesting", () => {
    expect(makeConflictPath("projects/2026/q2/plan.md", TS)).toBe(
      "projects/2026/q2/plan.conflict-2026-04-20T14-22-00Z.md"
    );
  });
});

describe("isConflictPath", () => {
  it("recognises a conflict sibling path", () => {
    expect(
      isConflictPath("notes/project.conflict-2026-04-20T14-22-00Z.md")
    ).toBe(true);
  });

  it("returns false for a normal note path", () => {
    expect(isConflictPath("notes/project.md")).toBe(false);
  });

  it("returns false for a path that contains 'conflict' in the filename naturally", () => {
    // 'conflict' as a word but without the ISO timestamp pattern
    expect(isConflictPath("notes/conflict-analysis.md")).toBe(false);
  });
});
