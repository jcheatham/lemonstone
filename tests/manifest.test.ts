// Manifest DB smoke tests. Exercises the tiny helper surface without
// mounting any of the rest of the vault machinery.

import { describe, it, expect } from "vitest";

// Pure helpers only — the IDB-backed CRUD is exercised via end-to-end
// manual verification (see the plan). A full unit test for the CRUD layer
// would require fake-indexeddb, which isn't currently a dev dependency.

import { dbNameFor, generateVaultId, opfsDirFor } from "../src/vault/manifest.ts";

describe("vault manifest helpers", () => {
  it("dbNameFor is deterministic and prefixed", () => {
    expect(dbNameFor("abc123")).toBe("lemonstone-vault-abc123");
    expect(dbNameFor("")).toBe("lemonstone-vault-");
  });

  it("opfsDirFor is deterministic and prefixed", () => {
    expect(opfsDirFor("abc123")).toBe("lemonstone-git-abc123");
  });

  it("dbNameFor and opfsDirFor produce distinct namespaces for the same id", () => {
    const id = "shared";
    expect(dbNameFor(id)).not.toBe(opfsDirFor(id));
  });

  it("generateVaultId produces unique 16-char hex", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateVaultId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});
