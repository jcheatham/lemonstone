// Sync Engine Web Worker — entry point.
// All git operations run here; never on the main thread.

// isomorphic-git relies on Node's Buffer global; polyfill it for the worker context.
import { Buffer } from "buffer";
(globalThis as unknown as Record<string, unknown>).Buffer = Buffer;

import { SyncEngine } from "./sync-engine.ts";
import type { WorkerRequest, WorkerResponse, WorkerError } from "./protocol.ts";

const engine = new SyncEngine();
let ready = engine.init().catch((err) => {
  console.error("[sync-worker] init failed:", err);
});

function ok(id: string, result: Record<string, unknown> = {}): WorkerResponse {
  return { id, ok: true, result };
}

function err(
  id: string,
  code: string,
  message: string,
  retryable = false
): WorkerError {
  return { id, ok: false, error: { code, message, retryable } };
}

self.addEventListener("message", async (e: MessageEvent<WorkerRequest>) => {
  const { id, op, args } = e.data;

  // Ensure init has completed before handling any op.
  try {
    await ready;
  } catch {
    self.postMessage(err(id, "INIT_FAILED", "Sync engine failed to initialize"));
    return;
  }

  try {
    switch (op) {
      case "clone": {
        await engine.clone();
        self.postMessage(ok(id));
        break;
      }

      case "sync": {
        await engine.sync();
        self.postMessage(ok(id));
        break;
      }

      case "getStatus": {
        // Basic status — expand in M4 when VaultService is wired.
        self.postMessage(ok(id, { status: "idle" }));
        break;
      }

      case "resolveConflict": {
        const path = args["path"] as string;
        await engine.resolveConflict(path);
        self.postMessage(ok(id));
        break;
      }

      case "forcePull": {
        await engine.forcePull();
        self.postMessage(ok(id));
        break;
      }

      case "forcePush": {
        await engine.forcePush();
        self.postMessage(ok(id));
        break;
      }

      default: {
        self.postMessage(
          err(id, "UNKNOWN_OP", `Unknown op: ${op as string}`, false)
        );
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const code =
      message.includes("authenticated") || message.includes("token")
        ? "AUTH_ERROR"
        : "SYNC_ERROR";
    self.postMessage(err(id, code, message, code === "SYNC_ERROR"));
  }
});

export {};
