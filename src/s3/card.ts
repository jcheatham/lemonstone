// S3 vault cards — a self-contained, passphrase-encrypted blob embedded in
// note content (a ```s3vault fenced code block), mirroring src/vault/share-link.ts
// exactly: age-format ciphertext (passphrase recipient) of a JSON payload,
// base64url-encoded. Nothing about the card (not even the bucket name) is
// visible without the passphrase — same all-or-nothing model as a share link.
//
// Unlike a share link, this is meant to be committed to the vault's repo (so
// it syncs across devices, encrypted) rather than sent out-of-band — but the
// encoding/decoding mechanism is identical. "Activating" a card on a device
// (see ls-s3-card-accept-modal.ts) decrypts it locally and caches the result
// in that device's local config; the card blob itself is the only persistent
// record, there's no separate manifest.

import { Encrypter, Decrypter } from "age-encryption";

export interface S3CardPayload {
  version: 1;
  id: string; // stable id, generated at creation — keys the local activation cache
  displayName: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Generate a random id for a new card. */
export function generateCardId(): string {
  return crypto.randomUUID();
}

/** Encrypt a card payload with a passphrase. Returns a base64url blob
 *  suitable for embedding directly in a ```s3vault fenced code block. */
export async function encodeS3Card(payload: S3CardPayload, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error("passphrase is required");
  const json = JSON.stringify(payload);
  const enc = new Encrypter();
  enc.setPassphrase(passphrase);
  const cipher = await enc.encrypt(encoder.encode(json));
  return bytesToBase64Url(cipher);
}

/** Decrypt a card blob with a passphrase. Throws on wrong passphrase,
 *  malformed blob, or malformed payload. */
export async function decodeS3Card(blob: string, passphrase: string): Promise<S3CardPayload> {
  if (!passphrase) throw new Error("passphrase is required");
  let cipher: Uint8Array;
  try {
    cipher = base64UrlToBytes(blob);
  } catch (err) {
    throw new Error("malformed vault blob", { cause: err });
  }
  const dec = new Decrypter();
  dec.addPassphrase(passphrase);
  let plaintextBytes: Uint8Array;
  try {
    plaintextBytes = await dec.decrypt(cipher);
  } catch (err) {
    throw new Error("wrong passphrase", { cause: err });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(plaintextBytes));
  } catch (err) {
    throw new Error("malformed payload", { cause: err });
  }
  if (!isS3CardPayload(parsed)) {
    throw new Error("malformed payload");
  }
  return parsed;
}

function isS3CardPayload(v: unknown): v is S3CardPayload {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    r["version"] === 1 &&
    typeof r["id"] === "string" &&
    typeof r["displayName"] === "string" &&
    typeof r["bucket"] === "string" &&
    typeof r["region"] === "string" &&
    typeof r["accessKeyId"] === "string" &&
    typeof r["secretAccessKey"] === "string" &&
    (r["sessionToken"] === undefined || typeof r["sessionToken"] === "string")
  );
}

// ── base64url helpers (identical to share-link.ts) ──────────────────────────

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad === 2) b64 += "==";
  else if (pad === 3) b64 += "=";
  else if (pad !== 0) throw new Error("invalid base64url length");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
