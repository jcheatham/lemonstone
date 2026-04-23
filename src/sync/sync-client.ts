// Promise-based client for the Sync Engine Web Worker.
// Wraps postMessage in request/response with correlation IDs.

import type {
  WorkerRequest,
  WorkerResponse,
  WorkerError,
  WorkerEvent,
  SyncOp,
  SyncEventType,
} from "./protocol.ts";

type Resolver = {
  resolve: (r: WorkerResponse) => void;
  reject: (e: WorkerError) => void;
};

/** Shared worker instance — one per tab. Multiple SyncClient facades can
 *  bind to it, each scoped to a single vault. */
class WorkerBus extends EventTarget {
  readonly worker: Worker;
  private readonly pending = new Map<string, Resolver>();

  constructor() {
    super();
    this.worker = new Worker(
      new URL("./sync-worker.ts", import.meta.url),
      { type: "module" }
    );
    this.worker.addEventListener(
      "message",
      (e: MessageEvent<WorkerResponse | WorkerError | WorkerEvent>) => {
        this.handleMessage(e.data);
      }
    );
  }

  private handleMessage(msg: WorkerResponse | WorkerError | WorkerEvent): void {
    if ("event" in msg) {
      this.dispatchEvent(
        Object.assign(new Event(msg.event as SyncEventType), { detail: msg.data })
      );
      return;
    }
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.ok) {
      pending.resolve(msg);
    } else {
      pending.reject(msg as WorkerError);
    }
  }

  call(op: SyncOp, args: Record<string, unknown> = {}): Promise<WorkerResponse> {
    const id = crypto.randomUUID();
    const request: WorkerRequest = { id, op, args };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(request);
    });
  }
}

let sharedBus: WorkerBus | null = null;
function getBus(): WorkerBus {
  if (!sharedBus) sharedBus = new WorkerBus();
  return sharedBus;
}

/** Per-vault facade. Each call auto-tags vaultId so the worker can route it.
 *  Events from the worker are re-dispatched only when they match this vault. */
export class SyncClient extends EventTarget {
  private readonly bus = getBus();
  private readonly forwardListener: (e: Event) => void;

  constructor(private readonly vaultId: string) {
    super();
    this.forwardListener = (e: Event) => {
      const detail = (e as CustomEvent).detail as { vaultId?: string } | undefined;
      // Events from the engine carry their own vaultId; only fire for ours.
      // Undefined vaultId is treated as "any" for backward-compat safety.
      if (detail?.vaultId && detail.vaultId !== this.vaultId) return;
      this.dispatchEvent(Object.assign(new Event(e.type), { detail }));
    };
    for (const type of ["syncStarted", "syncProgress", "syncCompleted", "conflictDetected", "authRequired", "rateLimited"] as SyncEventType[]) {
      this.bus.addEventListener(type, this.forwardListener);
    }
  }

  /** Detach this facade's listeners from the shared bus. Call on vault close. */
  dispose(): void {
    for (const type of ["syncStarted", "syncProgress", "syncCompleted", "conflictDetected", "authRequired", "rateLimited"] as SyncEventType[]) {
      this.bus.removeEventListener(type, this.forwardListener);
    }
  }

  call(op: SyncOp, args: Record<string, unknown> = {}): Promise<WorkerResponse> {
    return this.bus.call(op, { ...args, vaultId: this.vaultId });
  }
}

/** One-off calls that don't need a specific vault (currently unused — openVault
 *  / closeVault are sent via this anonymous path). */
export function callWorker(op: SyncOp, args: Record<string, unknown> = {}): Promise<WorkerResponse> {
  return getBus().call(op, args);
}
