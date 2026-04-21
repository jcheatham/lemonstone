import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../src/vault/frontmatter.ts";

describe("parseFrontmatter", () => {
  it("returns empty frontmatter for content without ---", () => {
    const { frontmatter, body } = parseFrontmatter("# Hello\n\nWorld");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# Hello\n\nWorld");
  });

  it("parses simple key: value pairs", () => {
    const { frontmatter } = parseFrontmatter(
      "---\ntitle: My Note\nauthor: Alice\n---\nBody"
    );
    expect(frontmatter["title"]).toBe("My Note");
    expect(frontmatter["author"]).toBe("Alice");
  });

  it("parses inline array", () => {
    const { frontmatter } = parseFrontmatter(
      "---\ntags: [project, work, personal]\n---\nBody"
    );
    expect(frontmatter["tags"]).toEqual(["project", "work", "personal"]);
  });

  it("parses block list", () => {
    const { frontmatter } = parseFrontmatter(
      "---\ntags:\n  - project\n  - work\n---\nBody"
    );
    expect(frontmatter["tags"]).toEqual(["project", "work"]);
  });

  it("parses boolean values", () => {
    const { frontmatter } = parseFrontmatter(
      "---\npublished: true\ndraft: false\n---"
    );
    expect(frontmatter["published"]).toBe(true);
    expect(frontmatter["draft"]).toBe(false);
  });

  it("parses numeric values", () => {
    const { frontmatter } = parseFrontmatter("---\nweight: 42\npriority: 1.5\n---");
    expect(frontmatter["weight"]).toBe(42);
    expect(frontmatter["priority"]).toBe(1.5);
  });

  it("strips the frontmatter block from body", () => {
    const { body } = parseFrontmatter("---\ntitle: Test\n---\n# Heading\n\nContent");
    expect(body).toBe("# Heading\n\nContent");
  });

  it("returns full content as body when closing --- is missing", () => {
    const content = "---\ntitle: incomplete\nBody without closing";
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter).toEqual({});
    expect(body).toBe(content);
  });

  it("handles quoted string values", () => {
    const { frontmatter } = parseFrontmatter(
      "---\ntitle: \"My: Special Note\"\n---"
    );
    expect(frontmatter["title"]).toBe("My: Special Note");
  });

  it("handles empty frontmatter block", () => {
    const { frontmatter, body } = parseFrontmatter("---\n---\n# Body");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# Body");
  });
});
