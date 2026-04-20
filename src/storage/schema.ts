import type { CodecDescriptor } from "../codec/index.ts";

export type SyncState = "clean" | "dirty" | "conflict";

export interface AuthRecord {
  key: "github";
  // Value is AES-GCM encrypted bytes stored as base64; see auth/token-store.ts
  encryptedPayload: string;
}

export interface AuthPayload {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;   // Unix ms
  refreshTokenExpiresAt: number;  // Unix ms
  installationId: number;
  repoFullName: string;           // "owner/repo"
  repoDefaultBranch: string;
}

export interface NoteRecord {
  path: string;
  content: Uint8Array;            // codec-encoded bytes
  size: number;
  updatedAt: number;              // Unix ms
  frontmatter: Record<string, unknown>;
  syncState: SyncState;
  baseSha: string;
  codec: CodecDescriptor;
}

export interface CanvasRecord {
  path: string;
  content: Uint8Array;            // codec-encoded bytes
  updatedAt: number;
  syncState: SyncState;
  baseSha: string;
  codec: CodecDescriptor;
}

export interface AttachmentRecord {
  path: string;
  blob: Uint8Array;               // codec-encoded bytes
  size: number;
  updatedAt: number;
  syncState: SyncState;
  baseSha: string;
  codec: CodecDescriptor;
}

export interface IndexesSnapshotRecord {
  key: "v1";
  // codec-encoded serialized snapshot
  data: Uint8Array;
  snapshotAt: number;             // Unix ms
  vaultHeadCommitSha: string;
  codec: CodecDescriptor;
}

export interface ConfigRecord {
  key: string;
  value: unknown;
}

export interface LemonstoneDB {
  auth: {
    key: string;
    value: AuthRecord;
  };
  notes: {
    key: string;
    value: NoteRecord;
    indexes: { updatedAt: number; sha: string };
  };
  canvas: {
    key: string;
    value: CanvasRecord;
  };
  attachments: {
    key: string;
    value: AttachmentRecord;
  };
  "indexes-snapshot": {
    key: string;
    value: IndexesSnapshotRecord;
  };
  config: {
    key: string;
    value: ConfigRecord;
  };
}
