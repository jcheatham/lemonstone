// Move/rename orchestration: S3 has no atomic rename, so this is always
// copy-then-delete-after-confirmed-copy — the source is only ever removed
// once the copy has fully succeeded, to avoid data loss on a failed copy.
// CopyObjectCommand alone only supports objects up to 5GiB (AWS hard limit);
// above that, multipart copy (UploadPartCopy per part) is required.
//
// Depends only on a structural client (an S3CardClient satisfies it), so
// this is unit-testable without a live bucket.

import { shouldUseMultipartCopy, planParts } from "./operations.ts";
import type { S3CardClient } from "./s3-client.ts";

/** Larger part size than uploads — copy parts are server-side, not bandwidth-bound. */
const COPY_PART_SIZE_BYTES = 512 * 1024 * 1024; // 512MiB

export interface MoveClient {
  copyObject(fromKey: string, toKey: string): Promise<void>;
  createMultipartUpload(key: string, contentType?: string): Promise<string>;
  uploadPartCopy(fromKey: string, toKey: string, uploadId: string, partNumber: number, range: string): Promise<string>;
  completeMultipartUpload(key: string, uploadId: string, parts: { PartNumber: number; ETag: string }[]): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
}

/** Copy one object, choosing single CopyObjectCommand vs multipart copy by size. */
export async function copyObjectSizeAware(
  client: MoveClient | S3CardClient,
  fromKey: string,
  toKey: string,
  sizeBytes: number
): Promise<void> {
  const c = client as MoveClient;
  if (!shouldUseMultipartCopy(sizeBytes)) {
    await c.copyObject(fromKey, toKey);
    return;
  }
  const uploadId = await c.createMultipartUpload(toKey);
  const parts = planParts(sizeBytes, COPY_PART_SIZE_BYTES);
  const completed: { PartNumber: number; ETag: string }[] = [];
  try {
    for (const part of parts) {
      const range = `bytes=${part.start}-${part.end - 1}`;
      const etag = await c.uploadPartCopy(fromKey, toKey, uploadId, part.partNumber, range);
      completed.push({ PartNumber: part.partNumber, ETag: etag });
    }
    await c.completeMultipartUpload(toKey, uploadId, completed);
  } catch (err) {
    await c.abortMultipartUpload(toKey, uploadId).catch(() => {});
    throw err;
  }
}

/** Move (rename) a single object: copy, then delete the source — only after
 *  the copy has fully succeeded. */
export async function moveObject(
  client: MoveClient | S3CardClient,
  fromKey: string,
  toKey: string,
  sizeBytes: number
): Promise<void> {
  await copyObjectSizeAware(client, fromKey, toKey, sizeBytes);
  await (client as MoveClient).deleteObject(fromKey);
}
