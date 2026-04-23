// Sync Engine Web Worker — entry point.
// All git operations run here; never on the main thread.
//
// Multi-tenant: keeps one `SyncEngine` per configured vault (lazy-init).
// Every op except `openVault` carries a `vaultId` in its args; the worker
// looks up the matching engine and dispatches to it. `closeVault` drops
// the engine from the map (used on vault removal).

// isomorphic-git relies on Node's Buffer global; polyfill it for the worker context.
import { Buffer } from "buffer";
(globalThis as unknown as Record<string, unknown>).Buffer = Buffer;

import { SyncEngine, type SyncEngineConfig } from "./sync-engine.ts";
import type { WorkerRequest, WorkerResponse, WorkerError } from "./protocol.ts";

const engines = new Map<string, SyncEngine>();
const initPromises = new Map<string, Promise<void>>();

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

function requireVaultId(args: Record<string, unknown>): string {
  const id = args["vaultId"];
  if (typeof id !== "string" || !id) {
    throw new Error("missing vaultId in op args");
  }
  return id;
}

function requireEngine(vaultId: string): SyncEngine {
  const engine = engines.get(vaultId);
  if (!engine) {
    throw new Error(`no engine for vault ${vaultId}; call openVault first`);
  }
  return engine;
}

self.addEventListener("message", async (e: MessageEvent<WorkerRequest>) => {
  const { id, op, args } = e.data;

  try {
    switch (op) {
      case "openVault": {
        const config: SyncEngineConfig = {
          vaultId: requireVaultId(args),
          dbName: args["dbName"] as string,
          opfsDir: args["opfsDir"] as string,
        };
        if (!config.dbName || !config.opfsDir) {
          self.postMessage(err(id, "BAD_ARGS", "openVault requires dbName and opfsDir"));
          return;
        }
        if (!engines.has(config.vaultId)) {
          const engine = new SyncEngine(config);
          const init = engine.init();
          initPromises.set(config.vaultId, init);
          await init;
          engines.set(config.vaultId, engine);
        } else {
          // Already open — wait for pending init to avoid races.
          await initPromises.get(config.vaultId);
        }
        self.postMessage(ok(id));
        break;
      }

      case "closeVault": {
        const vaultId = requireVaultId(args);
        engines.delete(vaultId);
        initPromises.delete(vaultId);
        self.postMessage(ok(id));
        break;
      }

      case "clone": {
        await requireEngine(requireVaultId(args)).clone();
        self.postMessage(ok(id));
        break;
      }

      case "sync": {
        await requireEngine(requireVaultId(args)).sync();
        self.postMessage(ok(id));
        break;
      }

      case "getStatus": {
        // Basic status — expand in M4 when VaultService is wired.
        self.postMessage(ok(id, { status: "idle" }));
        break;
      }

      case "getHead": {
        const head = await requireEngine(requireVaultId(args)).getHead();
        self.postMessage(ok(id, { head }));
        break;
      }

      case "resolveConflict": {
        const path = args["path"] as string;
        await requireEngine(requireVaultId(args)).resolveConflict(path);
        self.postMessage(ok(id));
        break;
      }

      case "forcePull": {
        await requireEngine(requireVaultId(args)).forcePull();
        self.postMessage(ok(id));
        break;
      }

      case "forcePush": {
        await requireEngine(requireVaultId(args)).forcePush();
        self.postMessage(ok(id));
        break;
      }

      case "recentCommits": {
        const limit = typeof args["limit"] === "number" ? args["limit"] : 30;
        const commits = await requireEngine(requireVaultId(args)).recentCommits(limit);
        self.postMessage(ok(id, { commits }));
        break;
      }

      case "commitDetails": {
        const oid = args["oid"] as string;
        const details = await requireEngine(requireVaultId(args)).commitDetails(oid);
        self.postMessage(ok(id, { details }));
        break;
      }

      case "restoreToCommit": {
        const oid = args["oid"] as string;
        await requireEngine(requireVaultId(args)).restoreToCommit(oid);
        self.postMessage(ok(id));
        break;
      }

      case "readRepoFile": {
        const path = args["path"] as string;
        const bytes = await requireEngine(requireVaultId(args)).readRepoFile(path);
        self.postMessage(ok(id, { bytes }));
        break;
      }

      case "writeRepoFile": {
        const path = args["path"] as string;
        const bytes = args["bytes"] as Uint8Array;
        await requireEngine(requireVaultId(args)).writeRepoFile(path, bytes);
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
