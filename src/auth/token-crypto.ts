import { getDB } from "../storage/db.ts";

const CRYPTO_KEY_STORE = "config";
const CRYPTO_KEY_RECORD = "authCryptoKey";

async function getOrCreateKey(): Promise<CryptoKey> {
  const db = await getDB();
  const stored = await db.get(CRYPTO_KEY_STORE, CRYPTO_KEY_RECORD);
  if (stored?.value) {
    return stored.value as CryptoKey;
  }
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false, // non-exportable
    ["encrypt", "decrypt"]
  );
  await db.put(CRYPTO_KEY_STORE, { key: CRYPTO_KEY_RECORD, value: key });
  return key;
}

export async function encryptTokenPayload(payload: string): Promise<string> {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(payload);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );
  // Serialize as base64(iv + ciphertext)
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptTokenPayload(stored: string): Promise<string> {
  const key = await getOrCreateKey();
  const combined = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}
