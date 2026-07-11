// One authenticated session per activated card, living entirely inside the S3
// worker. Holds the raw @aws-sdk/client-s3 S3Client (and therefore the raw
// secretAccessKey, needed in memory to compute SigV4 signatures) — this must
// never be constructed or referenced from the main thread.

import {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  CopyObjectCommand,
  UploadPartCopyCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  type _Object,
  type CommonPrefix,
} from "@aws-sdk/client-s3";
import type { S3Credential } from "./credential.ts";
import { S3RateLimiter } from "./s3-rate-limiter.ts";

/** Soft per-card request budget over the rate limiter's rolling window — a
 *  self-imposed guardrail, not an AWS-enforced limit. */
const REQUEST_BUDGET_PER_WINDOW = 300;

export interface S3SessionConfig {
  cardId: string;
  bucket: string;
  region: string;
  credential: S3Credential;
  endpoint?: string;
  onRateLimited?: (resumeAt: number) => void;
}

export interface S3ListEntry {
  key: string;
  kind: "object" | "prefix";
  size?: number;
  lastModified?: number;
  etag?: string;
}

export interface S3ListResult {
  entries: S3ListEntry[];
  continuationToken?: string;
}

export interface ConnectionProbeResult {
  ok: boolean;
  step?: "headBucket" | "listObjects";
  errorName?: string;
  httpStatusCode?: number;
  message?: string;
}

export class RequestBudgetExceededError extends Error {
  constructor(cardId: string) {
    super(`S3 request budget exceeded for card ${cardId} — too many requests in the last minute`);
    this.name = "RequestBudgetExceededError";
  }
}

export class S3Session {
  readonly cardId: string;
  readonly bucket: string;
  private readonly client: S3Client;
  private readonly onRateLimited?: (resumeAt: number) => void;
  readonly rateLimiter = new S3RateLimiter();

