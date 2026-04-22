// PWA glue: service-worker registration, update-available UX, and install
// prompt capture. Wired up once from main.ts on startup.

import { registerSW } from "virtual:pwa-register";
import { getToast } from "./ui/ls-toast.ts";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

export function initPwa(): void {
  // Stash the install prompt so a palette command can trigger it later.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e as BeforeInstallPromptEvent;
  });

  // When the user accepts an install, the browser fires `appinstalled`.
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    getToast().show("Lemonstone installed.", "success");
  });

  // Register the service worker. `prompt` type means new versions don't
  // auto-activate — we show a toast and let the user decide.
  const updateSW = registerSW({
    onNeedRefresh() {
      getToast().showAction(
        "A new version of Lemonstone is available.",
        "Reload",
        () => updateSW(true),
        "info"
      );
    },
    onOfflineReady() {
      getToast().show("Ready to work offline.", "success");
    },
  });
}

export function canInstall(): boolean {
  return deferredInstallPrompt !== null;
}

export async function triggerInstall(): Promise<boolean> {
  if (!deferredInstallPrompt) return false;
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome === "accepted";
}
