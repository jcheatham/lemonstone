import { getDB } from "../storage/db.ts";
import { encryptTokenPayload, decryptTokenPayload } from "./token-crypto.ts";
import type { AuthPayload } from "../storage/schema.ts";

// Each vault has its own auth store (one record keyed "github" per vault DB).
// Callers must pass the vault's dbName — see manifest.dbNameFor(vaultId).

export async function saveTokens(dbName: string, payload: AuthPayload): Promise<void> {
  const encrypted = await encryptTokenPayload(dbName, JSON.stringify(payload));
  const db = await getDB(dbName);
  await db.put("auth", { key: "github", encryptedPayload: encrypted });
}

export async function loadTokens(dbName: string): Promise<AuthPayload | null> {
  const db = await getDB(dbName);
  const record = await db.get("auth", "github");
  if (!record) return null;
  try {
    const json = await decryptTokenPayload(dbName, record.encryptedPayload);
    return JSON.parse(json) as AuthPayload;
  } catch {
    return null;
  }
}

export async function clearTokens(dbName: string): Promise<void> {
  const db = await getDB(dbName);
  await db.delete("auth", "github");
}

export async function isAuthenticated(dbName: string): Promise<boolean> {
  const tokens = await loadTokens(dbName);
  if (!tokens) return false;
  // PATs use accessTokenExpiresAt (refreshTokenExpiresAt is 0 for PATs).
  return Date.now() < tokens.accessTokenExpiresAt;
}
