// One-shot boot task: if the multi-vault manifest doesn't exist yet, wipe
// any pre-multi-vault install so the user starts clean. The app is in alpha
// and we opted out of migration complexity — see the plan.

import { manifestExists, MANIFEST_DB_NAME } from "./manifest.ts";

const LEGACY_DB_NAME = "lemonstone-vault";
const LEGACY_OPFS_DIR = "lemonstone-git";

/**
 * Detect a pre-multi-vault install (manifest absent) and delete its IDB +
 * OPFS remnants. Safe to run on a fresh profile — both deletes are no-ops
 * when the target doesn't exist. Creates the manifest DB as a side-effect
 * of returning so subsequent calls to `manifestExists()` resolve `true`.
 */
export async function boot(): Promise<void> {
  const hasManifest = await manifestExists().catch(() => false);
  if (hasManifest) return;

  // Legacy single-vault IDB.
  try {
    await indexedDB.deleteDatabase(LEGACY_DB_NAME);
  } catch (err) {
    console.warn(`[boot] could not delete legacy DB "${LEGACY_DB_NAME}":`, err);
  }

  // Legacy OPFS git working tree.
  if (typeof navigator?.storage?.getDirectory === "function") {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(LEGACY_OPFS_DIR, { recursive: true });
    } catch { /* dir may not exist — fine */ }
  }

  console.info(
    `[boot] multi-vault manifest "${MANIFEST_DB_NAME}" will be created fresh; ` +
    `any legacy single-vault data has been removed.`,
  );
}
