// Vault multiplexer — a singleton facade that the rest of the app holds
// a reference to via `vaultService`. Internally it delegates to whichever
// inner `VaultService` represents the current vault; swap-in-place on
// vault switch without forcing UI code to re-attach listeners.

import { VaultService, type VaultServiceConfig } from "./vault-service.ts";
import {
  dbNameFor,
  generateVaultId,
  getCurrentVaultId,
  getVault,
  listVaults,
  opfsDirFor,
  putVault,
  removeVaultRecord,
  setCurrentVaultId,
  touchVaultOpened,
  type VaultRecord,
} from "./manifest.ts";
import { saveTokens } from "../auth/token-store.ts";
import { forgetDB } from "../storage/db.ts";
import { callWorker } from "../sync/sync-client.ts";
import type { AuthPayload } from "../storage/schema.ts";
import { setRouterCurrentVault } from "../ui/router.ts";

/** Events dispatched on the multiplexer only (not forwarded from inner). */
export type MultiplexerEvent =
  | "vaults:changed"        // manifest mutated (add/remove/rename)
  | "vaults:currentChanged" // user switched the active vault
  ;

const FORWARDED_EVENTS = [
  "vault:ready",
  "vault:synced",
  "vault:syncError",
  "vault:conflictDetected",
  "vault:wakeSync",
  "vault:zoneCreated",
  "vault:zoneRemoved",
  "vault:zoneUnlocked",
  "vault:zoneLocked",
  "vault:allZonesLocked",
  "vault:zonesReloaded",
  "note:changed",
  "note:deleted",
  "note:linkGraphChanged",
  "note:tagIndexChanged",
] as const;

export class VaultMultiplexer extends EventTarget {
  #current: VaultService | null = null;
  #switchLock: Promise<void> = Promise.resolve();
  #forwardingCleanup: (() => void) | null = null;

