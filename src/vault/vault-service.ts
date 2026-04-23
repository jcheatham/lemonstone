import { StorageAdapter } from "../storage/storage-adapter.ts";
import {
  KEYS_JSON_PATH,
  parseKeysJson,
  serializeKeysJson,
  createZone,
  isKeysFile,
  type KeysFile,
  type Zone,
  ZoneService,
  layersForPath,
  isPathEncrypted as pathHasZone,
  validateNewZone,
  renameZonePrefix as renameZonesPrefix,
} from "../codec/index.ts";
import type { NoteRecord } from "../storage/schema.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { extractAllTags } from "./tags.ts";
import { WikilinkResolver } from "./wikilink-resolver.ts";
import { VaultSearch, type SearchResult } from "./search.ts";
import { SyncClient } from "../sync/sync-client.ts";

export type VaultEventType =
  | "note:changed"
  | "note:deleted"
  | "note:linkGraphChanged"
  | "note:tagIndexChanged"
  | "vault:ready"
  | "vault:synced"
  | "vault:syncError"
  | "vault:conflictDetected";

export interface TagInfo {
  tag: string;
  count: number;
}

export interface VaultServiceConfig {
  readonly vaultId: string;
  readonly dbName: string;
  readonly opfsDir: string;
  readonly repoFullName: string;
  readonly repoDefaultBranch: string;
}

export class VaultService extends EventTarget {
  private readonly zoneService: ZoneService;
  private readonly storage: StorageAdapter;
  private readonly syncClient: SyncClient;
  readonly config: VaultServiceConfig;

  constructor(config: VaultServiceConfig) {
    super();
    this.config = config;
    this.zoneService = new ZoneService();
    this.storage = new StorageAdapter(this.zoneService, config.dbName);
    this.syncClient = new SyncClient(config.vaultId);
  }

  get vaultId(): string { return this.config.vaultId; }
  get repoFullName(): string { return this.config.repoFullName; }

  // ── In-memory indexes (rebuilt on load, updated incrementally) ─────────────

  /** outgoing[path] = Set of link targets */
  private outgoing = new Map<string, Set<string>>();
  /** incoming[path] = Set of source paths (backlinks) */
  private incoming = new Map<string, Set<string>>();
  /** tagIndex[tag] = Set of note paths */
  private tagIndex = new Map<string, Set<string>>();
  /** tagsByNote[path] = current tags for that note */
  private tagsByNote = new Map<string, Set<string>>();
  /** updatedAt cache for change detection after sync */
  private noteUpdatedAt = new Map<string, number>();

  private readonly resolver = new WikilinkResolver();
  private search = new VaultSearch();

  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  // ── Initialization ─────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Load zone metadata (if any) so the storage adapter can dispatch reads
    // against the correct codec layers. Identities remain locked — they get
    // unwrapped lazily the first time a file in that zone is touched.
    try {
      await this.loadZones();
    } catch (err) {
      console.warn("[vault] loadZones failed (will proceed with no zones):", err);
    }
    await this.rebuildIndexes();
    this.wireSyncEvents();
    this.wireNetworkEvents();

