import "./ui/ls-app.ts";
import "./ui/ls-toast.ts";

// Request persistent storage on first launch so IndexedDB data survives
// browser eviction pressure.
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {
    // Non-fatal; the UI will warn in settings if the grant was denied.
  });
}
