import { describe, it, expect } from "vitest";
import { ZoneService, ZoneLockedError, ZoneMissingError } from "../src/codec/zone-service.ts";
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
});