    this.dispatchEvent(new Event("vault:ready"));
  }

  async rebuildIndexes(): Promise<void> {
    // Clear before rebuilding — supports being called mid-lifecycle after a
    // codec swap (unlock/enable-encryption/lock), not just at first init.
    this.incoming.clear();
    this.outgoing.clear();
    this.tagIndex.clear();
    this.noteUpdatedAt.clear();

    // Try restoring the search snapshot first (startup-latency optimization).
    const snapshot = await this.storage.readIndexesSnapshot();

    const notes = await this.storage.listNotes();

    if (snapshot) {
      try {
        const json = new TextDecoder().decode(snapshot.data);
        const restoredSearch = VaultSearch.deserialize(json);
        // Only use snapshot if note count matches — otherwise full rebuild.
        if (restoredSearch.documentCount === notes.length) {
          Object.assign(this, { search: restoredSearch });
        } else {
          this.search = new VaultSearch();
        }
      } catch {
        this.search = new VaultSearch();
      }
    } else {
      this.search = new VaultSearch();
    }

    for (const record of notes) {
      try {
        const content = await this.storage.readNote(record.path);
        if (content !== null) {
          this.indexNote(record.path, content, record.frontmatter);
          this.noteUpdatedAt.set(record.path, record.updatedAt);
        }
      } catch (err) {
        // Notes in a locked zone can't be indexed until the zone is unlocked;
        // that's expected and not worth logging.
        if ((err as Error)?.name !== "ZoneLockedError") {
          console.warn("[vault] rebuildIndexes: failed to decode", record.path, err);
        }
      }
    }
  }

  private indexNote(
    path: string,
    content: string,
    storedFrontmatter: Record<string, unknown>
  ): void {
    const { frontmatter, body } = parseFrontmatter(content);
    const merged = { ...storedFrontmatter, ...frontmatter };

    this.updateLinkGraph(path, content);
    this.updateTagIndex(path, body, merged);
    this.search.add(path, content);
    this.resolver.addPath(path);
  }

  // ── Sync wiring ─────────────────────────────────────────────────────────────

  private wireSyncEvents(): void {
    this.syncClient.addEventListener("syncCompleted", (e) => {
      const detail = (e as CustomEvent).detail as { headOid?: string; error?: string; dropped?: string[]; message?: string; conflicts?: number } | undefined;
      if (detail?.error === "unsafe_push") {
        // Sync engine refused to push because the merge result was missing
        // files that still exist on remote. Bubble up so the UI can warn.
        this.dispatchEvent(
          Object.assign(new Event("vault:syncError"), {
            detail: { reason: "unsafe_push", dropped: detail.dropped ?? [] },
          })
        );
        return;
      }
      if (detail?.error === "failed") {
        // Engine threw. Surface as a sync error so busy UI clears, but don't
        // pollute lastSyncAt — this wasn't a successful round-trip.
        this.dispatchEvent(
          Object.assign(new Event("vault:syncError"), {
            detail: { reason: "failed", message: detail.message ?? "Sync failed" },
          })
        );
        return;
      }
      this.onSyncCompleted(detail?.headOid).catch(console.error);
    });

    this.syncClient.addEventListener("conflictDetected", (e) => {
      const path = (e as CustomEvent).detail?.path as string | undefined;
      this.dispatchEvent(
        Object.assign(new Event("vault:conflictDetected"), { detail: { path } })
      );
    });

    this.syncClient.addEventListener("authRequired", () => {
      this.dispatchEvent(new Event("vault:syncError"));
    });
  }

  private wireNetworkEvents(): void {
    // Force-sync when the page goes into background (§5.4 "force sync before closing").
    // Also sync when we come BACK to visible, so a tab/window/PWA that was
    // dormant catches up with changes made elsewhere. Coalesced via the
    // in-worker `syncing` mutex — no harm if several fire close together.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.syncClient.call("sync").catch(() => {/* best-effort */});
      } else if (document.visibilityState === "visible") {
        this.#wakeSync("visibility");
      }
    });

    // Tab/window focus — a weaker signal than visibilitychange (fires more
    // often), but catches cases where visibility didn't change (e.g. focus
    // stolen and returned within the same tab).
    window.addEventListener("focus", () => this.#wakeSync("focus"));

    // Resume sync when coming back online.
    window.addEventListener("online", () => this.#wakeSync("online"));

    // pageshow fires after bfcache restoration on mobile Safari; worth
    // triggering a sync since the tab may have been frozen for hours.
    window.addEventListener("pageshow", (e) => {
      if ((e as PageTransitionEvent).persisted) this.#wakeSync("pageshow");
    });
  }

  /** Wake-up sync. Emits `vault:wakeSync` so the UI can surface a brief
   *  "checking for updates" indicator, then kicks a sync. If it's been only
   *  a few seconds since the last successful sync we skip to avoid chatter
   *  on every focus/visibility jitter — local edits still trigger their
   *  own debounced syncs through the normal write path. */
  #wakeSync(source: string): void {
    const since = this.#lastSyncAt ? Date.now() - this.#lastSyncAt : Number.POSITIVE_INFINITY;
    if (since < 10_000) return; // coalesce bursts within 10s of a successful sync
    this.dispatchEvent(
      Object.assign(new Event("vault:wakeSync"), { detail: { source, msSinceLastSync: since } }),
    );
    this.syncClient.call("sync").catch((err) => {
      console.warn(`[vault] wake-sync (${source}) failed:`, err);
    });
  }

  // Timestamp of the last sync that returned a non-empty head OID. Null until
  // the first successful sync completes in this session.
  #lastSyncAt: number | null = null;

  get lastSyncAt(): number | null { return this.#lastSyncAt; }

  private async onSyncCompleted(headOid?: string): Promise<void> {
    // Record "last synced" even when headOid is empty. An empty head usually
    // means the clone/sync hit an empty remote (no commits yet) or an
    // idempotent no-op; either way the worker did reach GitHub, so from the
    // user's perspective the vault is in sync with remote.
    this.#lastSyncAt = Date.now();

    // Re-pull zones from keys.json: a remote commit may have created or
    // removed a zone, or this may be the first sync after sign-in on a
    // fresh device (in which case keys.json only just landed in OPFS).
    // ReadNote inside the index rebuild needs the zone list to be correct;
    // badges in the UI need it too.
    await this.loadZones().catch((err) =>
      console.warn("[vault] loadZones after sync failed:", err),
    );

    // Re-read any notes whose updatedAt changed since we last indexed them.
    // `readNote` on a record inside a locked zone throws ZoneLockedError —
    // that's expected in a mixed-codec vault and must not abort the rest of
    // the post-sync flow, or the UI will never see `vault:synced`.
    const records = await this.storage.listNotes();
    for (const record of records) {
      const lastSeen = this.noteUpdatedAt.get(record.path) ?? 0;
      if (record.updatedAt <= lastSeen) continue;
      try {
        const content = await this.storage.readNote(record.path);
        if (content !== null) {
          this.indexNote(record.path, content, record.frontmatter);
          this.noteUpdatedAt.set(record.path, record.updatedAt);
          this.dispatchEvent(
            Object.assign(new Event("note:changed"), {
              detail: { path: record.path, source: "sync" },
            })
          );
        }
      } catch (err) {
        if ((err as Error)?.name !== "ZoneLockedError") {
          console.warn("[vault] onSyncCompleted: readNote failed for", record.path, err);
        }
      }
    }
    this.scheduleSnapshotOnIdle();
    this.dispatchEvent(
      Object.assign(new Event("vault:synced"), { detail: { headOid } })
    );
  }

  // ── Note API ────────────────────────────────────────────────────────────────

  async readNote(path: string): Promise<string | null> {
    return this.storage.readNote(path);
  }

  async writeNote(
    path: string,
    content: string,
    frontmatter: Record<string, unknown> = {}
  ): Promise<void> {
    const { frontmatter: parsed } = parseFrontmatter(content);
    const merged = { ...frontmatter, ...parsed };

    await this.storage.writeNote(path, content, {
      frontmatter: merged,
      syncState: "dirty",
      baseSha: "",
    });

    this.indexNote(path, content, merged);
    this.noteUpdatedAt.set(path, Date.now());

    this.dispatchEvent(
      Object.assign(new Event("note:changed"), { detail: { path } })
    );
    this.scheduleSnapshotOnIdle();
    this.enqueueSyncTick();
  }

  async deleteNote(path: string): Promise<void> {
    await this.storage.deleteNote(path);
    await this.markTombstone(path);
    this.clearLinkGraph(path);
    this.clearTagIndex(path);
    this.search.remove(path);
    this.resolver.removePath(path);
    this.noteUpdatedAt.delete(path);

    this.dispatchEvent(
      Object.assign(new Event("note:deleted"), { detail: { path } })
    );
    this.enqueueSyncTick();
  }

  async listNotes(): Promise<NoteRecord[]> {
    return this.storage.listNotes();
  }

  async listCanvases(): Promise<{ path: string }[]> {
    const records = await this.storage.listCanvas();
    return records.map((r) => ({ path: r.path }));
  }

  // ── Type-agnostic dispatchers ────────────────────────────────────────────
  // Callers that don't need to know whether something is a note, a canvas,
  // or a future resource type should prefer these. Adding a new kind of file
  // means wiring it into the switch in one place, not across every UI call site.

  /** Extensions that are treated as notes (stored in the notes store, opened
   *  in the markdown/text editor). Mirror of sync-engine's TEXT_EXTENSIONS. */
  static readonly #NOTE_EXTENSIONS = new Set([".md", ".txt"]);

  static #kindFromPath(path: string): "note" | "canvas" | "unknown" {
    if (path.endsWith(".canvas")) return "canvas";
    const dot = path.lastIndexOf(".");
    if (dot >= 0 && VaultService.#NOTE_EXTENSIONS.has(path.slice(dot).toLowerCase())) return "note";
    return "unknown";
  }

  async list(): Promise<{ path: string; kind: "note" | "canvas" }[]> {
    const [notes, canvases] = await Promise.all([this.listNotes(), this.listCanvases()]);
    return [
      ...notes.map((n) => ({ path: n.path, kind: "note" as const })),
      ...canvases.map((c) => ({ path: c.path, kind: "canvas" as const })),
    ];
  }

  async delete(path: string): Promise<void> {
    switch (VaultService.#kindFromPath(path)) {
      case "note": return this.deleteNote(path);
      case "canvas": return this.deleteCanvas(path);
      default: throw new Error(`Don't know how to delete: ${path}`);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const fromKind = VaultService.#kindFromPath(oldPath);
    const toKind = VaultService.#kindFromPath(newPath);
    if (fromKind !== toKind) {
      throw new Error(`Cannot rename across file kinds: ${oldPath} → ${newPath}`);
    }
    switch (fromKind) {
      case "note": return this.renameNote(oldPath, newPath);
      case "canvas": return this.renameCanvas(oldPath, newPath);
      default: throw new Error(`Don't know how to rename: ${oldPath}`);
    }
  }

  /**
   * Rename a note and rewrite all wikilinks pointing at it.
   * Produces a single dirty write per affected note.
   */
  async renameNote(oldPath: string, newPath: string): Promise<void> {
    const content = await this.storage.readNote(oldPath);
    if (content === null) throw new Error(`Note not found: ${oldPath}`);

    // Write under new path, delete old.
    await this.writeNote(newPath, content);
    await this.deleteNote(oldPath);

    // Rewrite backlinks in all referencing notes.
    const sources = Array.from(this.incoming.get(oldPath) ?? []);
    const oldBasename = basenameNoExt(oldPath);
    const newBasename = basenameNoExt(newPath);

    for (const srcPath of sources) {
      const src = await this.storage.readNote(srcPath);
      if (!src) continue;
      // Replace [[OldName]] and [[OldName|alias]] with [[NewName]] / [[NewName|alias]]
      const rewritten = src.replace(
        new RegExp(`\\[\\[${escapeRegex(oldBasename)}(\\|[^\\]]+)?\\]\\]`, "g"),
        `[[${newBasename}$1]]`
      );
      if (rewritten !== src) {
        await this.writeNote(srcPath, rewritten);
      }
    }
  }

  // ── Canvas API ──────────────────────────────────────────────────────────────

  async readCanvas(path: string): Promise<string | null> {
    return this.storage.readCanvas(path);
  }

  async readCanvasRecord(path: string): ReturnType<StorageAdapter["readCanvasRecord"]> {
    return this.storage.readCanvasRecord(path);
  }

  async clearCanvasConflict(path: string): Promise<void> {
    await this.storage.clearCanvasConflict(path);
  }

  async writeCanvas(path: string, content: string): Promise<void> {
    await this.storage.writeCanvas(path, content, {
      syncState: "dirty",
      baseSha: "",
    });
    this.dispatchEvent(
      Object.assign(new Event("note:changed"), { detail: { path } })
    );
    this.enqueueSyncTick();
  }

  async deleteCanvas(path: string): Promise<void> {
    await this.storage.deleteCanvas(path);
    await this.markTombstone(path);
    this.dispatchEvent(
      Object.assign(new Event("note:deleted"), { detail: { path } })
    );
    this.enqueueSyncTick();
  }

  private async markTombstone(path: string): Promise<void> {
    await this.storage.writeTombstone(path);
  }

  async renameCanvas(oldPath: string, newPath: string): Promise<void> {
    const content = await this.storage.readCanvas(oldPath);
    if (content === null) throw new Error(`Canvas not found: ${oldPath}`);
    await this.writeCanvas(newPath, content);
    await this.deleteCanvas(oldPath);
  }

  // ── Force pull / push (discards local or remote state — destructive) ───

  async forcePull(): Promise<void> {
    await this.syncClient.call("forcePull");
  }

  async forcePush(): Promise<void> {
    await this.syncClient.call("forcePush");
  }

  // ── Repo-level aux files (keys.json, etc.) ──────────────────────────────

  async readRepoFile(path: string): Promise<Uint8Array | null> {
    const res = await this.syncClient.call("readRepoFile", { path });
    return (res.result as { bytes: Uint8Array | null }).bytes;
  }

  /** Current HEAD OID, or "" if unknown / repo not initialized. */
  async getHead(): Promise<string> {
    const res = await this.syncClient.call("getHead");
    return (res.result as { head: string }).head;
  }

  async writeRepoFile(path: string, bytes: Uint8Array): Promise<void> {
    await this.syncClient.call("writeRepoFile", { path, bytes });
  }

  // ── Encryption zones ─────────────────────────────────────────────────────

  /** Load the zone list from `.lemonstone/keys.json` (if present) into the
   *  zone service. Identities stay locked; the user unlocks each as needed.
   *  Fires `vault:zonesReloaded` so UI layers (badges, zone lists) refresh. */
  async loadZones(): Promise<void> {
    const bytes = await this.readRepoFile(KEYS_JSON_PATH);
    if (!bytes) {
      this.zoneService.setZones([]);
    } else {
      try {
        const file = parseKeysJson(bytes);
        this.zoneService.setZones(file.zones);
      } catch (err) {
        console.warn("[vault] keys.json failed to parse; treating vault as plaintext:", err);
        this.zoneService.setZones([]);
      }
    }
    this.dispatchEvent(new Event("vault:zonesReloaded"));
  }

  listZones(): Zone[] {
    return this.zoneService.listZones();
  }

  applicableZones(path: string): Zone[] {
    return this.zoneService.applicableZones(path);
  }

  isPathEncrypted(path: string): boolean {
    return pathHasZone(path, this.zoneService.listZones());
  }

  isZoneUnlocked(zoneId: string): boolean {
    return this.zoneService.isUnlocked(zoneId);
  }

  /** Unlock a zone by its id. Throws on wrong passphrase.
   *  On success, re-indexes every note under that zone's prefix so newly
   *  readable content shows up in search / backlinks / tags. */
  async unlockZone(zoneId: string, passphrase: string): Promise<void> {
    await this.zoneService.unlockZone(zoneId, passphrase);
    const zone = this.zoneService.getZone(zoneId);
    if (zone) {
      const notes = await this.storage.listNotes();
      for (const record of notes) {
        if (!record.path.startsWith(zone.prefix)) continue;
        try {
          const content = await this.storage.readNote(record.path);
          if (content !== null) {
            this.indexNote(record.path, content, record.frontmatter);
            this.noteUpdatedAt.set(record.path, record.updatedAt);
          }
        } catch (err) {
          // Still-locked deeper zone, or transient decode failure.
          if ((err as Error)?.name !== "ZoneLockedError") {
            console.warn("[vault] unlockZone: decode failed for", record.path, err);
          }
        }
      }
    }
    this.dispatchEvent(Object.assign(new Event("vault:zoneUnlocked"), { detail: { zoneId } }));
  }

  lockZone(zoneId: string): void {
    this.zoneService.lockZone(zoneId);
    this.dispatchEvent(Object.assign(new Event("vault:zoneLocked"), { detail: { zoneId } }));
  }

  /** Clear all in-memory identities (e.g. on sign-out). */
  lockAll(): void {
    this.zoneService.lockAll();
    this.dispatchEvent(new Event("vault:allZonesLocked"));
  }

  /** Create a new encrypted zone anchored at `prefix` with the given passphrase.
   *  Existing records under the prefix are wrapped with the new outer layer.
   *  Because wrapping doesn't require decrypting existing layers, creating a
   *  zone that is nested inside another zone (or contains other zones) works
   *  without needing those other zones to be unlocked. */
  async createZone(args: {
    prefix: string;
    passphrase: string;
    algorithm?: "age-v1";
  }): Promise<Zone> {
    const zones = this.zoneService.listZones();
    // Normalizes internally; throws on duplicate.
    const { zone, identity } = await createZone(
      args.prefix,
      args.passphrase,
      args.algorithm ?? "age-v1",
    );
    validateNewZone(zone.prefix, zones);

    const nextZones = [...zones, zone];
    this.zoneService.setZones(nextZones);
    this.zoneService.registerIdentity(zone.id, identity);

    // Wrap every existing record under this prefix with the new outer layer.
    await this.storage.reencodeUnderPrefix(zone.prefix, (currentLayers) => [
      zone.id,
      ...currentLayers,
    ]);

    await this.persistKeysFile({ version: 1, zones: nextZones });
    await this.rebuildIndexes();
    this.enqueueSyncTick();
    this.dispatchEvent(Object.assign(new Event("vault:zoneCreated"), { detail: { zoneId: zone.id } }));
    return zone;
  }

  /** Remove a zone: peel its layer off every record under its prefix, then
   *  drop it from keys.json. The zone must be unlocked. */
  async removeZone(zoneId: string): Promise<void> {
    const zone = this.zoneService.getZone(zoneId);
    if (!zone) throw new Error(`no such zone: ${zoneId}`);
    if (!this.zoneService.isUnlocked(zoneId)) {
      throw new Error(`zone ${zone.prefix} must be unlocked before removal`);
    }

    await this.storage.reencodeUnderPrefix(zone.prefix, (currentLayers) =>
      currentLayers.filter((id) => id !== zoneId),
    );

    const nextZones = this.zoneService.listZones().filter((z) => z.id !== zoneId);
    this.zoneService.setZones(nextZones);
    await this.persistKeysFile({ version: 1, zones: nextZones });
    await this.rebuildIndexes();
    this.enqueueSyncTick();
    this.dispatchEvent(Object.assign(new Event("vault:zoneRemoved"), { detail: { zoneId } }));
  }

  /** Rename a zone's prefix. Metadata-only — records reference zones by id. */
  async renameZonePrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    const nextZones = renameZonesPrefix(this.zoneService.listZones(), oldPrefix, newPrefix);
    this.zoneService.setZones(nextZones);
    await this.persistKeysFile({ version: 1, zones: nextZones });
    this.enqueueSyncTick();
  }

  /** For the UI: does renaming `oldPath` to `newPath` cross an encryption boundary? */
  planRename(oldPath: string, newPath: string): {
    crosses: boolean;
    oldLayers: string[];
    newLayers: string[];
    zonesToUnlock: string[];
  } {
    const zones = this.zoneService.listZones();
    const oldLayers = layersForPath(oldPath, zones);
    const newLayers = layersForPath(newPath, zones);
    const crosses =
      oldLayers.length !== newLayers.length ||
      oldLayers.some((id, i) => id !== newLayers[i]);
    // To re-encode we need every zone whose layer we're stripping off the old
    // path; adding layers doesn't require any unlock.
    const stripping = oldLayers.filter((id) => !newLayers.includes(id));
    const zonesToUnlock = stripping.filter((id) => !this.zoneService.isUnlocked(id));
    return { crosses, oldLayers, newLayers, zonesToUnlock };
  }

  /** Internal: write keys.json + stage it via the sync worker. */
  private async persistKeysFile(file: KeysFile): Promise<void> {
    if (!isKeysFile(file)) {
      throw new Error("persistKeysFile: refusing to write malformed keys.json");
    }
    await this.writeRepoFile(KEYS_JSON_PATH, serializeKeysJson(file));
  }

  async recentCommits(limit = 30): Promise<Array<{ oid: string; message: string; author: string; date: number }>> {
    const res = await this.syncClient.call("recentCommits", { limit });
    return (res.result as { commits: Array<{ oid: string; message: string; author: string; date: number }> }).commits;
  }

  async commitDetails(oid: string): Promise<{
    oid: string;
    message: string;
    author: string;
    date: number;
    changes: Array<{ path: string; status: "A" | "M" | "D" }>;
  } | null> {
    const res = await this.syncClient.call("commitDetails", { oid });
    return (res.result as { details: unknown }).details as ReturnType<typeof this.commitDetails> extends Promise<infer T> ? T : never;
  }

  async restoreToCommit(oid: string): Promise<void> {
    await this.syncClient.call("restoreToCommit", { oid });
    // After the worker commits locally, kick off a sync so it pushes.
    await this.syncClient.call("sync").catch(console.error);
  }

  // ── Attachment API ──────────────────────────────────────────────────────────

  async readAttachment(path: string): Promise<Uint8Array | null> {
    return this.storage.readAttachment(path);
  }

  async writeAttachment(path: string, data: Uint8Array): Promise<void> {
    await this.storage.writeAttachment(path, data, {
      syncState: "dirty",
      baseSha: "",
    });
    this.enqueueSyncTick();
  }

  // ── Link graph API ──────────────────────────────────────────────────────────

  getBacklinks(path: string): string[] {
    return Array.from(this.incoming.get(path) ?? []);
  }

  getOutlinks(path: string): string[] {
    return Array.from(this.outgoing.get(path) ?? []);
  }

  resolveWikilink(linkText: string, fromPath?: string): string | null {
    return this.resolver.resolve(linkText, fromPath);
  }

  // ── Tag API ─────────────────────────────────────────────────────────────────

  listTags(): TagInfo[] {
    return Array.from(this.tagIndex.entries())
      .map(([tag, paths]) => ({ tag, count: paths.size }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  getTagNotes(tag: string): string[] {
    return Array.from(this.tagIndex.get(tag.toLowerCase()) ?? []);
  }

  // ── Search API ──────────────────────────────────────────────────────────────

  searchFullText(query: string, opts?: { fields?: string[] }): SearchResult[] {
    return this.search.search(query, opts);
  }

  async searchRegex(pattern: RegExp): Promise<string[]> {
    return this.search.searchRegex(pattern, (p) => this.storage.readNote(p));
  }

  // ── Private: link graph ─────────────────────────────────────────────────────

  private updateLinkGraph(path: string, content: string): void {
    const links = extractWikilinks(content);
    const old = this.outgoing.get(path) ?? new Set<string>();

    for (const target of old) {
      this.incoming.get(target)?.delete(path);
    }

    const newSet = new Set(links);
    this.outgoing.set(path, newSet);
    for (const target of newSet) {
      if (!this.incoming.has(target)) this.incoming.set(target, new Set());
      this.incoming.get(target)!.add(path);
    }

    this.dispatchEvent(
      Object.assign(new Event("note:linkGraphChanged"), { detail: { path } })
    );
  }

  private clearLinkGraph(path: string): void {
    for (const target of this.outgoing.get(path) ?? []) {
      this.incoming.get(target)?.delete(path);
    }
    this.outgoing.delete(path);
    this.dispatchEvent(
      Object.assign(new Event("note:linkGraphChanged"), { detail: { path } })
    );
  }

  // ── Private: tag index ──────────────────────────────────────────────────────

  private updateTagIndex(
    path: string,
    body: string,
    frontmatter: Record<string, unknown>
  ): void {
    // Remove old tags for this note.
    this.clearTagIndex(path);

    const tags = extractAllTags(body, frontmatter);
    const noteTagSet = new Set<string>(tags);
    this.tagsByNote.set(path, noteTagSet);

    for (const tag of tags) {
      if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
      this.tagIndex.get(tag)!.add(path);
    }

    this.dispatchEvent(
      Object.assign(new Event("note:tagIndexChanged"), { detail: { path } })
    );
  }

  private clearTagIndex(path: string): void {
    for (const tag of this.tagsByNote.get(path) ?? []) {
      this.tagIndex.get(tag)?.delete(path);
      if (this.tagIndex.get(tag)?.size === 0) this.tagIndex.delete(tag);
    }
    this.tagsByNote.delete(path);
  }

  // ── Private: snapshot ───────────────────────────────────────────────────────

  private scheduleSnapshotOnIdle(): void {
    if (this.snapshotTimer) return;
    const delay = typeof requestIdleCallback === "function" ? 0 : 10_000;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      this.saveSnapshot().catch(console.error);
    }, delay);
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => {
        if (this.snapshotTimer) {
          clearTimeout(this.snapshotTimer);
          this.snapshotTimer = null;
        }
        this.saveSnapshot().catch(console.error);
      });
    }
  }

  private async saveSnapshot(): Promise<void> {
    const json = this.search.serialize();
    const bytes = new TextEncoder().encode(json);
    await this.storage.writeIndexesSnapshot(bytes, "");
  }

  // ── Sync API ────────────────────────────────────────────────────────────────

  async clone(): Promise<void> {
    await this.syncClient.call("clone");
  }

  async sync(): Promise<void> {
    await this.syncClient.call("sync");
  }

  async resolveConflict(path: string): Promise<void> {
    await this.syncClient.call("resolveConflict", { path });
  }

  // ── Private: sync ───────────────────────────────────────────────────────────

  private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  private enqueueSyncTick(): void {
    if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
    this.syncDebounceTimer = setTimeout(() => {
      this.syncDebounceTimer = null;
      this.syncClient.call("sync").catch(console.error);
    }, 2000);
  }

  /** Free per-vault resources: in-memory indexes, timers, sync-client
   *  event subscriptions. Called by the multiplexer when the user switches
   *  to a different vault or removes this one. */
  dispose(): void {
    if (this.snapshotTimer) { clearTimeout(this.snapshotTimer); this.snapshotTimer = null; }
    if (this.syncDebounceTimer) { clearTimeout(this.syncDebounceTimer); this.syncDebounceTimer = null; }
    this.outgoing.clear();
    this.incoming.clear();
    this.tagIndex.clear();
    this.tagsByNote.clear();
    this.noteUpdatedAt.clear();
    this.zoneService.lockAll();
    this.syncClient.dispose();
  }
}

// ── Module-level helpers ────────────────────────────────────────────────────

function extractWikilinks(content: string): string[] {
  const pattern = /\[\[([^\]|#\n]+)(?:[|#][^\]]+)?\]\]/g;
  const links: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    if (m[1]) links.push(m[1].trim());
  }
  return links;
}

function basenameNoExt(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Module singleton removed — see src/vault/multiplexer.ts for the
// exported facade. Instantiate VaultService directly via the multiplexer.
