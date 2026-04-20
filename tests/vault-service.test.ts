import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the storage adapter so tests run without IndexedDB.
vi.mock("../src/storage/storage-adapter.ts", () => {
  const store = new Map<string, string>();
  return {
    StorageAdapter: class {
      async writeNote(path: string, content: string) { store.set(path, content); }
      async readNote(path: string) { return store.get(path) ?? null; }
      async listNotes() { return []; }
      async deleteNote(path: string) { store.delete(path); }
    },
  };
});

import { VaultService } from "../src/vault/vault-service.ts";

describe("VaultService", () => {
  let vault: VaultService;

  beforeEach(() => {
    vault = new VaultService();
  });

  it("writeNote and readNote roundtrip", async () => {
    await vault.writeNote("notes/test.md", "# Hello\n\nWorld");
    const content = await vault.readNote("notes/test.md");
    expect(content).toBe("# Hello\n\nWorld");
  });

  it("emits note:changed on write", async () => {
    const paths: string[] = [];
    vault.addEventListener("note:changed", (e) => {
      paths.push((e as CustomEvent).detail.path);
    });
    await vault.writeNote("notes/a.md", "content");
    expect(paths).toContain("notes/a.md");
  });

  it("extracts backlinks from wikilinks", async () => {
    await vault.writeNote("notes/source.md", "See [[target]] and [[other]]");
    const backlinks = vault.getBacklinks("target");
    expect(backlinks).toContain("notes/source.md");
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
});
