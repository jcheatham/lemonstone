import { describe, it, expect } from "vitest";
import { encodeShareLink, decodeShareLink, type ShareLinkPayload } from "../src/vault/share-link.ts";

const samplePayload: ShareLinkPayload = {
  version: 1,
  repoFullName: "jcheatham/notes",
  repoDefaultBranch: "main",
  accessToken: "ghp_example_token_abcdefghijklmnop",
};

describe("share-link", { timeout: 30_000 }, () => {
  it("round-trips an encoded payload with the same password", async () => {
    const blob = await encodeShareLink(samplePayload, "correct horse battery staple");
    const decoded = await decodeShareLink(blob, "correct horse battery staple");
    expect(decoded).toEqual(samplePayload);
  });

  it("rejects the wrong password", async () => {
    const blob = await encodeShareLink(samplePayload, "hunter2");
    await expect(decodeShareLink(blob, "not-the-password")).rejects.toThrow(/wrong password/);
  });

  it("rejects a malformed blob", async () => {
    await expect(decodeShareLink("not-real-base64!!", "any")).rejects.toThrow(/malformed/);
  });

  it("produces a URL-safe blob (no +, /, =)", async () => {
    const blob = await encodeShareLink(samplePayload, "pw");
    expect(blob).not.toMatch(/[+/=]/);
  });

  it("refuses to encode or decode with an empty password", async () => {
    await expect(encodeShareLink(samplePayload, "")).rejects.toThrow(/password/);
    // Produce a valid blob first so the password check is what fires, not malformed.
    const blob = await encodeShareLink(samplePayload, "x");
    await expect(decodeShareLink(blob, "")).rejects.toThrow(/password/);
  });
});
