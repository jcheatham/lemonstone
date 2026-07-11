// Worker protocol types for main ↔ S3 Worker communication. Mirrors
// src/sync/protocol.ts's shape deliberately, so the two workers read the same way.
//
// The worker is multi-tenant: it holds a map of per-card S3Session instances,
// one per activated card. `openSession` primes a new instance (this is the ONLY
// op that carries a plaintext AWS credential — see s3-client.ts for the
// once-per-unlock-session hand-off contract); `closeSession` drops it. Every
// other op carries a `cardId` so the worker can route to the right session.

export type S3Op =
  | "openSession"
  | "closeSession"
  | "testConnection"
  | "list"
  | "listAllUnderPrefix"
  | "getObject"
  | "putObject"
  | "createMultipartUpload"
  | "uploadPart"
  | "completeMultipartUpload"
  | "abortMultipartUpload"
  | "copyObject"
  | "uploadPartCopy"
  | "deleteObject"
  | "deleteObjects";

export interface S3WorkerRequest {
  id: string;
  op: S3Op;
  args: Record<string, unknown>;
}

export interface S3WorkerResponse {
  id: string;
  ok: true;
  result: Record<string, unknown>;
}

export interface S3WorkerError {
  id: string;
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export type S3EventType = "s3:uploadProgress" | "s3:rateLimited" | "s3:sessionClosed";

export interface S3WorkerEvent {
  event: S3EventType;
  /** Engine-side ops always tag cardId into `data`. */
  data: Record<string, unknown>;
}
