// Promise-based client for the S3 Worker. Wraps postMessage in
// request/response with correlation IDs. Mirrors src/sync/sync-client.ts's
// shape deliberately.
//
// Named S3CardClient (not S3Client) to avoid colliding with
// @aws-sdk/client-s3's own S3Client, which this file never imports — the SDK
// only ever runs inside the worker (src/s3/s3-worker.ts).

import type {
  S3WorkerRequest,
  S3WorkerResponse,
  S3WorkerError,
  S3WorkerEvent,
  S3Op,
  S3EventType,
} from "./s3-protocol.ts";
import type { S3Credential } from "./credential.ts";

type Resolver = {
  resolve: (r: S3WorkerResponse) => void;
  reject: (e: S3WorkerError) => void;
};

const EVENT_TYPES: S3EventType[] = ["s3:uploadProgress", "s3:rateLimited", "s3:sessionClosed"];

/** Shared worker instance — one per tab. Multiple S3CardClient facades can
 *  bind to it, each scoped to a single activated card. */
class S3WorkerBus extends EventTarget {
  readonly worker: Worker;
  private readonly pending = new Map<string, Resolver>();

  constructor() {
    super();
    this.worker = new Worker(new URL("./s3-worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener(
      "message",
      (e: MessageEvent<S3WorkerResponse | S3WorkerError | S3WorkerEvent>) => {
        this.handleMessage(e.data);
      }
    );
  }

  private handleMessage(msg: S3WorkerResponse | S3WorkerError | S3WorkerEvent): void {
    if ("event" in msg) {
      this.dispatchEvent(Object.assign(new Event(msg.event), { detail: msg.data }));
      return;
    }
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.ok) {
      pending.resolve(msg);
    } else {
      pending.reject(msg as S3WorkerError);
    }
  }

  call(op: S3Op, args: Record<string, unknown> = {}): Promise<S3WorkerResponse> {
    const id = crypto.randomUUID();
    const request: S3WorkerRequest = { id, op, args };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(request);
    });
  }
}

let sharedBus: S3WorkerBus | null = null;
function getBus(): S3WorkerBus {
  if (!sharedBus) sharedBus = new S3WorkerBus();
  return sharedBus;
}

/** Per-card facade. Each call auto-tags cardId so the worker can route it.
 *  Events from the worker are re-dispatched only when they match this card. */
export class S3CardClient extends EventTarget {
  private readonly bus = getBus();
  private readonly forwardListener: (e: Event) => void;

  constructor(private readonly cardId: string) {
    super();
    this.forwardListener = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cardId?: string } | undefined;
      if (detail?.cardId && detail.cardId !== this.cardId) return;
      this.dispatchEvent(Object.assign(new Event(e.type), { detail }));
    };
    for (const type of EVENT_TYPES) this.bus.addEventListener(type, this.forwardListener);
  }

  /** Detach this facade's listeners from the shared bus. Call on card close. */
  dispose(): void {
    for (const type of EVENT_TYPES) this.bus.removeEventListener(type, this.forwardListener);
  }

  private call(op: S3Op, args: Record<string, unknown> = {}): Promise<S3WorkerResponse> {
    return this.bus.call(op, { ...args, cardId: this.cardId });
  }

  /**
   * Hand the plaintext credential to the worker exactly once. Callers must
   * not retain `credential` in long-lived state after this resolves — the
   * whole point of this boundary is that the secret lives in the worker only.
   */
  async openSession(bucket: string, region: string, credential: S3Credential, endpoint?: string): Promise<void> {
    await this.call("openSession", { bucket, region, credential, endpoint });
  }

  async closeSession(): Promise<void> {
    await this.call("closeSession", {});
  }

  async list(prefix: string, continuationToken?: string): Promise<S3WorkerResponse["result"]> {
    const res = await this.call("list", { prefix, continuationToken });
    return res.result;
  }

  async getObject(key: string): Promise<S3WorkerResponse["result"]> {
    const res = await this.call("getObject", { key });
    return res.result;
  }

  /** Full recursive listing under a prefix — only for explicit bulk ops (folder delete/rename). */
  async listAllUnderPrefix(prefix: string): Promise<{ key: string; size: number }[]> {
    const res = await this.call("listAllUnderPrefix", { prefix });
    return res.result["entries"] as { key: string; size: number }[];
  }

  async putObject(key: string, bytes: Uint8Array, contentType?: string): Promise<void> {
    await this.call("putObject", { key, bytes, contentType });
  }

  async deleteObject(key: string): Promise<void> {
    await this.call("deleteObject", { key });
  }

  async deleteObjects(keys: string[]): Promise<void> {
    await this.call("deleteObjects", { keys });
  }

  async createMultipartUpload(key: string, contentType?: string): Promise<string> {
    const res = await this.call("createMultipartUpload", { key, contentType });
    return res.result["uploadId"] as string;
  }

  async uploadPart(key: string, uploadId: string, partNumber: number, bytes: Uint8Array): Promise<string> {
    const res = await this.call("uploadPart", { key, uploadId, partNumber, bytes });
    return res.result["etag"] as string;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { PartNumber: number; ETag: string }[]
  ): Promise<void> {
    await this.call("completeMultipartUpload", { key, uploadId, parts });
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.call("abortMultipartUpload", { key, uploadId });
  }

  async copyObject(fromKey: string, toKey: string): Promise<void> {
    await this.call("copyObject", { fromKey, toKey });
  }

  async uploadPartCopy(
    fromKey: string,
    toKey: string,
    uploadId: string,
    partNumber: number,
    range: string
  ): Promise<string> {
    const res = await this.call("uploadPartCopy", { fromKey, toKey, uploadId, partNumber, range });
    return res.result["etag"] as string;
  }
}

/**
 * One-off connection test against not-yet-persisted credentials. Deliberately
 * bypasses S3CardClient (there's no cardId yet — nothing has been saved).
 */
export async function testS3Connection(
  bucket: string,
  region: string,
  credential: S3Credential,
  endpoint?: string
): Promise<S3WorkerResponse["result"]> {
  const res = await getBus().call("testConnection", { bucket, region, credential, endpoint });
  return res.result;
}
