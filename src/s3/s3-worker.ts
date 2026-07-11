// S3 Worker — entry point. All SigV4 signing / AWS SDK calls run here; the
// raw AWS credential never touches the main thread beyond the single
// `openSession` postMessage that hands it over (see s3-client.ts). Mirrors
// src/sync/sync-worker.ts's shape deliberately.
//
// Multi-tenant: keeps one `S3Session` per activated card (lazy-init via
// `openSession`). Every op except `openSession`/`testConnection` carries a
// `cardId` in its args; the worker looks up the matching session and
// dispatches to it. `closeSession` drops it.

// @aws-sdk/client-s3's browser XML parser (S3's wire format is REST-XML)
// calls `new DOMParser()` and references the `Node.ELEMENT_NODE`/`TEXT_NODE`
// constants — both DOM/Window APIs a plain Worker global scope doesn't have
// (confirmed: HeadBucket, which has no XML body, works fine; any call whose
// response has a body — ListObjectsV2 etc. — throws "DOMParser is not
// defined" without this). Polyfilled here the same way sync-worker.ts
// polyfills `Buffer` for isomorphic-git's Node-isms.
import { DOMParser } from "@xmldom/xmldom";
(globalThis as unknown as Record<string, unknown>).DOMParser = DOMParser;
(globalThis as unknown as Record<string, unknown>).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

import { S3Session, type S3SessionConfig } from "./s3-session.ts";
import type { S3Credential } from "./credential.ts";
import type { S3WorkerRequest, S3WorkerResponse, S3WorkerError, S3WorkerEvent } from "./s3-protocol.ts";

const sessions = new Map<string, S3Session>();

function ok(id: string, result: Record<string, unknown> = {}): S3WorkerResponse {
  return { id, ok: true, result };
}

function err(id: string, code: string, message: string, retryable = false): S3WorkerError {
  return { id, ok: false, error: { code, message, retryable } };
}

function emit(event: S3WorkerEvent["event"], data: Record<string, unknown>): void {
  const message: S3WorkerEvent = { event, data };
  self.postMessage(message);
}

function requireCardId(args: Record<string, unknown>): string {
  const id = args["cardId"];
  if (typeof id !== "string" || !id) throw new Error("missing cardId in op args");
  return id;
}

function requireSession(cardId: string): S3Session {
  const session = sessions.get(cardId);
  if (!session) throw new Error(`no session for card ${cardId}; call openSession first`);
  return session;
}

function requireCredential(args: Record<string, unknown>): S3Credential {
  const credential = args["credential"];
  if (!credential || typeof credential !== "object") {
    throw new Error("missing credential in op args");
  }
  return credential as S3Credential;
}