  get currentVault(): VaultService | null { return this.#current; }
  get currentVaultId(): string | null { return this.#current?.vaultId ?? null; }

  // ── Manifest-level operations ───────────────────────────────────────────

  async listVaults(): Promise<VaultRecord[]> {
    return listVaults();
  }

  async addVault(tokens: AuthPayload, opts: { label?: string } = {}): Promise<VaultRecord> {
    const id = generateVaultId();
    const record: VaultRecord = {
      id,
      label: opts.label ?? tokens.repoFullName,
      repoFullName: tokens.repoFullName,
      repoDefaultBranch: tokens.repoDefaultBranch,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    };
    // Stash the auth payload into the brand-new vault's auth store.
    await saveTokens(dbNameFor(id), tokens);
    await putVault(record);
    this.dispatchEvent(new Event("vaults:changed"));
    return record;
  }

  async renameVault(id: string, label: string): Promise<void> {
    const record = await getVault(id);
    if (!record) return;
    await putVault({ ...record, label });
    this.dispatchEvent(new Event("vaults:changed"));
  }

  async removeVault(id: string): Promise<void> {
    // If the vault being removed is current, tear down first so nothing
    // writes back into the DB we're about to delete.
    if (this.#current && this.#current.vaultId === id) {
      await this.closeCurrent();
    }
    // Close the worker-side engine (if it was ever opened) so its OPFS handle
    // releases before we deleteDatabase / remove the OPFS dir.
    await callWorker("closeVault", { vaultId: id }).catch(() => { /* best effort */ });
    const dbName = dbNameFor(id);
    const opfsDir = opfsDirFor(id);
    forgetDB(dbName);
    try {
      await indexedDB.deleteDatabase(dbName);
    } catch (err) { console.warn("[mux] deleteDatabase failed:", err); }
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(opfsDir, { recursive: true });
    } catch { /* dir may not exist */ }
    await removeVaultRecord(id);
    this.dispatchEvent(new Event("vaults:changed"));
    this.dispatchEvent(new Event("vaults:currentChanged"));
  }

  // ── Open / switch current vault ─────────────────────────────────────────

  /** Make `id` the current vault. Serializes with any in-flight switch so
   *  rapid-fire calls resolve in order. */
  async open(id: string): Promise<VaultService> {
    const task = async (): Promise<VaultService> => {
      if (this.#current && this.#current.vaultId === id) return this.#current;

      const record = await getVault(id);
      if (!record) throw new Error(`no such vault: ${id}`);

      // Tear down the previous vault first so listeners and timers go away
      // before the new service starts dispatching.
      if (this.#current) await this.closeCurrent();

      const config: VaultServiceConfig = {
        vaultId: record.id,
        dbName: dbNameFor(record.id),
        opfsDir: opfsDirFor(record.id),
        repoFullName: record.repoFullName,
        repoDefaultBranch: record.repoDefaultBranch,
      };

      // Prime the worker-side engine so its `sync`/`clone` ops can route.
      await callWorker("openVault", {
        vaultId: config.vaultId,
        dbName: config.dbName,
        opfsDir: config.opfsDir,
      });

      const service = new VaultService(config);
      this.attachForwarding(service);
      this.#current = service;
      setRouterCurrentVault(record.id);
      await service.init();

      await setCurrentVaultId(record.id);
      await touchVaultOpened(record.id);
      this.dispatchEvent(new Event("vaults:currentChanged"));
      return service;
    };

    const next = this.#switchLock.then(task, task);
    this.#switchLock = next.then(() => undefined, () => undefined);
    return next;
  }

  /** Close the currently-open vault without opening another. */
  async closeCurrent(): Promise<void> {
    const current = this.#current;
    if (!current) return;
    this.#current = null;
    setRouterCurrentVault(null);
    if (this.#forwardingCleanup) { this.#forwardingCleanup(); this.#forwardingCleanup = null; }
    current.dispose();
    await callWorker("closeVault", { vaultId: current.vaultId }).catch(() => { /* best effort */ });
  }

  /** Attempt to restore the last-used vault. Returns its id or null if none. */
  async openLastUsed(): Promise<string | null> {
    const currentId = await getCurrentVaultId();
    if (currentId) {
      try {
        await this.open(currentId);
        return currentId;
      } catch (err) {
        console.warn("[mux] last-used vault failed to open, clearing pointer:", err);
        await setCurrentVaultId(null);
      }
    }
    // Fallback: most-recently-opened from the manifest.
    const vaults = await listVaults();
    if (vaults.length === 0) return null;
    const fallback = vaults[0]!.id;
    await this.open(fallback);
    return fallback;
  }

  // ── Event forwarding ────────────────────────────────────────────────────

  private attachForwarding(service: VaultService): void {
    const handlers = FORWARDED_EVENTS.map((type) => {
      const fn = (e: Event) => {
        this.dispatchEvent(
          Object.assign(new Event(type), { detail: (e as CustomEvent).detail }),
        );
      };
      service.addEventListener(type, fn);
      return { type, fn };
    });
    this.#forwardingCleanup = () => {
      for (const { type, fn } of handlers) service.removeEventListener(type, fn);
    };
  }
}

/** Build the exported `vaultService` — a Proxy that quacks like a
 *  `VaultService` but routes everything through the multiplexer's current
 *  inner instance. EventTarget methods (addEventListener etc.) bind to the
 *  multiplexer directly so subscriptions survive vault switches.
 *  Multiplexer-only methods (open, addVault, listVaults, …) are also
 *  reachable on the same object. */
function buildFacade(mux: VaultMultiplexer): VaultService & VaultMultiplexer {
  const eventTargetMethods = new Set(["addEventListener", "removeEventListener", "dispatchEvent"]);
  const muxMethods = new Set([
    "listVaults", "addVault", "renameVault", "removeVault",
    "open", "closeCurrent", "openLastUsed",
    "currentVault", "currentVaultId",
  ]);
  return new Proxy(mux as unknown as VaultService & VaultMultiplexer, {
    get(_target, prop) {
      if (typeof prop !== "string") return Reflect.get(mux, prop);
      if (eventTargetMethods.has(prop) || muxMethods.has(prop)) {
        const v = (mux as unknown as Record<string, unknown>)[prop];
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(mux) : v;
      }
      const current = mux.currentVault;
      if (!current) {
        // Reading a property with no vault open returns undefined (matches
        // JS convention for null-ish access). Calling a method through the
        // resulting undefined will still throw "not a function", which
        // surfaces the issue at the call site.
        return undefined;
      }
      const v = (current as unknown as Record<string, unknown>)[prop];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(current) : v;
    },
  });
}

export const multiplexer = new VaultMultiplexer();
export const vaultService = buildFacade(multiplexer);
