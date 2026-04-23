import { getDB } from "./db.ts";
import type {
  NoteRecord,
  CanvasRecord,
  AttachmentRecord,
  IndexesSnapshotRecord,
  ConfigRecord,
  Tombstone,
} from "./schema.ts";
import type { CodecDescriptor, ZoneService } from "../codec/index.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Default codec descriptor for a freshly-ingested plaintext file. */
function identityDescriptor(): CodecDescriptor {
  return { scheme: "identity", version: 1 };
}

/** Descriptor for a file encrypted under the given zone layers (outermost first). */
function ageDescriptor(layers: readonly string[]): CodecDescriptor {
  return { scheme: "age", version: 1, layers: [...layers] };
}

export class StorageAdapter {
  constructor(private readonly zoneService: ZoneService) {}

  // ── Codec pipeline ────────────────────────────────────────────────────────

  /** Apply the layers implied by the path's applicable zones, outermost-last.
   *  Returns both the encoded bytes and the descriptor that records which layers
   *  were applied. Throws ZoneLockedError if any needed zone is locked.
   */
  private async encodeForPath(
    plaintext: Uint8Array,
    path: string,
  ): Promise<{ bytes: Uint8Array; codec: CodecDescriptor }> {
    const zones = this.zoneService.applicableZones(path);
    if (zones.length === 0) {
      return { bytes: plaintext, codec: identityDescriptor() };
    }
    let bytes = plaintext;
    for (const z of zones) {
      // Shortest-first = outermost first; encrypt outer, then inner wraps it.
      const codec = this.zoneService.getCodec(z.id);
      bytes = await codec.encode(bytes, path);
    }
    const layers = zones.map((z) => z.id).reverse(); // decryption order
    return { bytes, codec: ageDescriptor(layers) };
  }

  /** Decode a record's bytes using the layers recorded on the record.
   *  Throws ZoneLockedError if any required zone is locked.
   */
  private async decode(
    bytes: Uint8Array,
    path: string,
    codec: CodecDescriptor,
  ): Promise<Uint8Array> {
    if (codec.scheme === "identity") return bytes;
    let out = bytes;
    for (const zoneId of codec.layers) {
      const ageCodec = this.zoneService.getCodec(zoneId);
      out = await ageCodec.decode(out, path);
    }
    return out;
  }

  // ── Notes ──────────────────────────────────────────────────────────────────

  async writeNote(
    path: string,
    plaintextContent: string,
    meta: Pick<NoteRecord, "frontmatter" | "syncState" | "baseSha">
  ): Promise<void> {
    const plainBytes = encoder.encode(plaintextContent);
    const { bytes, codec } = await this.encodeForPath(plainBytes, path);
    const db = await getDB();
    const record: NoteRecord = {
      path,
      content: bytes,
      size: plainBytes.byteLength,
      updatedAt: Date.now(),
      frontmatter: meta.frontmatter,
      syncState: meta.syncState,
      baseSha: meta.baseSha,
      codec,
    };
    await db.put("notes", record);
  }

  async readNote(path: string): Promise<string | null> {
    const db = await getDB();
    const record = await db.get("notes", path);
    if (!record) return null;
    const decoded = await this.decode(record.content, path, record.codec);
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
    const { bytes, codec } = await this.encodeForPath(plainBytes, path);
    const db = await getDB();
    const record: CanvasRecord = {
      path,
      content: bytes,
      updatedAt: Date.now(),
      syncState: meta.syncState,
      baseSha: meta.baseSha,
      codec,
    };
    await db.put("canvas", record);
  }

  async readCanvas(path: string): Promise<string | null> {
    const db = await getDB();
    const record = await db.get("canvas", path);
    if (!record) return null;
    const decoded = await this.decode(record.content, path, record.codec);
    return decoder.decode(decoded);
  }

  async readCanvasRecord(path: string): Promise<CanvasRecord | null> {
    const db = await getDB();
    return (await db.get("canvas", path)) ?? null;
  }

  async clearCanvasConflict(path: string): Promise<void> {
    const db = await getDB();
    const record = await db.get("canvas", path);
    if (!record) return;
    const { conflict: _conflict, ...rest } = record;
    void _conflict;
    await db.put("canvas", { ...rest, syncState: "clean" });
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
    const { bytes, codec } = await this.encodeForPath(plaintextBlob, path);
    const db = await getDB();
    const record: AttachmentRecord = {
      path,
      blob: bytes,
      size: plaintextBlob.byteLength,
      updatedAt: Date.now(),
      syncState: meta.syncState,
      baseSha: meta.baseSha,
      codec,
    };
    await db.put("attachments", record);
  }