self.addEventListener("message", async (e: MessageEvent<S3WorkerRequest>) => {
  const { id, op, args } = e.data;

  try {
    switch (op) {
      case "openSession": {
        const cardId = requireCardId(args);
        const bucket = args["bucket"] as string;
        const region = args["region"] as string;
        const endpoint = args["endpoint"] as string | undefined;
        const credential = requireCredential(args);
        if (!bucket || !region) {
          self.postMessage(err(id, "BAD_ARGS", "openSession requires bucket and region"));
          return;
        }
        sessions.get(cardId)?.destroy();
        const config: S3SessionConfig = {
          cardId,
          bucket,
          region,
          endpoint,
          credential,
          onRateLimited: (resumeAt) => emit("s3:rateLimited", { cardId, resumeAt }),
        };
        sessions.set(cardId, new S3Session(config));
        self.postMessage(ok(id));
        break;
      }

      case "closeSession": {
        const cardId = requireCardId(args);
        sessions.get(cardId)?.destroy();
        sessions.delete(cardId);
        emit("s3:sessionClosed", { cardId });
        self.postMessage(ok(id));
        break;
      }

      case "testConnection": {
        // Deliberately independent of the sessions map: this runs against
        // credentials the user just typed in, before anything is persisted.
        const bucket = args["bucket"] as string;
        const region = args["region"] as string;
        const endpoint = args["endpoint"] as string | undefined;
        const credential = requireCredential(args);
        const probe = new S3Session({ cardId: "__probe__", bucket, region, endpoint, credential });
        try {
          const result = await probe.testConnection();
          self.postMessage(ok(id, { probe: result }));
        } finally {
          // Never let cleanup fail after a response was already posted for
          // this request id — a second postMessage for the same id would be
          // silently dropped by the client, but only by luck of ordering.
          try {
            probe.destroy();
          } catch (destroyErr) {
            console.warn("[s3-worker] probe.destroy() failed:", destroyErr);
          }
        }
        break;
      }

      case "list": {
        const session = requireSession(requireCardId(args));
        const prefix = (args["prefix"] as string) ?? "";
        const continuationToken = args["continuationToken"] as string | undefined;
        const result = await session.list(prefix, continuationToken);
        self.postMessage(ok(id, { ...result }));
        break;
      }

      case "listAllUnderPrefix": {
        const session = requireSession(requireCardId(args));
        const prefix = (args["prefix"] as string) ?? "";
        const entries = await session.listAllUnderPrefix(prefix);
        self.postMessage(ok(id, { entries }));
        break;
      }

      case "getObject": {
        const session = requireSession(requireCardId(args));
        const key = args["key"] as string;
        const { bytes, contentType } = await session.getObject(key);
        self.postMessage(ok(id, { bytes, contentType }));
        break;
      }

      case "putObject": {
        const session = requireSession(requireCardId(args));
        const key = args["key"] as string;
        const bytes = args["bytes"] as Uint8Array;
        const contentType = args["contentType"] as string | undefined;
        await session.putObject(key, bytes, contentType);
        self.postMessage(ok(id));
        break;
      }

      case "createMultipartUpload": {
        const session = requireSession(requireCardId(args));
        const key = args["key"] as string;
        const contentType = args["contentType"] as string | undefined;
        const uploadId = await session.createMultipartUpload(key, contentType);
        self.postMessage(ok(id, { uploadId }));
        break;
      }

      case "uploadPart": {
        const session = requireSession(requireCardId(args));
        const key = args["key"] as string;
        const uploadId = args["uploadId"] as string;
        const partNumber = args["partNumber"] as number;
        const bytes = args["bytes"] as Uint8Array;
        const etag = await session.uploadPart(key, uploadId, partNumber, bytes);
        self.postMessage(ok(id, { etag }));
        break;
      }

      case "completeMultipartUpload": {
        const session = requireSession(requireCardId(args));
        const key = args["key"] as string;
        const uploadId = args["uploadId"] as string;
        const parts = args["parts"] as { PartNumber: number; ETag: string }[];
        await session.completeMultipartUpload(key, uploadId, parts);
        self.postMessage(ok(id));
        break;
      }

      case "abortMultipartUpload": {
        const session = requireSession(requireCardId(args));
        const key = args["key"] as string;
        const uploadId = args["uploadId"] as string;
        await session.abortMultipartUpload(key, uploadId);
        self.postMessage(ok(id));
        break;
      }

      case "copyObject": {
        const session = requireSession(requireCardId(args));
        const fromKey = args["fromKey"] as string;
        const toKey = args["toKey"] as string;
        await session.copyObject(fromKey, toKey);
        self.postMessage(ok(id));
        break;
      }

      case "uploadPartCopy": {
        const session = requireSession(requireCardId(args));
        const fromKey = args["fromKey"] as string;
        const toKey = args["toKey"] as string;
        const uploadId = args["uploadId"] as string;
        const partNumber = args["partNumber"] as number;
        const range = args["range"] as string;
        const etag = await session.uploadPartCopy(fromKey, toKey, uploadId, partNumber, range);
        self.postMessage(ok(id, { etag }));
        break;
      }

      case "deleteObject": {
        const session = requireSession(requireCardId(args));
        const key = args["key"] as string;
        await session.deleteObject(key);
        self.postMessage(ok(id));
        break;
      }

      case "deleteObjects": {
        const session = requireSession(requireCardId(args));
        const keys = args["keys"] as string[];
        await session.deleteObjects(keys);
        self.postMessage(ok(id));
        break;
      }

      default: {
        self.postMessage(err(id, "UNKNOWN_OP", `Unknown op: ${op as string}`, false));
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const code = e instanceof Error && e.name === "RequestBudgetExceededError" ? "BUDGET_EXCEEDED" : "S3_ERROR";
    self.postMessage(err(id, code, message, code === "S3_ERROR"));
  }
});

export {};
