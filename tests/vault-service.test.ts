import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared in-memory store used by the StorageAdapter mock.
const store = new Map<string, string>();

vi.mock("../src/storage/storage-adapter.ts", () => ({
  StorageAdapter: class {
    async writeNote(path: string, content: string) {
      store.set(path, content);
    }
    async readNote(path: string) {
      return store.get(path) ?? null;
    }
    async listNotes() {
      return Array.from(store.entries()).map(([path, content]) => ({
        path,
        content: new TextEncoder().encode(content),
        size: content.length,
        updatedAt: Date.now(),
        frontmatter: {},
        syncState: "clean" as const,
        baseSha: "",
        codec: { scheme: "identity", version: 1 },
      }));
    }
    async deleteNote(path: string) {
      store.delete(path);
    }
    async writeCanvas() {}
    async readCanvas() { return null; }
    async readCanvasRecord() { return null; }
    async clearCanvasConflict() {}
    async deleteCanvas() {}
    async writeAttachment() {}
    async readAttachment() { return null; }
    async readIndexesSnapshot() { return null; }
    async writeIndexesSnapshot() {}
    async writeTombstone() {}
    async deleteTombstone() {}
    async listTombstones() { return []; }
  },
}));

// SyncClient stub — no-op worker
vi.mock("../src/sync/sync-client.ts", () => ({
  SyncClient: class extends EventTarget {
    call() { return Promise.resolve({ id: "", ok: true, result: {} }); }
  },
}));

import { VaultService } from "../src/vault/vault-service.ts";

describe("VaultService", () => {
  let vault: VaultService;

  beforeEach(() => {
    store.clear();
    vault = new VaultService({
      vaultId: "test-vault",
      dbName: "test-db",
      opfsDir: "test-opfs",
      repoFullName: "owner/repo",
      repoDefaultBranch: "main",
    });
  });

  // ── Basic read/write ───────────────────────────────────────────────────────

  it("writeNote and readNote roundtrip", async () => {
    await vault.writeNote("notes/test.md", "# Hello\n\nWorld");
    expect(await vault.readNote("notes/test.md")).toBe("# Hello\n\nWorld");
  });

  it("emits note:changed on write", async () => {
    const paths: string[] = [];
    vault.addEventListener("note:changed", (e) =>
      paths.push((e as CustomEvent).detail.path)
    );
    await vault.writeNote("notes/a.md", "content");
    expect(paths).toContain("notes/a.md");
  });

  // ── Link graph ─────────────────────────────────────────────────────────────

  it("extracts backlinks from wikilinks", async () => {
    await vault.writeNote("notes/source.md", "See [[target]] and [[other]]");
    expect(vault.getBacklinks("target")).toContain("notes/source.md");
  });

  it("removes backlinks when note is deleted", async () => {
    await vault.writeNote("notes/source.md", "Links to [[dest]]");
    await vault.deleteNote("notes/source.md");
    expect(vault.getBacklinks("dest")).toHaveLength(0);
  });

  it("updates link graph on rewrite", async () => {
    await vault.writeNote("notes/note.md", "Links to [[old]]");
    await vault.writeNote("notes/note.md", "Now links to [[new]]");
    expect(vault.getBacklinks("old")).toHaveLength(0);
    expect(vault.getBacklinks("new")).toContain("notes/note.md");
  });

  it("getOutlinks returns links from a note", async () => {
    await vault.writeNote("notes/a.md", "Links: [[b]] and [[c]]");
    expect(vault.getOutlinks("notes/a.md")).toContain("b");
    expect(vault.getOutlinks("notes/a.md")).toContain("c");
  });

  // ── Tag index ──────────────────────────────────────────────────────────────

  it("extracts inline tags", async () => {
    await vault.writeNote("notes/a.md", "# Note\n\nUsing #project and #work");
    const tags = vault.listTags();
    const tagNames = tags.map((t) => t.tag);
    expect(tagNames).toContain("project");
    expect(tagNames).toContain("work");
  });

  it("getTagNotes returns notes with a given tag", async () => {
    await vault.writeNote("notes/a.md", "Using #mytag");
    await vault.writeNote("notes/b.md", "No tag here");
    expect(vault.getTagNotes("mytag")).toContain("notes/a.md");
    expect(vault.getTagNotes("mytag")).not.toContain("notes/b.md");
  });

  it("clears tag index when note is deleted", async () => {
    await vault.writeNote("notes/a.md", "Using #removeme");
    await vault.deleteNote("notes/a.md");
    expect(vault.getTagNotes("removeme")).toHaveLength(0);
  });

  it("extracts tags from frontmatter", async () => {
    await vault.writeNote(
      "notes/a.md",
      "---\ntags: [alpha, beta]\n---\n# Body"
    );
    const tagNames = vault.listTags().map((t) => t.tag);
    expect(tagNames).toContain("alpha");
    expect(tagNames).toContain("beta");
  });

  // ── Wikilink resolution ────────────────────────────────────────────────────

  it("resolveWikilink finds a note after it is written", async () => {
    await vault.writeNote("notes/My Plan.md", "# My Plan");
    expect(vault.resolveWikilink("My Plan")).toBe("notes/My Plan.md");
  });

  it("resolveWikilink returns null for unknown note", () => {
    expect(vault.resolveWikilink("Nonexistent")).toBeNull();
  });

  // ── Search ─────────────────────────────────────────────────────────────────

  it("searchFullText finds indexed notes", async () => {
    await vault.writeNote("notes/project.md", "# Big Project\n\nLots of work.");
    await vault.writeNote("notes/other.md", "# Something Else\n\nUnrelated.");
    const results = vault.searchFullText("Big Project");
    expect(results.map((r) => r.path)).toContain("notes/project.md");
  });

  it("searchFullText returns empty for no match", () => {
    expect(vault.searchFullText("xyzqwerty")).toHaveLength(0);
  });

  // ── Events ────────────────────────────────────────────────────────────────

  it("emits note:tagIndexChanged on write", async () => {
    let fired = false;
    vault.addEventListener("note:tagIndexChanged", () => { fired = true; });
    await vault.writeNote("notes/a.md", "#newtag content");
    expect(fired).toBe(true);
  });

  it("emits note:linkGraphChanged on write", async () => {
    let fired = false;
    vault.addEventListener("note:linkGraphChanged", () => { fired = true; });
    await vault.writeNote("notes/a.md", "[[somelink]]");
    expect(fired).toBe(true);
  });
});
