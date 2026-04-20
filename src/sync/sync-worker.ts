// Sync Engine — runs in a dedicated Web Worker.
// Full implementation in M3; this stub establishes the message boundary.

import type { WorkerRequest, WorkerResponse, WorkerError } from "./protocol.ts";

function respond(res: WorkerResponse | WorkerError): void {
  self.postMessage(res);
}

self.addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
  const { id, op } = e.data;
  // Placeholder: all ops return not-implemented until M3.
  respond({
    id,
    ok: false,
    error: {
      code: "NOT_IMPLEMENTED",
      message: `Op '${op}' not yet implemented`,
      retryable: false,
    },
  });
});

export {};
