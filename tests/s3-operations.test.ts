import { describe, it, expect } from "vitest";
import {
  MULTIPART_UPLOAD_THRESHOLD_BYTES,
  COPY_OBJECT_MAX_BYTES,
  LARGE_UPLOAD_WARNING_BYTES,
  DELETE_OBJECTS_BATCH_LIMIT,
  shouldUseMultipartUpload,
  shouldUseMultipartCopy,
  shouldWarnBeforeUpload,
  planParts,
  batchKeysForDelete,
  buildCopyPlan,
} from "../src/s3/operations.ts";

describe("shouldUseMultipartUpload", () => {
  it("is false below the threshold", () => {
    expect(shouldUseMultipartUpload(MULTIPART_UPLOAD_THRESHOLD_BYTES - 1)).toBe(false);
  });

  it("is true at and above the threshold", () => {
    expect(shouldUseMultipartUpload(MULTIPART_UPLOAD_THRESHOLD_BYTES)).toBe(true);
    expect(shouldUseMultipartUpload(MULTIPART_UPLOAD_THRESHOLD_BYTES + 1)).toBe(true);
  });
});

describe("shouldUseMultipartCopy", () => {
  it("is false at and below the AWS 5GiB CopyObject limit", () => {
    expect(shouldUseMultipartCopy(COPY_OBJECT_MAX_BYTES)).toBe(false);
    expect(shouldUseMultipartCopy(COPY_OBJECT_MAX_BYTES - 1)).toBe(false);
  });

  it("is true above the limit", () => {
    expect(shouldUseMultipartCopy(COPY_OBJECT_MAX_BYTES + 1)).toBe(true);
  });
});

describe("shouldWarnBeforeUpload", () => {
  it("is false below the warning threshold", () => {
    expect(shouldWarnBeforeUpload(LARGE_UPLOAD_WARNING_BYTES - 1)).toBe(false);
  });

  it("is true at and above the warning threshold", () => {
    expect(shouldWarnBeforeUpload(LARGE_UPLOAD_WARNING_BYTES)).toBe(true);
  });
});

describe("planParts", () => {
  it("splits an exact multiple into equal parts", () => {
    const parts = planParts(20, 10);
    expect(parts).toEqual([
      { partNumber: 1, start: 0, end: 10 },
      { partNumber: 2, start: 10, end: 20 },
    ]);
  });

  it("handles a remainder in the final part", () => {
    const parts = planParts(25, 10);
    expect(parts).toEqual([
      { partNumber: 1, start: 0, end: 10 },
      { partNumber: 2, start: 10, end: 20 },
      { partNumber: 3, start: 20, end: 25 },
    ]);
  });

  it("a size smaller than partSize yields a single part", () => {
    const parts = planParts(5, 10);
    expect(parts).toEqual([{ partNumber: 1, start: 0, end: 5 }]);
  });

  it("rejects non-positive totalBytes or partSize", () => {
    expect(() => planParts(0, 10)).toThrow();
    expect(() => planParts(10, 0)).toThrow();
  });
});

describe("batchKeysForDelete", () => {
  it("returns a single batch when under the limit", () => {
    const keys = Array.from({ length: 5 }, (_, i) => `k${i}`);
    expect(batchKeysForDelete(keys)).toEqual([keys]);
  });

  it("splits into multiple batches at the S3 API limit", () => {
    const keys = Array.from({ length: DELETE_OBJECTS_BATCH_LIMIT + 1 }, (_, i) => `k${i}`);
    const batches = batchKeysForDelete(keys);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(DELETE_OBJECTS_BATCH_LIMIT);
    expect(batches[1]).toHaveLength(1);
  });

  it("handles an empty array", () => {
    expect(batchKeysForDelete([])).toEqual([]);
  });
});

describe("buildCopyPlan", () => {
  it("maps keys under fromPrefix to the same relative path under toPrefix", () => {
    const keys = ["old/a.txt", "old/sub/b.txt"];
    const plan = buildCopyPlan(keys, "old/", "new/");
    expect(plan).toEqual([
      { from: "old/a.txt", to: "new/a.txt" },
      { from: "old/sub/b.txt", to: "new/sub/b.txt" },
    ]);
  });

  it("throws if a key is not under fromPrefix", () => {
    expect(() => buildCopyPlan(["other/a.txt"], "old/", "new/")).toThrow(/not under prefix/);
  });

  it("requires trailing slashes on both prefixes", () => {
    expect(() => buildCopyPlan([], "old", "new/")).toThrow(/fromPrefix/);
    expect(() => buildCopyPlan([], "old/", "new")).toThrow(/toPrefix/);
  });
});
