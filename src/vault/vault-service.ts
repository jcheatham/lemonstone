import { StorageAdapter } from "../storage/storage-adapter.ts";
import { identityCodec } from "../codec/index.ts";
import type { NoteRecord } from "../storage/schema.ts";

export type VaultEventType =
  | "note:changed"
  | "note:deleted"
  | "note:linkGraphChanged"
  | "vault:synced"
  | "vault:syncError"
  | "vault:conflictDetected";

export class VaultService extends EventTarget {
  private readonly storage = new StorageAdapter(identityCodec);

  // In-memory link graph; rebuilt from working copy on load.
  private outgoing = new Map<string, Set<string>>();
  private incoming = new Map<string, Set<string>>();

  // ── Note API ───────────────────────────────────────────────────────────────

  async readNote(path: string): Promise<string | null> {
    return this.storage.readNote(path);
  }

  async writeNote(
    path: string,
    content: string,
    frontmatter: Record<string, unknown> = {}
  ): Promise<void> {
    await this.storage.writeNote(path, content, {
      frontmatter,
      syncState: "dirty",
      baseSha: "",
    });
    this.updateLinkGraph(path, content);
    this.dispatchEvent(
      Object.assign(new Event("note:changed"), { detail: { path } })
    );
    this.enqueueSyncTick();
  }

  async deleteNote(path: string): Promise<void> {
    await this.storage.deleteNote(path);
    this.clearLinkGraph(path);
    this.dispatchEvent(
      Object.assign(new Event("note:deleted"), { detail: { path } })
    );
  }

  async listNotes(): Promise<NoteRecord[]> {
    return this.storage.listNotes();
  }

  // ── Link graph ─────────────────────────────────────────────────────────────

  getBacklinks(path: string): string[] {
    return Array.from(this.incoming.get(path) ?? []);
  }

  getOutlinks(path: string): string[] {
    return Array.from(this.outgoing.get(path) ?? []);
  }

  private updateLinkGraph(path: string, content: string): void {
    const links = extractWikilinks(content);
    const old = this.outgoing.get(path) ?? new Set<string>();

    // Remove stale incoming links
    for (const target of old) {
      this.incoming.get(target)?.delete(path);
    }

    // Add fresh outgoing links
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
    const old = this.outgoing.get(path) ?? new Set<string>();
    for (const target of old) {
      this.incoming.get(target)?.delete(path);
    }
    this.outgoing.delete(path);
    this.dispatchEvent(
      Object.assign(new Event("note:linkGraphChanged"), { detail: { path } })
    );
  }

  // ── Sync ───────────────────────────────────────────────────────────────────

  private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  private enqueueSyncTick(): void {
    if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
    this.syncDebounceTimer = setTimeout(() => {
      this.syncDebounceTimer = null;
      this.triggerSync();
    }, 2000);
  }

  private triggerSync(): void {
    // Sync Engine (Web Worker) will be wired here in M3.
    // For now, a no-op placeholder.
  }
}

function extractWikilinks(content: string): string[] {
  const pattern = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (match[1]) links.push(match[1].trim());
  }
  return links;
}

export const vaultService = new VaultService();
