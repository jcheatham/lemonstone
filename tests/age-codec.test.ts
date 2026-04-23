import { describe, it, expect } from "vitest";
import { AgeCodec } from "../src/codec/age-codec.ts";
import {
  createZone,
  parseKeysJson,
  serializeKeysJson,
  unwrapZoneIdentity,
  rewrapZoneIdentity,
  isKeysFile,
} from "../src/codec/keys.ts";
import { identityCodec } from "../src/codec/identity-codec.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("keys.ts", { timeout: 30_000 }, () => {
  it("creates a zone whose identity round-trips with its passphrase", async () => {
    const { zone, identity } = await createZone("journal/", "hunter2-definitely-secure");
    expect(zone.algorithm).toBe("age-v1");
    expect(zone.prefix).toBe("journal/");
    expect(zone.recipient.startsWith("age1")).toBe(true);
    expect(identity.startsWith("AGE-SECRET-KEY-")).toBe(true);

    const unwrapped = await unwrapZoneIdentity(zone, "hunter2-definitely-secure");
    expect(unwrapped).toBe(identity);
  });

  it("rejects a wrong passphrase", async () => {
    const { zone } = await createZone("journal/", "correct horse battery staple");
    await expect(unwrapZoneIdentity(zone, "wrong passphrase")).rejects.toThrow(/wrong passphrase/);
  });

  it("rewrap preserves the identity", async () => {
    const { zone, identity } = await createZone("j/", "original-pw");
    const rewrapped = await rewrapZoneIdentity(zone, identity, "new-pw");
    const unwrapped = await unwrapZoneIdentity(rewrapped, "new-pw");
    expect(unwrapped).toBe(identity);
    expect(rewrapped.id).toBe(zone.id);
    expect(rewrapped.recipient).toBe(zone.recipient);
  });

  it("serializes and parses as JSON", async () => {
    const { zone: z1 } = await createZone("a/", "p1");
    const { zone: z2 } = await createZone("b/", "p2");
    const file = { version: 1 as const, zones: [z1, z2] };
    expect(isKeysFile(file)).toBe(true);
    const bytes = serializeKeysJson(file);
    const parsed = parseKeysJson(bytes);
    expect(parsed).toEqual(file);
  });

  it("parseKeysJson rejects malformed content", () => {
    expect(() => parseKeysJson(encoder.encode("{}"))).toThrow(/malformed/);
    expect(() => parseKeysJson(encoder.encode("not json"))).toThrow();
    expect(() => parseKeysJson(encoder.encode(JSON.stringify({ version: 1 })))).toThrow(/malformed/);
  });
});

describe("AgeCodec", { timeout: 30_000 }, () => {
  it("round-trips a plaintext buffer", async () => {
    const { zone, identity } = await createZone("notes/", "round-trip-pw");
    const codec = new AgeCodec(identity, zone.recipient);
    const plain = encoder.encode("# Hello\n\nThis is a markdown note with [[links]].");

    const ciphertext = await codec.encode(plain, "notes/hello.md");
    expect(ciphertext).not.toEqual(plain);
    const recovered = await codec.decode(ciphertext, "notes/hello.md");
    expect(decoder.decode(recovered)).toBe(decoder.decode(plain));
  });

  it("recognizes its own ciphertext but not plaintext or identity-codec output", async () => {
    const { zone, identity } = await createZone("x/", "rec");
    const codec = new AgeCodec(identity, zone.recipient);

    const cipher = await codec.encode(encoder.encode("secret"), "x.md");
    expect(codec.recognizes(cipher)).toBe(true);

    const plaintext = encoder.encode("# plain markdown");
    expect(codec.recognizes(plaintext)).toBe(false);

    const asRest = await identityCodec.encode(plaintext, "x.md");
    expect(codec.recognizes(asRest)).toBe(false);
  });

  it("identity codec refuses to recognize age ciphertext", async () => {
    const { zone, identity } = await createZone("x/", "cross-check");
    const codec = new AgeCodec(identity, zone.recipient);
    const cipher = await codec.encode(encoder.encode("hello"), "x.md");
    expect(identityCodec.recognizes(cipher)).toBe(false);
  });

  it("rejects construction with a bogus identity or recipient", async () => {
    expect(() => new AgeCodec("not-an-identity", "age1" + "x".repeat(60))).toThrow(/secret key/);
    const { identity } = await createZone("x/", "x");
    expect(() => new AgeCodec(identity, "not-a-recipient")).toThrow(/public key/);
  });

  it("cross-zone cipher rejection: another identity cannot decrypt", async () => {
    const { zone: z1, identity: i1 } = await createZone("a/", "vault-1");
    const { zone: z2, identity: i2 } = await createZone("b/", "vault-2");
    const c1 = new AgeCodec(i1, z1.recipient);
    const c2 = new AgeCodec(i2, z2.recipient);
    const cipher = await c1.encode(encoder.encode("v1 secret"), "x.md");
    await expect(c2.decode(cipher, "x.md")).rejects.toThrow();
  });
});
