// .lemonstone/keys.json read/write + per-zone passphrase wrap/unwrap.
//
// File format (committed to vault repo):
//   {
//     "version": 1,
//     "zones": [
//       {
//         "id": "<hex>",
//         "prefix": "journal/",
//         "algorithm": "age-v1",
//         "recipient": "age1...",
//         "wrappedIdentity": "<base64>"
//       },
//       ...
//     ]
//   }
//
// The wrapped identity is itself age-format ciphertext produced by encrypting
// the identity to a passphrase recipient (scrypt). The age header within the
// wrapped blob carries salt + work-factor parameters.

import { Encrypter, Decrypter, generateIdentity, identityToRecipient } from "age-encryption";
import type { Zone } from "./zones.ts";
import { generateZoneId, normalizePrefix } from "./zones.ts";

export const KEYS_JSON_PATH = ".lemonstone/keys.json";

export interface KeysFile {
  version: 1;
  zones: Zone[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function isZone(value: unknown): value is Zone {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string" &&
    typeof v["prefix"] === "string" &&
    v["algorithm"] === "age-v1" &&
    typeof v["recipient"] === "string" &&
    typeof v["wrappedIdentity"] === "string"
  );
}

export function isKeysFile(value: unknown): value is KeysFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v["version"] !== 1) return false;
  if (!Array.isArray(v["zones"])) return false;
  return v["zones"].every(isZone);
}

export function parseKeysJson(bytes: Uint8Array): KeysFile {
  const text = decoder.decode(bytes);
  const parsed = JSON.parse(text);
  if (!isKeysFile(parsed)) {
    throw new Error("keys.json: malformed file");
  }
  return parsed;
}

export function serializeKeysJson(file: KeysFile): Uint8Array {
  return encoder.encode(JSON.stringify(file, null, 2) + "\n");
}

// ── Base64 helpers ──────────────────────────────────────────────────────────

function bytesToBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s);
}

function base64ToBytes(s: string): Uint8Array {
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ── Zone creation / wrap / unwrap ──────────────────────────────────────────

/** Create a fresh Zone with a newly generated identity, wrapped with the given passphrase. */
export async function createZone(
  prefix: string,
  passphrase: string,
  algorithm: "age-v1" = "age-v1",
): Promise<{ zone: Zone; identity: string }> {
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  const enc = new Encrypter();
  enc.setPassphrase(passphrase);
  const wrapped = await enc.encrypt(encoder.encode(identity));
  const zone: Zone = {
    id: generateZoneId(),
    prefix: normalizePrefix(prefix),
    algorithm,
    recipient,
    wrappedIdentity: bytesToBase64(wrapped),
  };
  return { zone, identity };
}

/** Unwrap a zone's identity using the given passphrase. Throws on wrong passphrase. */
export async function unwrapZoneIdentity(zone: Zone, passphrase: string): Promise<string> {
  const wrapped = base64ToBytes(zone.wrappedIdentity);
  const dec = new Decrypter();
  dec.addPassphrase(passphrase);
  let bytes: Uint8Array;
  try {
    bytes = await dec.decrypt(wrapped);
  } catch (err) {
    throw new Error("wrong passphrase", { cause: err });
  }
  const identity = decoder.decode(bytes).trim();
  if (!identity.startsWith("AGE-SECRET-KEY-")) {
    throw new Error("wrapped payload is not an age identity");
  }
  const derivedRecipient = await identityToRecipient(identity);
  if (derivedRecipient !== zone.recipient) {
    throw new Error("zone recipient doesn't match the wrapped identity");
  }
  return identity;
}

/** Re-wrap a zone's identity under a new passphrase. Returns a new Zone with the same id/prefix/recipient. */
export async function rewrapZoneIdentity(
  zone: Zone,
  identity: string,
  newPassphrase: string,
): Promise<Zone> {
  const enc = new Encrypter();
  enc.setPassphrase(newPassphrase);
  const wrapped = await enc.encrypt(encoder.encode(identity));
  return { ...zone, wrappedIdentity: bytesToBase64(wrapped) };
}
