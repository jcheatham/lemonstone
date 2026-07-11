import { describe, it, expect, vi } from "vitest";
import { uploadObject, type UploadClient, type UploadProgress } from "../src/s3/upload.ts";
import { MULTIPART_UPLOAD_THRESHOLD_BYTES, MULTIPART_PART_SIZE_BYTES } from "../src/s3/operations.ts";

function makeFakeClient(): UploadClient & {
  puts: { key: string; size: number }[];
  parts: { key: string; uploadId: string; partNumber: number; size: number }[];
  completed: { key: string; uploadId: string; parts: unknown }[];
  aborted: { key: string; uploadId: string }[];
} {
  let uploadCounter = 0;
  return {
    puts: [],
    parts: [],
    completed: [],
    aborted: [],
    async putObject(key, bytes) {
      this.puts.push({ key, size: bytes.byteLength });
    },
    async createMultipartUpload(key) {
      uploadCounter += 1;
      return `upload-${uploadCounter}`;
    },
    async uploadPart(key, uploadId, partNumber, bytes) {
      this.parts.push({ key, uploadId, partNumber, size: bytes.byteLength });
      return `etag-${partNumber}`;
    },
    async completeMultipartUpload(key, uploadId, parts) {
      this.completed.push({ key, uploadId, parts });
    },
    async abortMultipartUpload(key, uploadId) {
      this.aborted.push({ key, uploadId });
    },
  };
}

describe("uploadObject", () => {
  it("uses a single PutObject for small files", async () => {
    const client = makeFakeClient();
    const data = new Uint8Array(1024);
    await uploadObject(client, "small.txt", data, "text/plain");

    expect(client.puts).toEqual([{ key: "small.txt", size: 1024 }]);
    expect(client.parts).toEqual([]);
  });

  it("reports 100% progress for a single-shot upload", async () => {
    const client = makeFakeClient();
    const progress: UploadProgress[] = [];
    await uploadObject(client, "small.txt", new Uint8Array(10), undefined, (p) => progress.push(p));
    expect(progress).toEqual([{ bytesSent: 10, bytesTotal: 10 }]);
  });

  it("uses multipart upload for files at/above the threshold", async () => {
    const client = makeFakeClient();
    const data = new Uint8Array(MULTIPART_UPLOAD_THRESHOLD_BYTES + 1);
    await uploadObject(client, "big.bin", data, "application/octet-stream");

    expect(client.puts).toEqual([]);
    expect(client.parts.length).toBe(Math.ceil(data.byteLength / MULTIPART_PART_SIZE_BYTES));
    expect(client.completed).toHaveLength(1);
    expect(client.completed[0]!.key).toBe("big.bin");
    expect(client.aborted).toEqual([]);
  });

  it("reports incremental progress across multipart parts", async () => {
    const client = makeFakeClient();
    const data = new Uint8Array(MULTIPART_UPLOAD_THRESHOLD_BYTES + MULTIPART_PART_SIZE_BYTES + 1);
    const expectedParts = Math.ceil(data.byteLength / MULTIPART_PART_SIZE_BYTES);
    const progress: UploadProgress[] = [];
    await uploadObject(client, "big.bin", data, undefined, (p) => progress.push(p));

    expect(progress).toHaveLength(expectedParts);
    expect(progress[progress.length - 1]).toEqual({ bytesSent: data.byteLength, bytesTotal: data.byteLength });
    // Monotonically increasing.
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]!.bytesSent).toBeGreaterThan(progress[i - 1]!.bytesSent);
    }
  });

  it("completes the multipart upload with parts in order with correct ETags", async () => {
    const client = makeFakeClient();
    const data = new Uint8Array(MULTIPART_UPLOAD_THRESHOLD_BYTES + MULTIPART_PART_SIZE_BYTES + 1);
    const expectedParts = Math.ceil(data.byteLength / MULTIPART_PART_SIZE_BYTES);
    await uploadObject(client, "big.bin", data, undefined);

    const parts = client.completed[0]!.parts as { PartNumber: number; ETag: string }[];
    expect(parts.map((p) => p.PartNumber)).toEqual(Array.from({ length: expectedParts }, (_, i) => i + 1));
    expect(parts.map((p) => p.ETag)).toEqual(Array.from({ length: expectedParts }, (_, i) => `etag-${i + 1}`));
  });

  it("aborts the multipart upload if a part fails, and rethrows", async () => {
    const client = makeFakeClient();
    client.uploadPart = vi.fn().mockRejectedValue(new Error("network blip"));
    const data = new Uint8Array(MULTIPART_UPLOAD_THRESHOLD_BYTES + 1);

    await expect(uploadObject(client, "big.bin", data, undefined)).rejects.toThrow("network blip");
    expect(client.aborted).toHaveLength(1);
    expect(client.completed).toEqual([]);
  });

  it("does not throw if abort itself fails after an upload error", async () => {
    const client = makeFakeClient();
    client.uploadPart = vi.fn().mockRejectedValue(new Error("network blip"));
    client.abortMultipartUpload = vi.fn().mockRejectedValue(new Error("abort also failed"));
    const data = new Uint8Array(MULTIPART_UPLOAD_THRESHOLD_BYTES + 1);

    await expect(uploadObject(client, "big.bin", data, undefined)).rejects.toThrow("network blip");
  });
});
