// Integration-level tests for the selective-encryption pipeline.
//
// These exercise the ZoneService + AgeCodec wiring without IndexedDB: we
// directly perform the layered encode/decode that StorageAdapter does
// internally, to verify the layer ordering and cross-zone rejection behave
// as designed.

import { describe, it, expect } from "vitest";
import {
  createZone,
  ZoneService,
  applicableZones,
  layersForPath,
  type Zone,
} from "../src/codec/index.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function encodeForPath(
  plaintext: Uint8Array,
  path: string,
  svc: ZoneService,
): Promise<{ bytes: Uint8Array; layers: string[] }> {
  const zones = svc.applicableZones(path);
  if (zones.length === 0) return { bytes: plaintext, layers: [] };
  let bytes = plaintext;
  for (const z of zones) {
    const codec = svc.getCodec(z.id);
    bytes = await codec.encode(bytes, path);
  }
  const layers = zones.map((z) => z.id).reverse();
  return { bytes, layers };
}

async function decodeWithLayers(
  bytes: Uint8Array,
  path: string,
  layers: string[],
  svc: ZoneService,
): Promise<Uint8Array> {
  let out = bytes;
  for (const id of layers) {
    const codec = svc.getCodec(id);
    out = await codec.decode(out, path);
  }
  return out;
}

// scrypt passphrase work factor is intentionally slow; each createZone +
// unlockZone round-trip can take a few seconds on a loaded machine. Bump
// the per-test timeout so CI doesn't flake.
describe("selective encryption end-to-end", { timeout: 30_000 }, () => {
  it("round-trips a plaintext file (no zones apply)", async () => {
    const svc = new ZoneService();
    const { zone } = await createZone("secrets/", "pw");
    svc.setZones([zone]);
    await svc.unlockZone(zone.id, "pw");

    const plain = encoder.encode("# Plain note\n\nSafe to see.");
    const { bytes, layers } = await encodeForPath(plain, "notes/plain.md", svc);
    expect(layers).toEqual([]);
    expect(bytes).toEqual(plain);

    const recovered = await decodeWithLayers(bytes, "notes/plain.md", layers, svc);
    expect(decoder.decode(recovered)).toBe("# Plain note\n\nSafe to see.");
  });

  it("round-trips a single-zone file", async () => {
    const svc = new ZoneService();
    const { zone } = await createZone("journal/", "journal-pw");
    svc.setZones([zone]);
    await svc.unlockZone(zone.id, "journal-pw");

    const plain = encoder.encode("# Journal entry");
    const { bytes, layers } = await encodeForPath(plain, "journal/today.md", svc);
    expect(layers).toEqual([zone.id]);
    // age ciphertext must not equal plaintext
    expect(bytes).not.toEqual(plain);

    const recovered = await decodeWithLayers(bytes, "journal/today.md", layers, svc);
    expect(decoder.decode(recovered)).toBe("# Journal entry");
  });

  it("double-encrypts a nested file and unwraps in the right order", async () => {
    const svc = new ZoneService();
    const { zone: outer } = await createZone("journal/", "outer-pw");
    const { zone: inner } = await createZone("journal/private/", "inner-pw");
    svc.setZones([outer, inner]);
    await svc.unlockZone(outer.id, "outer-pw");
    await svc.unlockZone(inner.id, "inner-pw");

    const plain = encoder.encode("# Secret diary");
    const { bytes, layers } = await encodeForPath(plain, "journal/private/diary.md", svc);
    // Layers: innermost (most-specific) first, outermost (least-specific) last.
    expect(layers).toEqual([inner.id, outer.id]);

    // Peel both layers back.
    const recovered = await decodeWithLayers(bytes, "journal/private/diary.md", layers, svc);
    expect(decoder.decode(recovered)).toBe("# Secret diary");
  });

  it("layersForPath produces the same order as the encode pipeline records", async () => {
    const { zone: outer } = await createZone("j/", "po");
    const { zone: inner } = await createZone("j/p/", "pi");
    const zones: Zone[] = [outer, inner];

    expect(layersForPath("j/p/x.md", zones)).toEqual([inner.id, outer.id]);
    expect(layersForPath("j/x.md", zones)).toEqual([outer.id]);
    expect(layersForPath("other.md", zones)).toEqual([]);
  });

  it("applicableZones is sorted shortest-first regardless of input order", async () => {
    const { zone: inner } = await createZone("j/p/", "pi");
    const { zone: outer } = await createZone("j/", "po");
    const applicable = applicableZones("j/p/x.md", [inner, outer]);
    expect(applicable.map((z) => z.prefix)).toEqual(["j/", "j/p/"]);
  });

  it("decrypting with a locked zone throws ZoneLockedError", async () => {
    const svc = new ZoneService();
    const { zone } = await createZone("journal/", "pw");
    svc.setZones([zone]);
    await svc.unlockZone(zone.id, "pw");

    const plain = encoder.encode("data");
    const { bytes, layers } = await encodeForPath(plain, "journal/a.md", svc);
    svc.lockZone(zone.id);

    await expect(decodeWithLayers(bytes, "journal/a.md", layers, svc)).rejects.toThrow(/locked/);
  });

  it("wrong zone identity cannot decrypt another zone's ciphertext", async () => {
    const svcA = new ZoneService();
    const { zone: za } = await createZone("a/", "pa");
    svcA.setZones([za]);
    await svcA.unlockZone(za.id, "pa");
    const { bytes: cipher, layers } = await encodeForPath(encoder.encode("A's secret"), "a/f.md", svcA);

    const svcB = new ZoneService();
    const { zone: zb } = await createZone("b/", "pb");
    // Note: we attach za's id to the zones for decode lookup, but use zb's identity:
    svcB.setZones([{ ...za, recipient: zb.recipient, wrappedIdentity: zb.wrappedIdentity }]);
    await svcB.unlockZone(za.id, "pb");

    await expect(decodeWithLayers(cipher, "a/f.md", layers, svcB)).rejects.toThrow();
  });
});
