// Upload orchestration: single-shot PutObject below the multipart threshold,
// full CreateMultipartUpload/UploadPart/CompleteMultipartUpload sequence
// above it. Depends only on the S3CardClient facade (not the AWS SDK
// directly), so this can run on the main thread and be unit-tested without
// a live bucket or a mocked SDK client.

import { shouldUseMultipartUpload, planParts } from "./operations.ts";
import type { S3CardClient } from "./s3-client.ts";

export interface UploadProgress {
  bytesSent: number;
  bytesTotal: number;
}

export interface UploadClient {
  putObject(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  createMultipartUpload(key: string, contentType?: string): Promise<string>;
  uploadPart(key: string, uploadId: string, partNumber: number, bytes: Uint8Array): Promise<string>;
  completeMultipartUpload(key: string, uploadId: string, parts: { PartNumber: number; ETag: string }[]): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
}

/** Upload `data` to `key`. `client` is typed structurally so a fake client
 *  suffices in tests — an S3CardClient satisfies it directly. */
export async function uploadObject(
  client: UploadClient | S3CardClient,
  key: string,
  data: Uint8Array,
  contentType: string | undefined,
  onProgress?: (p: UploadProgress) => void
): Promise<void> {
  const total = data.byteLength;
  const c = client as UploadClient;

  if (!shouldUseMultipartUpload(total)) {
    await c.putObject(key, data, contentType);
    onProgress?.({ bytesSent: total, bytesTotal: total });
    return;
  }

  const uploadId = await c.createMultipartUpload(key, contentType);
  const parts = planParts(total);
  const completed: { PartNumber: number; ETag: string }[] = [];
  try {
    let sent = 0;
    for (const part of parts) {
      const chunk = data.subarray(part.start, part.end);
      const etag = await c.uploadPart(key, uploadId, part.partNumber, chunk);
      completed.push({ PartNumber: part.partNumber, ETag: etag });
      sent += chunk.byteLength;
      onProgress?.({ bytesSent: sent, bytesTotal: total });
    }
    await c.completeMultipartUpload(key, uploadId, completed);
  } catch (err) {
    await c.abortMultipartUpload(key, uploadId).catch(() => {});
    throw err;
  }
}
