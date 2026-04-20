import type { ContentCodec } from "./codec.ts";

// Magic bytes that known encryption schemes typically start with.
// Used to distinguish plaintext from ciphertext on a best-effort basis.
const ENCRYPTION_MAGIC_PREFIXES: Uint8Array[] = [
  new Uint8Array([0x61, 0x67, 0x65, 0x2d]), // "age-"
  new Uint8Array([0x00, 0x73, 0x73, 0x68]), // OpenSSH encrypted key header
];

function looksEncrypted(bytes: Uint8Array): boolean {
  for (const prefix of ENCRYPTION_MAGIC_PREFIXES) {
    if (bytes.length >= prefix.length) {
      let match = true;
      for (let i = 0; i < prefix.length; i++) {
        if (bytes[i] !== prefix[i]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
  }
  return false;
}

export class IdentityCodec implements ContentCodec {
  readonly scheme = "identity";
  readonly version = 1;

  async encode(plaintext: Uint8Array, _path: string): Promise<Uint8Array> {
    return plaintext;
  }

  async decode(atRest: Uint8Array, _path: string): Promise<Uint8Array> {
    return atRest;
  }

  recognizes(atRest: Uint8Array): boolean {
    return !looksEncrypted(atRest);
  }
}

export const identityCodec = new IdentityCodec();
