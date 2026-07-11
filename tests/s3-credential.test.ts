import { describe, it, expect } from "vitest";
import {
  isS3Credential,
  parseS3Credential,
  serializeS3Credential,
  type S3Credential,
} from "../src/s3/credential.ts";
import { AgeCodec } from "../src/codec/age-codec.ts";
import { createZone } from "../src/codec/keys.ts";

const encoder = new TextEncoder();

describe("serializeS3Credential / parseS3Credential", () => {
  it("round-trips a credential without a session token", () => {
    const credential: S3Credential = {
      version: 1,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret-value",
    };
    const bytes = serializeS3Credential(credential);
    expect(parseS3Credential(bytes)).toEqual(credential);
  });

  it("round-trips a credential with a session token", () => {
    const credential: S3Credential = {
      version: 1,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret-value",
      sessionToken: "temp-token",
    };
    const bytes = serializeS3Credential(credential);
    expect(parseS3Credential(bytes)).toEqual(credential);
  });

  it("rejects malformed content", () => {
    expect(() => parseS3Credential(encoder.encode("{}"))).toThrow(/malformed/);
    expect(() => parseS3Credential(encoder.encode("not json"))).toThrow();
    expect(() =>
      parseS3Credential(encoder.encode(JSON.stringify({ version: 1, accessKeyId: "" })))
    ).toThrow(/malformed/);
  });
});

describe("isS3Credential", () => {
  it("rejects wrong version", () => {
    expect(isS3Credential({ version: 2, accessKeyId: "a", secretAccessKey: "b" })).toBe(false);
  });

  it("rejects a non-string sessionToken", () => {
    expect(
      isS3Credential({ version: 1, accessKeyId: "a", secretAccessKey: "b", sessionToken: 123 })
    ).toBe(false);
  });
});

describe("S3Credential through the existing zone crypto", { timeout: 30_000 }, () => {
  it("round-trips bit-for-bit through AgeCodec, proving the crypto reuse works", async () => {
    const { zone, identity } = await createZone("s3-credentials/", "correct horse battery staple");
    const codec = new AgeCodec(identity, zone.recipient);

    const credential: S3Credential = {
      version: 1,
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "super-secret",
      sessionToken: "sts-token",
    };
    const plaintext = serializeS3Credential(credential);
    const path = "s3-credentials/link-1.json";

    const ciphertext = await codec.encode(plaintext, path);
    expect(ciphertext).not.toEqual(plaintext);

    const recovered = await codec.decode(ciphertext, path);
    expect(parseS3Credential(recovered)).toEqual(credential);
  });

  it("cannot be decrypted by a different zone's identity", async () => {
    const { zone: z1, identity: i1 } = await createZone("s3-credentials/", "zone-one-pw");
    const { identity: i2 } = await createZone("s3-credentials/", "zone-two-pw");
    const codec1 = new AgeCodec(i1, z1.recipient);

    const credential: S3Credential = { version: 1, accessKeyId: "a", secretAccessKey: "b" };
    const ciphertext = await codec1.encode(serializeS3Credential(credential), "x.json");

    const wrongZoneRecipient = await import("age-encryption").then((m) =>
      m.identityToRecipient(i2)
    );
    const codec2 = new AgeCodec(i2, wrongZoneRecipient);
    await expect(codec2.decode(ciphertext, "x.json")).rejects.toThrow();
  });
});
