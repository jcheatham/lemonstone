import { getDB } from "../storage/db.ts";
import { encryptTokenPayload, decryptTokenPayload } from "./token-crypto.ts";
import type { AuthPayload } from "../storage/schema.ts";

export async function saveTokens(payload: AuthPayload): Promise<void> {
  const encrypted = await encryptTokenPayload(JSON.stringify(payload));
  const db = await getDB();
  await db.put("auth", { key: "github", encryptedPayload: encrypted });
}

export async function loadTokens(): Promise<AuthPayload | null> {
  const db = await getDB();
  const record = await db.get("auth", "github");
  if (!record) return null;
  try {
    const json = await decryptTokenPayload(record.encryptedPayload);
    return JSON.parse(json) as AuthPayload;
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  const db = await getDB();
  await db.delete("auth", "github");
}

export async function isAuthenticated(): Promise<boolean> {
  const tokens = await loadTokens();
  if (!tokens) return false;
  return Date.now() < tokens.refreshTokenExpiresAt;
}
