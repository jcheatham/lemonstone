import { StorageAdapter } from "../storage/storage-adapter.ts";
import { identityCodec } from "../codec/index.ts";
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

export class VaultService extends EventTarget {
  private readonly storage = new StorageAdapter(identityCodec);
  private readonly syncClient = new SyncClient();

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
  private readonly search = new VaultSearch();

  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  // ── Initialization ─────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.rebuildIndexes();
    this.wireSyncEvents();
    this.wireNetworkEvents();

    this.dispatchEvent(new Event("vault:ready"));
  }

  private async rebuildIndexes(): Promise<void> {
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
        }
      } catch {
        // Corrupt snapshot — rebuild from scratch below.
      }
    }

    for (const record of notes) {
      const content = await this.storage.readNote(record.path);
      if (content !== null) {
        this.indexNote(record.path, content, record.frontmatter);
        this.noteUpdatedAt.set(record.path, record.updatedAt);
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
      const headOid = (e as CustomEvent).detail?.headOid as string | undefined;
      this.onSyncCompleted(headOid).catch(console.error);
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
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.syncClient.call("sync").catch(() => {/* best-effort */});
      }
    });

    // Resume sync when coming back online.
    window.addEventListener("online", () => {
      this.syncClient.call("sync").catch(console.error);
    });
  }

  private async onSyncCompleted(headOid?: string): Promise<void> {
    // Re-read any notes whose updatedAt changed since we last indexed them.
    const records = await this.storage.listNotes();
    for (const record of records) {
      const lastSeen = this.noteUpdatedAt.get(record.path) ?? 0;
      if (record.updatedAt > lastSeen) {
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

  static #kindFromPath(path: string): "note" | "canvas" | "unknown" {
    if (path.endsWith(".canvas")) return "canvas";
    if (path.endsWith(".md")) return "note";
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

export const vaultService = new VaultService();
