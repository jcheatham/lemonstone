// AgeCodec — encode/decode content via the age v1 file format.
//
// Construction requires an age identity + recipient (obtained from unwrapping
// keys.json via the user's passphrase). Files are encrypted TO the recipient;
// decryption uses the identity. The identity is held only in memory.

import { Encrypter, Decrypter } from "age-encryption";
import type { ContentCodec } from "./codec.ts";

const AGE_MAGIC = "age-encryption.org/v1";

export class AgeCodec implements ContentCodec {
  readonly scheme = "age";
  readonly version = 1;

  constructor(
    private readonly identity: string,
    private readonly recipient: string,
  ) {
    if (!identity.startsWith("AGE-SECRET-KEY-")) {
      throw new Error("AgeCodec: identity must be an age secret key");
    }
    if (!recipient.startsWith("age1")) {
      throw new Error("AgeCodec: recipient must be an age public key");
    }
  }

  async encode(plaintext: Uint8Array, _path: string): Promise<Uint8Array> {
    const enc = new Encrypter();
    enc.addRecipient(this.recipient);
    return enc.encrypt(plaintext);
  }

  async decode(atRest: Uint8Array, _path: string): Promise<Uint8Array> {
    const dec = new Decrypter();
    dec.addIdentity(this.identity);
    return dec.decrypt(atRest);
  }

  recognizes(atRest: Uint8Array): boolean {
    // age files start with the ASCII magic string. Checking the first 21
    // bytes is enough to reject non-age content confidently.
    if (atRest.length < AGE_MAGIC.length) return false;
    for (let i = 0; i < AGE_MAGIC.length; i++) {
      if (atRest[i] !== AGE_MAGIC.charCodeAt(i)) return false;
    }
    return true;
  }
}
