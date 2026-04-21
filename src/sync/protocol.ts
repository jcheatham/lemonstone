// Worker protocol types for main ↔ Sync Engine communication.

export type SyncOp =
  | "clone"
  | "sync"
  | "getStatus"
  | "resolveConflict";

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
  data: Record<string, unknown>;
}
