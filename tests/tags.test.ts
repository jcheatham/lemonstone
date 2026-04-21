import { describe, it, expect } from "vitest";
import {
  extractInlineTags,
  extractFrontmatterTags,
  extractAllTags,
} from "../src/vault/tags.ts";

describe("extractInlineTags", () => {
  it("extracts a simple tag", () => {
    expect(extractInlineTags("Hello #project world")).toContain("project");
  });

  it("extracts nested tags", () => {
    expect(extractInlineTags("Working on #project/q2")).toContain("project/q2");
  });

  it("does not extract URL fragments", () => {
    const tags = extractInlineTags("See https://example.com/path#anchor for more");
    expect(tags).not.toContain("anchor");
  });

  it("does not extract tags inside fenced code blocks", () => {
    const content = "Normal #good\n```\n#inside-code\n```\nafter";
    const tags = extractInlineTags(content);
    expect(tags).toContain("good");
    expect(tags).not.toContain("inside-code");
  });

  it("does not extract tags inside inline code", () => {
    const tags = extractInlineTags("Run `#not-a-tag` or #real-tag");
    expect(tags).not.toContain("not-a-tag");
    expect(tags).toContain("real-tag");
  });

  it("lowercases all tags", () => {
    const tags = extractInlineTags("#Project #WORK");
    expect(tags).toContain("project");
    expect(tags).toContain("work");
  });

  it("deduplicates repeated tags", () => {
    const tags = extractInlineTags("#work #work #work");
    expect(tags.filter((t) => t === "work")).toHaveLength(1);
  });

  it("returns empty array for content with no tags", () => {
    expect(extractInlineTags("Just plain text here.")).toEqual([]);
  });
});

describe("extractFrontmatterTags", () => {
  it("extracts tags from array frontmatter", () => {
    const tags = extractFrontmatterTags({ tags: ["project", "work"] });
    expect(tags).toContain("project");
    expect(tags).toContain("work");
  });

  it("strips leading # from tags", () => {
    const tags = extractFrontmatterTags({ tags: ["#project", "#work"] });
    expect(tags).toContain("project");
    expect(tags).toContain("work");
  });

  it("handles single string value", () => {
    const tags = extractFrontmatterTags({ tags: "project" });
    expect(tags).toContain("project");
  });

  it("returns empty for no tags key", () => {
    expect(extractFrontmatterTags({ title: "My Note" })).toEqual([]);
  });
});

describe("extractAllTags", () => {
  it("merges inline and frontmatter tags", () => {
    const tags = extractAllTags("Body with #body-tag", { tags: ["fm-tag"] });
    expect(tags).toContain("body-tag");
    expect(tags).toContain("fm-tag");
  });

  it("deduplicates across sources", () => {
    const tags = extractAllTags("Uses #shared", { tags: ["shared"] });
    expect(tags.filter((t) => t === "shared")).toHaveLength(1);
  });
});
