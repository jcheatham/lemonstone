import { describe, it, expect } from "vitest";
import { ZoneService, ZoneLockedError, ZoneMissingError, HistoricalContentLockedError } from "../src/codec/zone-service.ts";
import { createZone } from "../src/codec/keys.ts";

describe("ZoneService", { timeout: 30_000 }, () => {
  it("returns applicable zones for a path", async () => {
    const svc = new ZoneService();
    const { zone: j } = await createZone("journal/", "pw1");
    const { zone: p } = await createZone("journal/private/", "pw2");
    svc.setZones([j, p]);

    expect(svc.applicableZones("journal/private/a.md").map((z) => z.id)).toEqual([j.id, p.id]);
    expect(svc.applicableZones("notes/a.md")).toEqual([]);
  });

  it("getCodec throws ZoneLockedError when identity isn't registered", async () => {
    const svc = new ZoneService();
    const { zone } = await createZone("x/", "pw");
    svc.setZones([zone]);
    expect(() => svc.getCodec(zone.id)).toThrow(ZoneLockedError);
  });

  it("getCodec throws ZoneMissingError when the zone isn't registered at all", () => {
    const svc = new ZoneService();
    svc.setZones([]);
    expect(() => svc.getCodec("nope")).toThrow(ZoneMissingError);
  });

  it("unlockZone with correct passphrase enables getCodec to succeed", async () => {
    const svc = new ZoneService();
    const { zone } = await createZone("x/", "correct-horse");
    svc.setZones([zone]);
    await svc.unlockZone(zone.id, "correct-horse");
    const codec = svc.getCodec(zone.id);
    expect(codec.scheme).toBe("age");
  });

  it("unlockZone with wrong passphrase throws and keeps zone locked", async () => {
    const svc = new ZoneService();
    const { zone } = await createZone("x/", "correct-horse");
    svc.setZones([zone]);
    await expect(svc.unlockZone(zone.id, "wrong")).rejects.toThrow();
    expect(svc.isUnlocked(zone.id)).toBe(false);
  });

  it("lockZone clears the identity", async () => {
    const svc = new ZoneService();
    const { zone } = await createZone("x/", "pw");
    svc.setZones([zone]);
    await svc.unlockZone(zone.id, "pw");
    expect(svc.isUnlocked(zone.id)).toBe(true);
    svc.lockZone(zone.id);
    expect(svc.isUnlocked(zone.id)).toBe(false);
    expect(() => svc.getCodec(zone.id)).toThrow(ZoneLockedError);
  });

  it("lockAll clears every identity", async () => {
    const svc = new ZoneService();
    const { zone: a } = await createZone("a/", "pa");
    const { zone: b } = await createZone("b/", "pb");
    svc.setZones([a, b]);
    await svc.unlockZone(a.id, "pa");
    await svc.unlockZone(b.id, "pb");
    svc.lockAll();
    expect(svc.isUnlocked(a.id)).toBe(false);
    expect(svc.isUnlocked(b.id)).toBe(false);
  });

  it("setZones drops cached identities for zones that disappear", async () => {
    const svc = new ZoneService();
    const { zone } = await createZone("x/", "pw");
    svc.setZones([zone]);
    await svc.unlockZone(zone.id, "pw");
    expect(svc.isUnlocked(zone.id)).toBe(true);
    svc.setZones([]); // zone removed from keys.json
    expect(svc.isUnlocked(zone.id)).toBe(false);
  });

  it("registerIdentity enables codec without a passphrase round-trip", async () => {
    const svc = new ZoneService();
    const { zone, identity } = await createZone("x/", "pw");
    svc.setZones([zone]);
    svc.registerIdentity(zone.id, identity);
    const codec = svc.getCodec(zone.id);
    expect(codec.scheme).toBe("age");
  });

  it("ZoneLockedError carries the zone prefix for UI consumption", async () => {
    const svc = new ZoneService();
    const { zone } = await createZone("secrets/vault/", "pw");
    svc.setZones([zone]);
    try {
      svc.getCodec(zone.id);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ZoneLockedError);
      expect((err as ZoneLockedError).prefix).toBe("secrets/vault/");
      expect((err as ZoneLockedError).zoneId).toBe(zone.id);
    }
  });

  it("lockedZoneIds lists zones that haven't been unlocked", async () => {
    const svc = new ZoneService();
    const { zone: a } = await createZone("a/", "pa");
    const { zone: b } = await createZone("b/", "pb");
    svc.setZones([a, b]);
    await svc.unlockZone(a.id, "pa");
    expect(svc.lockedZoneIds()).toEqual([b.id]);
  });

  describe("decodeHistorical", () => {
    it("returns plaintext unchanged", async () => {
      const svc = new ZoneService();
      const plaintext = new TextEncoder().encode("# hello\n");
      const out = await svc.decodeHistorical(plaintext, "notes/a.md");
      expect(new TextDecoder().decode(out)).toBe("# hello\n");
    });

    it("peels a single zone layer using the currently-unlocked identity", async () => {
      const svc = new ZoneService();
      const { zone, identity } = await createZone("secrets/", "pw");
      svc.setZones([zone]);
      svc.registerIdentity(zone.id, identity);
      const codec = svc.getCodec(zone.id);
      const plaintext = new TextEncoder().encode("top secret");
      const ciphertext = await codec.encode(plaintext, "secrets/a.md");

      const out = await svc.decodeHistorical(ciphertext, "secrets/a.md");
      expect(new TextDecoder().decode(out)).toBe("top secret");
    });

    it("peels nested zone layers regardless of order, using whatever's unlocked", async () => {
      const svc = new ZoneService();
      const { zone: outer, identity: outerIdentity } = await createZone("journal/", "pw1");
      const { zone: inner, identity: innerIdentity } = await createZone("journal/private/", "pw2");
      svc.setZones([outer, inner]);
      svc.registerIdentity(outer.id, outerIdentity);
      svc.registerIdentity(inner.id, innerIdentity);

      const plaintext = new TextEncoder().encode("deeply private");
      // Encrypt inner-first, then outer wraps it (matches encodeForPath order).
      const innerCt = await svc.getCodec(inner.id).encode(plaintext, "journal/private/a.md");
      const outerCt = await svc.getCodec(outer.id).encode(innerCt, "journal/private/a.md");

      const out = await svc.decodeHistorical(outerCt, "journal/private/a.md");
      expect(new TextDecoder().decode(out)).toBe("deeply private");
    });

    it("throws HistoricalContentLockedError when the needed zone isn't unlocked", async () => {
      const svc = new ZoneService();
      const { zone, identity } = await createZone("secrets/", "pw");
      svc.setZones([zone]);
      const codec = new (await import("../src/codec/age-codec.ts")).AgeCodec(identity, zone.recipient);
      const ciphertext = await codec.encode(new TextEncoder().encode("hidden"), "secrets/a.md");

      // Zone is registered but never unlocked in this service instance.
      await expect(svc.decodeHistorical(ciphertext, "secrets/a.md")).rejects.toThrow(
        HistoricalContentLockedError,
      );
    });

    it("throws HistoricalContentLockedError when the zone was later removed entirely", async () => {
      const svc = new ZoneService();
      const { zone, identity } = await createZone("secrets/", "pw");
      const codec = new (await import("../src/codec/age-codec.ts")).AgeCodec(identity, zone.recipient);
      const ciphertext = await codec.encode(new TextEncoder().encode("hidden"), "secrets/a.md");

      svc.setZones([]); // zone no longer exists in the current registry at all
      await expect(svc.decodeHistorical(ciphertext, "secrets/a.md")).rejects.toThrow(
        HistoricalContentLockedError,
      );
    });
  });
});
