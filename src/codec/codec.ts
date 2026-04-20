export interface ContentCodec {
  readonly scheme: string;
  readonly version: number;

  encode(plaintext: Uint8Array, path: string): Promise<Uint8Array>;
  decode(atRest: Uint8Array, path: string): Promise<Uint8Array>;
  recognizes(atRest: Uint8Array): boolean;
}

export interface CodecDescriptor {
  scheme: string;
  version: number;
}
