// Pure, network-free helpers for S3 operation sizing/planning. No I/O, no AWS SDK.
// Kept separate from s3-session.ts so these decisions are unit-testable without
// a live bucket or a mocked SDK client.

/** Below this, a single PutObjectCommand is used; at/above it, multipart upload. */
export const MULTIPART_UPLOAD_THRESHOLD_BYTES = 64 * 1024 * 1024; // 64MiB

/** Default part size for a multipart upload. */
export const MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024; // 8MiB

/** AWS hard limit: CopyObjectCommand alone only supports objects up to this size. */
export const COPY_OBJECT_MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5GiB

/** A soft guardrail: warn before starting an upload at/above this size (not a hard block). */
export const LARGE_UPLOAD_WARNING_BYTES = 1 * 1024 * 1024 * 1024; // 1GiB

/** Max keys per DeleteObjectsCommand batch call, per the S3 API. */
export const DELETE_OBJECTS_BATCH_LIMIT = 1000;

export function shouldUseMultipartUpload(sizeBytes: number): boolean {
  return sizeBytes >= MULTIPART_UPLOAD_THRESHOLD_BYTES;
}

export function shouldUseMultipartCopy(sizeBytes: number): boolean {
  return sizeBytes > COPY_OBJECT_MAX_BYTES;
}

export function shouldWarnBeforeUpload(sizeBytes: number): boolean {
  return sizeBytes >= LARGE_UPLOAD_WARNING_BYTES;
}

export interface PartRange {
  partNumber: number; // 1-indexed, per the S3 API
  start: number; // inclusive byte offset
  end: number; // exclusive byte offset
}

/** Split a total size into contiguous part ranges of at most `partSize` bytes each. */
export function planParts(
  totalBytes: number,
  partSize: number = MULTIPART_PART_SIZE_BYTES
): PartRange[] {
  if (totalBytes <= 0) throw new Error("planParts: totalBytes must be positive");
  if (partSize <= 0) throw new Error("planParts: partSize must be positive");
  const parts: PartRange[] = [];
  let start = 0;
  let partNumber = 1;
  while (start < totalBytes) {
    const end = Math.min(start + partSize, totalBytes);
    parts.push({ partNumber, start, end });
    start = end;
    partNumber += 1;
  }
  return parts;
}

/** Batch an array of keys into chunks of at most DELETE_OBJECTS_BATCH_LIMIT. */
export function batchKeysForDelete(keys: string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < keys.length; i += DELETE_OBJECTS_BATCH_LIMIT) {
    batches.push(keys.slice(i, i + DELETE_OBJECTS_BATCH_LIMIT));
  }
  return batches;
}

export interface CopyPlanEntry {
  from: string;
  to: string;
}

/**
 * Build the from/to key pairs for a folder rename/move: every key under
 * `fromPrefix` gets copied to the same relative path under `toPrefix`.
 * Pure planning only — does not touch the network or decide multipart-copy
 * per entry (callers should size-gate with shouldUseMultipartCopy per object).
 */
export function buildCopyPlan(keys: string[], fromPrefix: string, toPrefix: string): CopyPlanEntry[] {
  if (!fromPrefix.endsWith("/")) throw new Error("buildCopyPlan: fromPrefix must end with '/'");
  if (!toPrefix.endsWith("/")) throw new Error("buildCopyPlan: toPrefix must end with '/'");
  return keys.map((key) => {
    if (!key.startsWith(fromPrefix)) {
      throw new Error(`buildCopyPlan: key ${key} is not under prefix ${fromPrefix}`);
    }
    return { from: key, to: toPrefix + key.slice(fromPrefix.length) };
  });
}
