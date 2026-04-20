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

export class SyncClient extends EventTarget {
  private readonly worker: Worker;
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

export const syncClient = new SyncClient();
