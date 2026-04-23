import { describe, it, expect } from "vitest";
import {
  normalizePrefix,
  applicableZones,
  layersForPath,
  isPathEncrypted,
  zoneById,
  renameZonePrefix,
  validateNewZone,
  generateZoneId,
  type Zone,
} from "../src/codec/zones.ts";

function makeZone(prefix: string, id: string): Zone {
  return {
    id,
    prefix,
    algorithm: "age-v1",
    recipient: "age1test",
    wrappedIdentity: "dGVzdA==",
  };
}

describe("normalizePrefix", () => {
  it("adds a trailing slash", () => {
    expect(normalizePrefix("journal")).toBe("journal/");
    expect(normalizePrefix("journal/")).toBe("journal/");
  });

  it("strips leading slashes", () => {
    expect(normalizePrefix("/secrets")).toBe("secrets/");
    expect(normalizePrefix("//foo/bar")).toBe("foo/bar/");
  });

  it("rejects empty and root paths", () => {
    expect(() => normalizePrefix("")).toThrow();
    expect(() => normalizePrefix("/")).toThrow();
    expect(() => normalizePrefix("//")).toThrow();
  });
});

describe("applicableZones", () => {
  const journalZone = makeZone("journal/", "j");
  const privateZone = makeZone("journal/private/", "p");
  const workZone = makeZone("work/", "w");
  const all = [journalZone, privateZone, workZone];

  it("returns zones matching the path prefix, sorted shortest-first", () => {
    expect(applicableZones("journal/private/foo.md", all).map((z) => z.id))
      .toEqual(["j", "p"]);
  });

  it("returns a single zone when the path is in an outer zone only", () => {
    expect(applicableZones("journal/public.md", all).map((z) => z.id))
      .toEqual(["j"]);
  });

  it("returns empty for paths outside every zone", () => {
    expect(applicableZones("notes/foo.md", all)).toEqual([]);
  });

  it("trailing-slash semantics: journal matches journal/foo but not journalist", () => {
    const zones = [makeZone("journal/", "a")];
    expect(applicableZones("journal/foo.md", zones).map((z) => z.id)).toEqual(["a"]);
    expect(applicableZones("journalist/foo.md", zones)).toEqual([]);
  });
});

describe("layersForPath", () => {
  it("returns zone ids in decryption order (outermost first)", () => {
    const zones = [makeZone("journal/", "outer"), makeZone("journal/private/", "inner")];
    // Most-specific zone's encryption is applied LAST, so it's the OUTERMOST
    // wrapper on disk, so it's decrypted FIRST → "inner" comes first.
    expect(layersForPath("journal/private/foo.md", zones)).toEqual(["inner", "outer"]);
  });

  it("empty array for paths with no applicable zones", () => {
    expect(layersForPath("notes/a.md", [makeZone("work/", "w")])).toEqual([]);
  });
});

describe("isPathEncrypted", () => {
  it("true for any zone match", () => {
    expect(isPathEncrypted("journal/foo.md", [makeZone("journal/", "j")])).toBe(true);
  });
  it("false for no match", () => {
    expect(isPathEncrypted("notes/foo.md", [makeZone("journal/", "j")])).toBe(false);
  });
});

describe("zoneById", () => {
  it("finds a zone by id", () => {
    const a = makeZone("a/", "1");
    const b = makeZone("b/", "2");
    expect(zoneById("2", [a, b])).toBe(b);
    expect(zoneById("missing", [a, b])).toBeUndefined();
  });
});

describe("renameZonePrefix", () => {
  it("renames an exact-prefix match", () => {
    const zones = [makeZone("journal/", "j"), makeZone("work/", "w")];
    const next = renameZonePrefix(zones, "journal/", "diary/");
    expect(next.find((z) => z.id === "j")?.prefix).toBe("diary/");
    expect(next.find((z) => z.id === "w")?.prefix).toBe("work/"); // untouched
  });

  it("rewrites nested-child zone prefixes too", () => {
    const zones = [makeZone("journal/", "j"), makeZone("journal/private/", "p")];
    const next = renameZonePrefix(zones, "journal/", "diary/");
    expect(next.find((z) => z.id === "j")?.prefix).toBe("diary/");
    expect(next.find((z) => z.id === "p")?.prefix).toBe("diary/private/");
  });
});

describe("validateNewZone", () => {
  it("rejects exact duplicate prefix", () => {
    const zones = [makeZone("journal/", "j")];
    expect(() => validateNewZone("journal/", zones)).toThrow(/already exists/);
  });

  it("allows nested prefix", () => {
    const zones = [makeZone("journal/", "j")];
    expect(() => validateNewZone("journal/private/", zones)).not.toThrow();
  });

  it("allows parent prefix to existing zone", () => {
    const zones = [makeZone("journal/private/", "p")];
    expect(() => validateNewZone("journal/", zones)).not.toThrow();
  });

  it("normalizes input before comparing", () => {
    const zones = [makeZone("journal/", "j")];
    expect(() => validateNewZone("journal", zones)).toThrow(/already exists/);
    expect(() => validateNewZone("/journal/", zones)).toThrow(/already exists/);
  });
});

describe("generateZoneId", () => {
  it("produces a 32-char hex string", () => {
    const id = generateZoneId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("produces distinct ids", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateZoneId()));
    expect(ids.size).toBe(20);
  });
});
