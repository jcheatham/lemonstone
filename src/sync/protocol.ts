// Worker protocol types for main ↔ Sync Engine communication.
//
// The worker is multi-tenant: it holds a map of per-vault SyncEngine
// instances. `openVault` primes a new instance; `closeVault` drops it.
// All content-level ops (sync, clone, readRepoFile, …) carry a vaultId
// so the worker can route to the right engine.

export type SyncOp =
  | "openVault"
  | "closeVault"
  | "clone"
  | "sync"
  | "getStatus"
  | "getHead"
  | "resolveConflict"
  | "forcePull"
  | "forcePush"
  | "recentCommits"
  | "commitDetails"
  | "restoreToCommit"
  | "readRepoFile"
  | "writeRepoFile";

export interface WorkerRequest {
  id: string;
  op: SyncOp;
  args: Record<string, unknown>;
}

export interface WorkerResponse {
  id: string;
  ok: true;
  result: Record<string, unknown>;
}

export interface WorkerError {
  id: string;
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export type SyncEventType =
  | "syncStarted"
  | "syncProgress"
  | "syncCompleted"
  | "conflictDetected"
  | "authRequired"
  | "rateLimited";

export interface WorkerEvent {
  event: SyncEventType;
  /** Engine-side ops always tag vaultId into `data`. */
  data: Record<string, unknown>;
}
