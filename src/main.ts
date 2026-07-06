import "./ui/ls-app.ts";
import "./ui/ls-toast.ts";
import { multiplexer } from "./vault/index.ts";
import { boot } from "./vault/boot.ts";
import { signalBootComplete } from "./vault/boot-gate.ts";
import { initPwa } from "./pwa.ts";

// Request persistent storage on first launch so IndexedDB data survives
// browser eviction pressure.
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {
    // Non-fatal; the UI will warn in settings if the grant was denied.
  });
}

// First-launch wipe of any pre-multi-vault install, then attempt to open
// the last-used vault. Both are best-effort — the UI renders either way
// and will route to the empty Vaults list when there's nothing to open.
// <ls-app>#init() awaits signalBootComplete() before inspecting
// multiplexer.currentVault — see src/vault/boot-gate.ts for why that's load
// bearing rather than cosmetic.
(async () => {
  try {
    await boot();
    try {
      await multiplexer.openLastUsed();
    } catch (err) {
      console.warn("[main] openLastUsed failed:", err);
    }
  } finally {
    signalBootComplete();
  }
})();

// Register the service worker and wire install/update UX.
initPwa();
