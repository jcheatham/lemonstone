// Pure helpers for zone policy. No I/O, no crypto.
//
// A "zone" anchors an encryption policy at a folder prefix. Zones nest:
// a file at `journal/private/foo.md` where both `journal/` and
// `journal/private/` are zones is encrypted twice, inner zone last.

export interface Zone {
  id: string;                    // opaque, stable across prefix rename
  prefix: string;                // always ends with "/"
  algorithm: "age-v1";
  recipient: string;             // age public key
  wrappedIdentity: string;       // base64 of passphrase-wrapped private key
}

/** Normalize any folder path to a prefix with a trailing slash. Empty string is invalid. */
export function normalizePrefix(path: string): string {
  if (!path) throw new Error("zone prefix cannot be empty");
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) throw new Error("zone prefix cannot be the repo root");
  return trimmed + "/";
}

/** Zones whose prefix is a prefix of `path`, sorted shortest-first (outermost first). */
export function applicableZones(path: string, zones: readonly Zone[]): Zone[] {
  const out = zones.filter((z) => path.startsWith(z.prefix));
  out.sort((a, b) => a.prefix.length - b.prefix.length);
  return out;
}

/** Layers (zone ids) that a fresh record at `path` should have, in decryption order (outermost first). */
export function layersForPath(path: string, zones: readonly Zone[]): string[] {
  return applicableZones(path, zones).map((z) => z.id).reverse();
}

/** True if any zone is applicable to this path. */
export function isPathEncrypted(path: string, zones: readonly Zone[]): boolean {
  return zones.some((z) => path.startsWith(z.prefix));
}

/** Zone lookup by id. Returns undefined if not found. */
export function zoneById(zoneId: string, zones: readonly Zone[]): Zone | undefined {
  return zones.find((z) => z.id === zoneId);
}

/** Rename a zone's prefix. Returns a new zones array; does not touch any records. */
export function renameZonePrefix(
  zones: readonly Zone[],
  oldPrefix: string,
  newPrefix: string
): Zone[] {
  const from = normalizePrefix(oldPrefix);
  const to = normalizePrefix(newPrefix);
  return zones.map((z) => {
    if (z.prefix === from) return { ...z, prefix: to };
    // If a zone is a child of the renamed prefix, its prefix also moves.
    if (z.prefix.startsWith(from)) return { ...z, prefix: to + z.prefix.slice(from.length) };
    return z;
  });
}

/** Validate a proposed new zone can be added. Throws with a human message on violation. */
export function validateNewZone(newPrefix: string, zones: readonly Zone[]): void {
  const p = normalizePrefix(newPrefix);
  for (const z of zones) {
    if (z.prefix === p) {
      throw new Error(`A zone already exists at ${p}`);
    }
  }
}

/** Generate a random hex id suitable for use as a zone id. */
export function generateZoneId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
