// Runtime service that owns the in-memory zone identity map.
//
// Identities are held in this service only (never persisted, never logged).
// Sign-out calls lockAll(). Reading a record whose codec references a locked
// zone produces a ZoneLockedError — the UI catches it, prompts for the
// passphrase, unlocks the zone, and retries.

import { AgeCodec } from "./age-codec.ts";
import type { Zone } from "./zones.ts";
import { applicableZones, zoneById } from "./zones.ts";
import { unwrapZoneIdentity } from "./keys.ts";

export class ZoneLockedError extends Error {
  constructor(public readonly zoneId: string, public readonly prefix: string) {
    super(`zone is locked: ${prefix} (${zoneId})`);
    this.name = "ZoneLockedError";
  }
}

export class ZoneMissingError extends Error {
  constructor(public readonly zoneId: string) {
    super(`zone not found in keys.json: ${zoneId}`);
    this.name = "ZoneMissingError";
  }
}

export class ZoneService {
  private zones: Zone[] = [];
  private identities = new Map<string, string>(); // zoneId -> decoded age identity
  private codecs = new Map<string, AgeCodec>();   // zoneId -> cached AgeCodec

  setZones(zones: readonly Zone[]): void {
    this.zones = [...zones];
    // Drop any cached state for zones that disappeared.
    for (const id of [...this.identities.keys()]) {
      if (!this.zones.some((z) => z.id === id)) {
        this.identities.delete(id);
        this.codecs.delete(id);
      }
    }
    for (const id of [...this.codecs.keys()]) {
      if (!this.zones.some((z) => z.id === id)) this.codecs.delete(id);
    }
  }

  listZones(): Zone[] {
    return [...this.zones];
  }

  getZone(zoneId: string): Zone | undefined {
    return zoneById(zoneId, this.zones);
  }

  applicableZones(path: string): Zone[] {
    return applicableZones(path, this.zones);
  }

  isUnlocked(zoneId: string): boolean {
    return this.identities.has(zoneId);
  }

  lockedZoneIds(): string[] {
    return this.zones.filter((z) => !this.identities.has(z.id)).map((z) => z.id);
  }

  /** Unlock a zone with the given passphrase. Throws on wrong passphrase. */
  async unlockZone(zoneId: string, passphrase: string): Promise<void> {
    const zone = this.getZone(zoneId);
    if (!zone) throw new ZoneMissingError(zoneId);
    const identity = await unwrapZoneIdentity(zone, passphrase);
    this.identities.set(zoneId, identity);
    this.codecs.delete(zoneId); // force fresh codec with the new identity
  }

  /** Register a zone whose identity is already known (e.g. just created). */
  registerIdentity(zoneId: string, identity: string): void {
    this.identities.set(zoneId, identity);
    this.codecs.delete(zoneId);
  }

  lockZone(zoneId: string): void {
    this.identities.delete(zoneId);
    this.codecs.delete(zoneId);
  }

  lockAll(): void {
    this.identities.clear();
    this.codecs.clear();
  }

  /**
   * Get the codec for a zone. Throws ZoneLockedError if the zone's identity
   * isn't in memory. Throws ZoneMissingError if the zoneId isn't registered
   * in keys.json at all (configuration problem, not a lock state).
   */
  getCodec(zoneId: string): AgeCodec {
    const cached = this.codecs.get(zoneId);
    if (cached) return cached;
    const zone = this.getZone(zoneId);
    if (!zone) throw new ZoneMissingError(zoneId);
    const identity = this.identities.get(zoneId);
    if (!identity) throw new ZoneLockedError(zoneId, zone.prefix);
    const codec = new AgeCodec(identity, zone.recipient);
    this.codecs.set(zoneId, codec);
    return codec;
  }
}