  constructor(config: S3SessionConfig) {
    this.cardId = config.cardId;
    this.bucket = config.bucket;
    this.onRateLimited = config.onRateLimited;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.credential.accessKeyId,
        secretAccessKey: config.credential.secretAccessKey,
        sessionToken: config.credential.sessionToken,
      },
    });
  }

  /** Run an S3 SDK call with throttle-aware retry + the local request-budget guardrail. */
  private async withRateLimiting<T>(fn: () => Promise<T>): Promise<T> {
    if (this.rateLimiter.isOverBudget(REQUEST_BUDGET_PER_WINDOW)) {
      throw new RequestBudgetExceededError(this.cardId);
    }
    for (;;) {
      await this.rateLimiter.waitIfPaused(this.onRateLimited);
      this.rateLimiter.recordRequest();
      try {
        const result = await fn();
        this.rateLimiter.recordSuccess();
        return result;
      } catch (err) {
        const code = errorCode(err);
        if (S3RateLimiter.isThrottleError(code)) {
          this.rateLimiter.recordThrottle();
          continue;
        }
        throw err;
      }
    }
  }

  async testConnection(): Promise<ConnectionProbeResult> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      return probeFailure("headBucket", err);
    }
    try {
      await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }));
    } catch (err) {
      return probeFailure("listObjects", err);
    }
    return { ok: true };
  }

  /** One level only — never auto-recurse. `prefix` is the S3 "folder" to list. */
  async list(prefix: string, continuationToken?: string): Promise<S3ListResult> {
    return this.withRateLimiting(async () => {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          Delimiter: "/",
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        })
      );
      const entries: S3ListEntry[] = [
        ...(res.CommonPrefixes ?? []).map((p: CommonPrefix) => ({
          key: p.Prefix ?? "",
          kind: "prefix" as const,
        })),
        ...(res.Contents ?? [])
          .filter((o: _Object) => o.Key !== prefix) // exclude the folder placeholder object itself
          .map((o: _Object) => ({
            key: o.Key ?? "",
            kind: "object" as const,
            size: o.Size,
            lastModified: o.LastModified?.getTime(),
            etag: o.ETag,
          })),
      ];
      return { entries, continuationToken: res.NextContinuationToken };
    });
  }

  /**
   * Full recursive listing under a prefix (no Delimiter) — deliberately
   * different from list(): this is for an explicit, user-confirmed bulk
   * operation (folder delete/rename), never for tree browsing, since it can
   * issue many paginated requests against a large prefix. Capped so a
   * pathologically large prefix fails loudly rather than looping forever.
   */
  async listAllUnderPrefix(prefix: string, cap = 50_000): Promise<{ key: string; size: number }[]> {
    return this.withRateLimiting(async () => {
      const out: { key: string; size: number }[] = [];
      let continuationToken: string | undefined;
      do {
        const res = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
          })
        );
        for (const o of res.Contents ?? []) {
          if (!o.Key) continue;
          out.push({ key: o.Key, size: o.Size ?? 0 });
          if (out.length > cap) {
            throw new Error(`"${prefix}" has more than ${cap} objects — too large for a single bulk operation.`);
          }
        }
        continuationToken = res.NextContinuationToken;
      } while (continuationToken);
      return out;
    });
  }

  async getObject(key: string): Promise<{ bytes: Uint8Array; contentType?: string }> {
    return this.withRateLimiting(async () => {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await res.Body!.transformToByteArray();
      return { bytes, contentType: res.ContentType };
    });
  }

  async putObject(key: string, bytes: Uint8Array, contentType?: string): Promise<void> {
    await this.withRateLimiting(() =>
      this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType })
      )
    );
  }

  async createMultipartUpload(key: string, contentType?: string): Promise<string> {
    const res = await this.withRateLimiting(() =>
      this.client.send(
        new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType })
      )
    );
    if (!res.UploadId) throw new Error("createMultipartUpload: no UploadId returned");
    return res.UploadId;
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    bytes: Uint8Array
  ): Promise<string> {
    const res = await this.withRateLimiting(() =>
      this.client.send(
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: bytes,
        })
      )
    );
    if (!res.ETag) throw new Error("uploadPart: no ETag returned");
    return res.ETag;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { PartNumber: number; ETag: string }[]
  ): Promise<void> {
    await this.withRateLimiting(() =>
      this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        })
      )
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.withRateLimiting(() =>
      this.client.send(
        new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId })
      )
    );
  }

  async copyObject(fromKey: string, toKey: string): Promise<void> {
    await this.withRateLimiting(() =>
      this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: toKey,
          CopySource: `/${this.bucket}/${encodeURIComponent(fromKey)}`,
        })
      )
    );
  }

  async uploadPartCopy(
    fromKey: string,
    toKey: string,
    uploadId: string,
    partNumber: number,
    range: string
  ): Promise<string> {
    const res = await this.withRateLimiting(() =>
      this.client.send(
        new UploadPartCopyCommand({
          Bucket: this.bucket,
          Key: toKey,
          UploadId: uploadId,
          PartNumber: partNumber,
          CopySource: `/${this.bucket}/${encodeURIComponent(fromKey)}`,
          CopySourceRange: range,
        })
      )
    );
    const etag = res.CopyPartResult?.ETag;
    if (!etag) throw new Error("uploadPartCopy: no ETag returned");
    return etag;
  }

  async deleteObject(key: string): Promise<void> {
    await this.withRateLimiting(() =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
    );
  }

  async deleteObjects(keys: string[]): Promise<void> {
    await this.withRateLimiting(() =>
      this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        })
      )
    );
  }

  destroy(): void {
    this.client.destroy();
  }
}

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  return (e["name"] as string) ?? (e["Code"] as string) ?? undefined;
}

function probeFailure(step: "headBucket" | "listObjects", err: unknown): ConnectionProbeResult {
  // Logged (not just classified) because the classifier's buckets are a
  // best-effort guess at AWS's error vocabulary — the full error object,
  // visible in devtools under this worker's console, is the ground truth
  // when a failure doesn't fit a known category cleanly.
  console.warn(`[s3-session] testConnection ${step} failed:`, err);
  const e = err as Record<string, unknown> | undefined;
  return {
    ok: false,
    step,
    errorName: (e?.["name"] as string) ?? undefined,
    httpStatusCode: (e?.["$metadata"] as Record<string, unknown> | undefined)?.["httpStatusCode"] as
      | number
      | undefined,
    message: err instanceof Error ? err.message : String(err),
  };
}
