import { describe, it, expect } from "vitest";
import { encodeS3Card, decodeS3Card, generateCardId, type S3CardPayload } from "../src/s3/card.ts";

const samplePayload: S3CardPayload = {
  version: 1,
  id: "11111111-1111-1111-1111-111111111111",
  displayName: "my-bucket",
  bucket: "my-bucket",
  region: "us-east-1",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "super-secret-value",
};

describe("s3 card", { timeout: 30_000 }, () => {
  it("round-trips an encoded payload with the same passphrase", async () => {
    const blob = await encodeS3Card(samplePayload, "correct horse battery staple");
    const decoded = await decodeS3Card(blob, "correct horse battery staple");
    expect(decoded).toEqual(samplePayload);
  });

  it("round-trips a payload with a session token", async () => {
    const withToken: S3CardPayload = { ...samplePayload, sessionToken: "sts-token" };
    const blob = await encodeS3Card(withToken, "pw");
    const decoded = await decodeS3Card(blob, "pw");
    expect(decoded).toEqual(withToken);
  });

  it("rejects the wrong passphrase", async () => {
    const blob = await encodeS3Card(samplePayload, "hunter2");
    await expect(decodeS3Card(blob, "not-the-passphrase")).rejects.toThrow(/wrong passphrase/);
  });

  it("rejects a malformed blob", async () => {
    await expect(decodeS3Card("not-real-base64!!", "any")).rejects.toThrow(/malformed/);
  });

  it("produces a URL-safe blob (no +, /, =) — safe to embed in a code fence", async () => {
    const blob = await encodeS3Card(samplePayload, "pw");
    expect(blob).not.toMatch(/[+/=]/);
  });

  it("refuses to encode or decode with an empty passphrase", async () => {
    await expect(encodeS3Card(samplePayload, "")).rejects.toThrow(/passphrase/);
    const blob = await encodeS3Card(samplePayload, "x");
    await expect(decodeS3Card(blob, "")).rejects.toThrow(/passphrase/);
  });

  it("leaks nothing about the payload in the ciphertext blob itself", async () => {
    const blob = await encodeS3Card(samplePayload, "pw");
    expect(blob).not.toContain("my-bucket");
    expect(blob).not.toContain("AKIAEXAMPLE");
    expect(blob).not.toContain("super-secret-value");
  });
});

describe("generateCardId", () => {
  it("generates distinct ids", () => {
    const a = generateCardId();
    const b = generateCardId();
    expect(a).not.toBe(b);
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
  });
});
