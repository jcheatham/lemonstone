export interface ContentCodec {
  readonly scheme: string;
  readonly version: number;

  encode(plaintext: Uint8Array, path: string): Promise<Uint8Array>;
  decode(atRest: Uint8Array, path: string): Promise<Uint8Array>;
  recognizes(atRest: Uint8Array): boolean;
}

// Per-record descriptor of how a stored blob was encoded.
//
// `identity` is plaintext. `age` is layered: `layers` lists zone ids in
// decryption order (outermost wrapper first). For a single-zone file,
// `layers` has one element. For a nested two-zone file, `layers` has two:
// the inner zone first (because its encryption was applied last, so its
// decryption happens first on read).
export type CodecDescriptor =
  | { scheme: "identity"; version: number }
  | { scheme: "age"; version: number; layers: string[] };
