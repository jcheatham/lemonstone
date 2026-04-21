import "./ui/ls-app.ts";
import "./ui/ls-toast.ts";
import { vaultService } from "./vault/index.ts";

// Request persistent storage on first launch so IndexedDB data survives
// browser eviction pressure.
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {
    // Non-fatal; the UI will warn in settings if the grant was denied.
  });
}

// Initialize the vault: rebuild in-memory indexes and wire sync events.
// Non-blocking — the UI renders while indexes load in the background.
vaultService.init().catch(console.error);