  async readAttachment(path: string): Promise<Uint8Array | null> {
    const db = await getDB();
    const record = await db.get("attachments", path);
    if (!record) return null;
    return this.decode(record.blob, path, record.codec);
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
    // Snapshot path is a synthetic sentinel; no zones apply, so it's always plaintext.
    // (If index-at-rest encryption is added later, route through encodeForPath.)
    const db = await getDB();
    const record: IndexesSnapshotRecord = {
      key: "v1",
      data: plaintextData,
      snapshotAt: Date.now(),
      vaultHeadCommitSha,
      codec: identityDescriptor(),
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
    return {
      data: record.data,
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

  // ── Tombstones ─────────────────────────────────────────────────────────────

  async writeTombstone(path: string): Promise<void> {
    const db = await getDB();
    const record: Tombstone = { path, deletedAt: Date.now() };
    await db.put("tombstones", record);
  }

  async deleteTombstone(path: string): Promise<void> {
    const db = await getDB();
    await db.delete("tombstones", path);
  }

  async listTombstones(): Promise<Tombstone[]> {
    const db = await getDB();
    return db.getAll("tombstones");
  }

  // ── Zone re-encode ─────────────────────────────────────────────────────────

  /**
   * Re-encode a single record's content to match a new layer stack.
   *
   * Strategy: find the common outermost layers between `currentLayers` and
   * `targetLayers`. Peel off the non-common outer layers (decrypting each),
   * then add the new outer layers (encrypting each). This avoids unnecessary
   * work when all that's changing is an outermost layer being added or
   * removed, and it means adding a new outermost layer never requires
   * unlocking the inner zones.
   *
   * Throws ZoneLockedError if any zone required to peel existing layers is
   * locked.
   */
  private async recodeBytes(
    bytes: Uint8Array,
    path: string,
    currentLayers: readonly string[],
    targetLayers: readonly string[],
  ): Promise<Uint8Array> {
    // Compare from the bottom (innermost, last entries) up — common suffix.
    let commonSuffix = 0;
    while (
      commonSuffix < currentLayers.length &&
      commonSuffix < targetLayers.length &&
      currentLayers[currentLayers.length - 1 - commonSuffix] ===
        targetLayers[targetLayers.length - 1 - commonSuffix]
    ) {
      commonSuffix++;
    }
    // Outer layers to strip: everything in currentLayers except the common
    // innermost suffix. Peel from the outside in (layers[0] first).
    const toStrip = currentLayers.slice(0, currentLayers.length - commonSuffix);
    // Outer layers to add: everything in targetLayers except the common suffix.
    // Apply from innermost-new to outermost-new (reverse of listing order).
    const toAdd = targetLayers.slice(0, targetLayers.length - commonSuffix);

    let out = bytes;
    for (const zoneId of toStrip) {
      const codec = this.zoneService.getCodec(zoneId);
      out = await codec.decode(out, path);
    }
    for (let i = toAdd.length - 1; i >= 0; i--) {
      const zoneId = toAdd[i]!;
      const codec = this.zoneService.getCodec(zoneId);
      out = await codec.encode(out, path);
    }
    return out;
  }

  /** Re-encode one record (note/canvas/attachment) to a new layer stack.
   *  Updates the record's codec descriptor and marks it dirty for sync.
   */
  async reencodeRecord(path: string, targetLayers: readonly string[]): Promise<void> {
    const db = await getDB();
    const note = await db.get("notes", path);
    if (note) {
      const currentLayers = note.codec.scheme === "age" ? note.codec.layers : [];
      const newBytes = await this.recodeBytes(note.content, path, currentLayers, targetLayers);
      const newCodec: CodecDescriptor =
        targetLayers.length === 0 ? identityDescriptor() : ageDescriptor(targetLayers);
      await db.put("notes", { ...note, content: newBytes, codec: newCodec, syncState: "dirty" });
      return;
    }
    const canvas = await db.get("canvas", path);
    if (canvas) {
      const currentLayers = canvas.codec.scheme === "age" ? canvas.codec.layers : [];
      const newBytes = await this.recodeBytes(canvas.content, path, currentLayers, targetLayers);
      const newCodec: CodecDescriptor =
        targetLayers.length === 0 ? identityDescriptor() : ageDescriptor(targetLayers);
      await db.put("canvas", { ...canvas, content: newBytes, codec: newCodec, syncState: "dirty" });
      return;
    }
    const attachment = await db.get("attachments", path);
    if (attachment) {
      const currentLayers = attachment.codec.scheme === "age" ? attachment.codec.layers : [];
      const newBytes = await this.recodeBytes(attachment.blob, path, currentLayers, targetLayers);
      const newCodec: CodecDescriptor =
        targetLayers.length === 0 ? identityDescriptor() : ageDescriptor(targetLayers);
      await db.put("attachments", { ...attachment, blob: newBytes, codec: newCodec, syncState: "dirty" });
      return;
    }
    // path not found — caller should have checked listing; no-op.
  }

  /** Re-encode every record under `prefix` via `mutator(currentLayers) -> targetLayers`. */
  async reencodeUnderPrefix(
    prefix: string,
    mutator: (currentLayers: readonly string[]) => readonly string[],
  ): Promise<void> {
    const db = await getDB();
    const toRecode: string[] = [];
    for (const n of await db.getAll("notes")) {
      if (n.path.startsWith(prefix)) toRecode.push(n.path);
    }
    for (const c of await db.getAll("canvas")) {
      if (c.path.startsWith(prefix)) toRecode.push(c.path);
    }
    for (const a of await db.getAll("attachments")) {
      if (a.path.startsWith(prefix)) toRecode.push(a.path);
    }
    for (const path of toRecode) {
      const current = await db.get("notes", path) ?? await db.get("canvas", path) ?? await db.get("attachments", path);
      if (!current) continue;
      const currentLayers = current.codec.scheme === "age" ? current.codec.layers : [];
      const target = mutator(currentLayers);
      await this.reencodeRecord(path, target);
    }
  }
}
