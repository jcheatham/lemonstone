// Coordinates startup ordering between main.ts and <ls-app>.
//
// index.html places <ls-app></ls-app> BEFORE main.ts's <script type="module">
// tag. main.ts's first statement is `import "./ui/ls-app.ts"`, and ES module
// imports evaluate before the importing module's own body runs — so defining
// the custom element there synchronously upgrades the already-parsed <ls-app>
// tag immediately, firing connectedCallback() (and its #init()) before any of
// main.ts's own top-level code — including the boot()+openLastUsed() call —
// has had a chance to run. Without this gate, <ls-app>#init() races
// main.ts's vault-opening sequence: whichever IndexedDB-bound chain happens
// to resolve first wins, so the outcome legitimately varies by browser/device.
// If #init() loses the race, it sees no current vault yet and takes its
// empty-state branch — which never calls vaultService.sync() — leaving the
// status bar stuck until some later event (e.g. a tab focus) happens to
// trigger a sync.
//
// <ls-app>#init() awaits `bootGate` before making any decision based on
// multiplexer.currentVault/currentVaultId; main.ts calls signalBootComplete()
// once its boot()+openLastUsed() sequence settles (success or failure).
let resolveBootGate!: () => void;
export const bootGate: Promise<void> = new Promise((resolve) => {
  resolveBootGate = resolve;
});

export function signalBootComplete(): void {
  resolveBootGate();
}
