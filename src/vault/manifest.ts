// Vault manifest — top-level IndexedDB database that catalogues every
// configured vault on this device. Lives outside the per-vault DBs so the
// boot path can find them before any one vault is opened.

import { openDB, type IDBPDatabase, type DBSchema } from "idb";

export const MANIFEST_DB_NAME = "lemonstone-manifest";
const MANIFEST_DB_VERSION = 1;

export interface VaultRecord {
  id: string;
  label: string;
  repoFullName: string;
  repoDefaultBranch: string;
  createdAt: number;
  lastOpenedAt: number;
}

interface MetaRecord {
  key: string;
  value: unknown;
}

interface ManifestDB extends DBSchema {
  vaults: { key: string; value: VaultRecord };
  meta: { key: string; value: MetaRecord };
}

let manifestPromise: Promise<IDBPDatabase<ManifestDB>> | null = null;

function openManifest(): Promise<IDBPDatabase<ManifestDB>> {
  if (!manifestPromise) {
    manifestPromise = openDB<ManifestDB>(MANIFEST_DB_NAME, MANIFEST_DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("vaults", { keyPath: "id" });
          db.createObjectStore("meta", { keyPath: "key" });
        }
      },
    });
  }
  return manifestPromise;
}

/** True iff the manifest DB exists on disk (has ever been created). */
export async function manifestExists(): Promise<boolean> {
  if (typeof indexedDB.databases !== "function") {
    // Firefox historically lacked this API. Fall back to probing: opening
    // the DB with version 0 isn't possible, so we just try openDB and
    // accept that this call may create the DB. Acceptable because the
    // boot path's only use of manifestExists is to gate a one-time wipe,
    // and if the manifest just got created, there's nothing to wipe.
    const list = await (indexedDB as unknown as { databases?: () => Promise<{ name?: string }[]> })
      .databases?.()
      .catch(() => [] as { name?: string }[]);
    return !!list?.some((d) => d.name === MANIFEST_DB_NAME);
  }
  const list = await indexedDB.databases();
  return list.some((d) => d.name === MANIFEST_DB_NAME);
}

// ── Vault CRUD ─────────────────────────────────────────────────────────────

export async function listVaults(): Promise<VaultRecord[]> {
  const db = await openManifest();
  const vaults = await db.getAll("vaults");
  vaults.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  return vaults;
}

export async function getVault(id: string): Promise<VaultRecord | null> {
  const db = await openManifest();
  return (await db.get("vaults", id)) ?? null;
}

export async function putVault(record: VaultRecord): Promise<void> {
  const db = await openManifest();
  await db.put("vaults", record);
}

export async function removeVaultRecord(id: string): Promise<void> {
  const db = await openManifest();
  await db.delete("vaults", id);
  // If the removed vault was current, clear the pointer.
  const current = await getCurrentVaultId();
  if (current === id) await setCurrentVaultId(null);
}

export async function touchVaultOpened(id: string): Promise<void> {
  const existing = await getVault(id);
  if (!existing) return;
  await putVault({ ...existing, lastOpenedAt: Date.now() });
}

// ── Current-vault pointer ──────────────────────────────────────────────────

export async function getCurrentVaultId(): Promise<string | null> {
  const db = await openManifest();
  const rec = await db.get("meta", "currentVaultId");
  return (rec?.value as string | undefined) ?? null;
}

export async function setCurrentVaultId(id: string | null): Promise<void> {
  const db = await openManifest();
  if (id === null) {
    await db.delete("meta", "currentVaultId");
  } else {
    await db.put("meta", { key: "currentVaultId", value: id });
  }
}

// ── Naming conventions ─────────────────────────────────────────────────────

/** IndexedDB database name for a vault. */
export function dbNameFor(vaultId: string): string {
  return `lemonstone-vault-${vaultId}`;
}

/** OPFS directory name for a vault's git working tree. */
export function opfsDirFor(vaultId: string): string {
  return `lemonstone-git-${vaultId}`;
}

/** Generate a short random hex id for a new vault. */
export function generateVaultId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
