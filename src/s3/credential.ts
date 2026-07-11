// Plaintext AWS credential shape. This is ONLY ever handled as plaintext:
//   - transiently in the card-creation modal, before it's sealed into an s3vault blob
//   - once per card activation, decrypted from the blob and handed to the
//     S3 worker via `openSession` — never retained in long-lived main-thread state
//
// At rest it exists solely as passphrase-encrypted bytes inside the note's
// `s3vault` blob (see src/s3/card.ts), which routes through AgeCodec like any
// other passphrase-protected content. There is no unencrypted persistence of
// this type anywhere.

export interface S3Credential {
  version: 1;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function isS3Credential(value: unknown): value is S3Credential {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v["version"] !== 1) return false;
  if (typeof v["accessKeyId"] !== "string" || v["accessKeyId"].length === 0) return false;
  if (typeof v["secretAccessKey"] !== "string" || v["secretAccessKey"].length === 0) return false;
  if (v["sessionToken"] !== undefined && typeof v["sessionToken"] !== "string") return false;
  return true;
}

export function parseS3Credential(bytes: Uint8Array): S3Credential {
  const text = decoder.decode(bytes);
  const parsed = JSON.parse(text);
  if (!isS3Credential(parsed)) {
    throw new Error("S3 credential: malformed payload");
  }
  return parsed;
}

export function serializeS3Credential(credential: S3Credential): Uint8Array {
  return encoder.encode(JSON.stringify(credential));
}
