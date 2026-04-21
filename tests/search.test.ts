import { describe, it, expect, beforeEach } from "vitest";
import { VaultSearch } from "../src/vault/search.ts";

describe("VaultSearch", () => {
  let vs: VaultSearch;

  beforeEach(() => {
    vs = new VaultSearch();
    vs.add("notes/project.md", "# Project Plan\n\nThis is about #project work.");
    vs.add("notes/meeting.md", "# Meeting Notes\n\nDiscussed #project and #work.");
    vs.add("daily/2026-04-20.md", "# Daily\n\nToday I worked on the project.");
  });

  it("finds a note by keyword in title", () => {
    const results = vs.search("Project Plan");
    expect(results.map((r) => r.path)).toContain("notes/project.md");
  });

  it("finds notes by body content", () => {
    const results = vs.search("Meeting");
    expect(results.map((r) => r.path)).toContain("notes/meeting.md");
  });

  it("prefix matching finds partial terms", () => {
    const results = vs.search("proj");
    const paths = results.map((r) => r.path);
    expect(paths).toContain("notes/project.md");
  });

  it("returns empty results for no matches", () => {
    expect(vs.search("xyzqwerty")).toHaveLength(0);
  });

  it("remove stops a note from appearing in results", () => {
    vs.remove("notes/meeting.md");
    const results = vs.search("Meeting Notes");
    expect(results.map((r) => r.path)).not.toContain("notes/meeting.md");
  });

  it("re-adding a note makes new content findable", () => {
    vs.add("notes/project.md", "# Renamed\n\nCompletely different content now.");
    const results = vs.search("Renamed");
    expect(results.map((r) => r.path)).toContain("notes/project.md");
  });

  it("serializes and deserializes without losing results", () => {
    const json = vs.serialize();
    const restored = VaultSearch.deserialize(json);
    const results = restored.search("Meeting");
    expect(results.map((r) => r.path)).toContain("notes/meeting.md");
  });

  it("documentCount reflects the indexed set", () => {
    expect(vs.documentCount).toBe(3);
    vs.remove("notes/meeting.md");
    expect(vs.documentCount).toBe(2);
  });
});
