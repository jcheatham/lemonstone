import { describe, it, expect, vi } from "vitest";
import { copyObjectSizeAware, moveObject, type MoveClient } from "../src/s3/move.ts";
import { COPY_OBJECT_MAX_BYTES } from "../src/s3/operations.ts";

function makeFakeClient(): MoveClient & {
  copies: { from: string; to: string }[];
  partCopies: { from: string; to: string; uploadId: string; partNumber: number; range: string }[];
  completed: { key: string; uploadId: string; parts: unknown }[];
  aborted: { key: string; uploadId: string }[];
  deleted: string[];
} {
  let uploadCounter = 0;
  return {
    copies: [],
    partCopies: [],
    completed: [],
    aborted: [],
    deleted: [],
    async copyObject(fromKey, toKey) {
      this.copies.push({ from: fromKey, to: toKey });
    },
    async createMultipartUpload() {
      uploadCounter += 1;
      return `upload-${uploadCounter}`;
    },
    async uploadPartCopy(fromKey, toKey, uploadId, partNumber, range) {
      this.partCopies.push({ from: fromKey, to: toKey, uploadId, partNumber, range });
      return `etag-${partNumber}`;
    },
    async completeMultipartUpload(key, uploadId, parts) {
      this.completed.push({ key, uploadId, parts });
    },
    async abortMultipartUpload(key, uploadId) {
      this.aborted.push({ key, uploadId });
    },
    async deleteObject(key) {
      this.deleted.push(key);
    },
  };
}

describe("copyObjectSizeAware", () => {
  it("uses a single CopyObjectCommand at/below the 5GiB limit", async () => {
    const client = makeFakeClient();
    await copyObjectSizeAware(client, "old.txt", "new.txt", COPY_OBJECT_MAX_BYTES);
    expect(client.copies).toEqual([{ from: "old.txt", to: "new.txt" }]);
    expect(client.partCopies).toEqual([]);
  });

  it("uses multipart copy above the 5GiB limit", async () => {
    const client = makeFakeClient();
    const size = COPY_OBJECT_MAX_BYTES + 1;
    await copyObjectSizeAware(client, "old.bin", "new.bin", size);

    expect(client.copies).toEqual([]);
    expect(client.partCopies.length).toBeGreaterThan(1);
    expect(client.partCopies.every((p) => p.from === "old.bin" && p.to === "new.bin")).toBe(true);
    expect(client.completed).toHaveLength(1);
  });

  it("builds correct byte ranges for multipart copy parts", async () => {
    const client = makeFakeClient();
    const partSize = 512 * 1024 * 1024;
    // Must exceed the 5GiB CopyObject limit to trigger multipart at all.
    const size = COPY_OBJECT_MAX_BYTES + partSize * 2 + 100;
    await copyObjectSizeAware(client, "old.bin", "new.bin", size);

    const expectedParts = Math.ceil(size / partSize);
    expect(client.partCopies).toHaveLength(expectedParts);
    let start = 0;
    for (let i = 0; i < expectedParts; i++) {
      const end = Math.min(start + partSize, size);
      expect(client.partCopies[i]).toEqual({
        from: "old.bin", to: "new.bin", uploadId: "upload-1",
        partNumber: i + 1, range: `bytes=${start}-${end - 1}`,
      });
      start = end;
    }
  });

  it("aborts and rethrows if a part copy fails", async () => {
    const client = makeFakeClient();
    client.uploadPartCopy = vi.fn().mockRejectedValue(new Error("copy failed"));
    const size = COPY_OBJECT_MAX_BYTES + 1;

    await expect(copyObjectSizeAware(client, "old.bin", "new.bin", size)).rejects.toThrow("copy failed");
    expect(client.aborted).toHaveLength(1);
    expect(client.completed).toEqual([]);
  });
});

describe("moveObject", () => {
  it("copies then deletes the source", async () => {
    const client = makeFakeClient();
    await moveObject(client, "old.txt", "new.txt", 100);
    expect(client.copies).toEqual([{ from: "old.txt", to: "new.txt" }]);
    expect(client.deleted).toEqual(["old.txt"]);
  });

  it("does not delete the source if the copy fails", async () => {
    const client = makeFakeClient();
    client.copyObject = vi.fn().mockRejectedValue(new Error("copy failed"));
    await expect(moveObject(client, "old.txt", "new.txt", 100)).rejects.toThrow("copy failed");
    expect(client.deleted).toEqual([]);
  });
});
