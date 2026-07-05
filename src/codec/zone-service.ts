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
import { looksEncrypted } from "./identity-codec.ts";

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

/** Thrown by decodeHistorical when bytes still look encrypted after trying
 *  every currently-unlocked zone's identity. */
export class HistoricalContentLockedError extends Error {
  constructor(public readonly path: string) {
    super(`content at ${path} is still encrypted; unlock the relevant zone(s) to view it`);
    this.name = "HistoricalContentLockedError";
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

  /**
   * Decode bytes read from a historical git blob (e.g. a file's content as of
   * some past commit). Historical commits don't carry the app's own codec /
   * layer bookkeeping — that descriptor only exists in IndexedDB for the
   * *current* record — so instead of trusting a known layer list, this tries
   * every currently-unlocked zone's identity and peels a layer whenever one
   * succeeds, repeating until the bytes no longer look like age ciphertext.
   * Throws HistoricalContentLockedError if bytes still look encrypted and no
   * unlocked identity can peel them further.
   */
  async decodeHistorical(bytes: Uint8Array, path: string): Promise<Uint8Array> {
    let out = bytes;
    const maxRounds = this.zones.length + 1;
    for (let round = 0; round < maxRounds && looksEncrypted(out); round++) {
      let peeled = false;
      for (const zone of this.zones) {
        if (!this.identities.has(zone.id)) continue;
        try {
          out = await this.getCodec(zone.id).decode(out, path);
          peeled = true;
          break;
        } catch {
          continue;
        }
      }
      if (!peeled) throw new HistoricalContentLockedError(path);
    }
    if (looksEncrypted(out)) throw new HistoricalContentLockedError(path);
    return out;
  }
}
