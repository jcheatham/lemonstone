// Encrypted vault share links.
//
// A share link is `#/share/<base64url-blob>` where the blob is an age-format
// ciphertext (passphrase recipient) of a JSON ShareLinkPayload. The sender
// shares the URL via any channel; the password goes via a separate channel.
// On receipt, the app prompts for the password, decrypts, and registers a
// new vault with the carried PAT.
//
// The format is intentionally future-proof: the payload carries `version: 1`
// so later readers can add optional fields without breaking older links.

import { Encrypter, Decrypter } from "age-encryption";

export interface ShareLinkPayload {
  version: 1;
  repoFullName: string;
  repoDefaultBranch: string;
  accessToken: string; // PAT
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encrypt a share-link payload with a password. Returns base64url-encoded
 *  ciphertext suitable for use as the hash portion of a URL. */
export async function encodeShareLink(
  payload: ShareLinkPayload,
  password: string,
): Promise<string> {
  if (!password) throw new Error("password is required");
  const json = JSON.stringify(payload);
  const enc = new Encrypter();
  enc.setPassphrase(password);
  const cipher = await enc.encrypt(encoder.encode(json));
  return bytesToBase64Url(cipher);
}

/** Decrypt a share-link blob with a password. Throws on wrong password,
 *  malformed blob, or malformed payload. */
export async function decodeShareLink(
  blob: string,
  password: string,
): Promise<ShareLinkPayload> {
  if (!password) throw new Error("password is required");
  let cipher: Uint8Array;
  try {
    cipher = base64UrlToBytes(blob);
  } catch (err) {
    throw new Error("malformed share link", { cause: err });
  }
  const dec = new Decrypter();
  dec.addPassphrase(password);
  let plaintextBytes: Uint8Array;
  try {
    plaintextBytes = await dec.decrypt(cipher);
  } catch (err) {
    throw new Error("wrong password", { cause: err });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(plaintextBytes));
  } catch (err) {
    throw new Error("malformed payload", { cause: err });
  }
  if (!isShareLinkPayload(parsed)) {
    throw new Error("malformed payload");
  }
  return parsed;
}

function isShareLinkPayload(v: unknown): v is ShareLinkPayload {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    r["version"] === 1 &&
    typeof r["repoFullName"] === "string" &&
    typeof r["repoDefaultBranch"] === "string" &&
    typeof r["accessToken"] === "string"
  );
}

// ── base64url helpers ──────────────────────────────────────────────────────

/** Encode bytes as base64url (RFC 4648 §5), no padding. URL-safe. */
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  // Restore standard base64 before decoding: swap -/_ back, pad to multiple of 4.
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
