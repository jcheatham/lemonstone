import { describe, it, expect } from "vitest";
import { IdentityCodec } from "../src/codec/identity-codec.ts";

describe("IdentityCodec", () => {
  const codec = new IdentityCodec();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  it("encode returns plaintext unchanged", async () => {
    const input = encoder.encode("Hello, Lemonstone!");
    const output = await codec.encode(input, "test.md");
    expect(decoder.decode(output)).toBe("Hello, Lemonstone!");
  });

  it("decode returns plaintext unchanged", async () => {
    const input = encoder.encode("# My Note\n\nSome content.");
    const output = await codec.decode(input, "notes/note.md");
    expect(decoder.decode(output)).toBe("# My Note\n\nSome content.");
  });

  it("recognizes plaintext bytes", () => {
    const plaintext = encoder.encode("# Normal markdown content");
    expect(codec.recognizes(plaintext)).toBe(true);
  });

  it("does not recognize age-encrypted bytes", () => {
    // "age-" prefix in ASCII
    const encrypted = new Uint8Array([0x61, 0x67, 0x65, 0x2d, 0x01, 0x02]);
    expect(codec.recognizes(encrypted)).toBe(false);
  });

  it("scheme is 'identity'", () => {
    expect(codec.scheme).toBe("identity");
    expect(codec.version).toBe(1);
  });

  it("encode/decode roundtrip preserves binary content", async () => {
    const binary = new Uint8Array([0, 1, 2, 255, 128, 64]);
    const encoded = await codec.encode(binary, "attachments/file.bin");
    const decoded = await codec.decode(encoded, "attachments/file.bin");
    expect(decoded).toEqual(binary);
  });
});
