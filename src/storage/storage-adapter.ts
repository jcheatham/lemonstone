import { getDB } from "./db.ts";
import type {
  NoteRecord,
  CanvasRecord,
  AttachmentRecord,
  IndexesSnapshotRecord,
  ConfigRecord,
} from "./schema.ts";
import type { ContentCodec } from "../codec/index.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class StorageAdapter {
  constructor(private readonly codec: ContentCodec) {}

  // ── Notes ──────────────────────────────────────────────────────────────────

  async writeNote(
    path: string,
    plaintextContent: string,
    meta: Pick<NoteRecord, "frontmatter" | "syncState" | "baseSha">
  ): Promise<void> {
    const plainBytes = encoder.encode(plaintextContent);
    const encoded = await this.codec.encode(plainBytes, path);
    const db = await getDB();
    const record: NoteRecord = {
      path,
      content: encoded,
      size: plainBytes.byteLength,
      updatedAt: Date.now(),
      frontmatter: meta.frontmatter,
      syncState: meta.syncState,
      baseSha: meta.baseSha,
      codec: { scheme: this.codec.scheme, version: this.codec.version },
    };
    await db.put("notes", record);
  }

  async readNote(path: string): Promise<string | null> {
    const db = await getDB();
    const record = await db.get("notes", path);
    if (!record) return null;
    const decoded = await this.codec.decode(record.content, path);
    return decoder.decode(decoded);
  }

  async readNoteRecord(path: string): Promise<NoteRecord | null> {
    const db = await getDB();
    return (await db.get("notes", path)) ?? null;
  }

  async listNotes(): Promise<NoteRecord[]> {
    const db = await getDB();
    return db.getAll("notes");
  }

  async deleteNote(path: string): Promise<void> {
    const db = await getDB();
    await db.delete("notes", path);
  }

  // ── Canvas ─────────────────────────────────────────────────────────────────

  async writeCanvas(
    path: string,
    plaintextJson: string,
    meta: Pick<CanvasRecord, "syncState" | "baseSha">
  ): Promise<void> {
    const plainBytes = encoder.encode(plaintextJson);
    const encoded = await this.codec.encode(plainBytes, path);
    const db = await getDB();
    const record: CanvasRecord = {
      path,
      content: encoded,
      updatedAt: Date.now(),
      syncState: meta.syncState,
      baseSha: meta.baseSha,
      codec: { scheme: this.codec.scheme, version: this.codec.version },
    };
    await db.put("canvas", record);
  }

  async readCanvas(path: string): Promise<string | null> {
    const db = await getDB();
    const record = await db.get("canvas", path);
    if (!record) return null;
    const decoded = await this.codec.decode(record.content, path);
    return decoder.decode(decoded);
  }

  async listCanvas(): Promise<CanvasRecord[]> {
    const db = await getDB();
    return db.getAll("canvas");
  }

  async deleteCanvas(path: string): Promise<void> {
    const db = await getDB();
    await db.delete("canvas", path);
  }

  // ── Attachments ────────────────────────────────────────────────────────────

  async writeAttachment(
    path: string,
    plaintextBlob: Uint8Array,
    meta: Pick<AttachmentRecord, "syncState" | "baseSha">
  ): Promise<void> {
    const encoded = await this.codec.encode(plaintextBlob, path);
    const db = await getDB();
    const record: AttachmentRecord = {
      path,
      blob: encoded,
      size: plaintextBlob.byteLength,
      updatedAt: Date.now(),
      syncState: meta.syncState,
      baseSha: meta.baseSha,
      codec: { scheme: this.codec.scheme, version: this.codec.version },
    };
    await db.put("attachments", record);
  }

  async readAttachment(path: string): Promise<Uint8Array | null> {
    const db = await getDB();
    const record = await db.get("attachments", path);
    if (!record) return null;
    return this.codec.decode(record.blob, path);
  }

  async deleteAttachment(path: string): Promise<void> {
    const db = await getDB();
    await db.delete("attachments", path);
  }

  // ── Indexes snapshot ───────────────────────────────────────────────────────

  async writeIndexesSnapshot(
    plaintextData: Uint8Array,
    vaultHeadCommitSha: string
  ): Promise<void> {
    const encoded = await this.codec.encode(plaintextData, "indexes-snapshot");
    const db = await getDB();
    const record: IndexesSnapshotRecord = {
      key: "v1",
      data: encoded,
      snapshotAt: Date.now(),
      vaultHeadCommitSha,
      codec: { scheme: this.codec.scheme, version: this.codec.version },
    };
    await db.put("indexes-snapshot", record);
  }

  async readIndexesSnapshot(): Promise<{
    data: Uint8Array;
    meta: Omit<IndexesSnapshotRecord, "data">;
  } | null> {
    const db = await getDB();
    const record = await db.get("indexes-snapshot", "v1");
    if (!record) return null;
    const decoded = await this.codec.decode(record.data, "indexes-snapshot");
    return {
      data: decoded,
      meta: {
        key: record.key,
        snapshotAt: record.snapshotAt,
        vaultHeadCommitSha: record.vaultHeadCommitSha,
        codec: record.codec,
      },
    };
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  async getConfig<T>(key: string): Promise<T | null> {
    const db = await getDB();
    const record = await db.get("config", key);
    return record ? (record.value as T) : null;
  }

  async setConfig(key: string, value: unknown): Promise<void> {
    const db = await getDB();
    const record: ConfigRecord = { key, value };
    await db.put("config", record);
  }
}
