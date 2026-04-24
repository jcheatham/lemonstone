// Hash-based router with vault-scoped routes.
//
// Shape:
//   #/vaults                         — vault list / empty state
//   #/v/<vaultId>                    — current vault home
//   #/v/<vaultId>/note/<encoded>     — note inside a vault
//   #                                 — legacy home (redirect to current vault on route dispatch)
//
// Dispatches a "route" CustomEvent on window with { detail: Route }.

export type Route =
  | { type: "home" }
  | { type: "vaults" }
  | { type: "vault"; vaultId: string }
  | { type: "note"; vaultId: string; path: string }
  | { type: "share"; blob: string };

export function currentRoute(): Route {
  return parseHash(location.hash);
}

/** Navigate to a note within a given vault. */
export function navigateToNote(vaultId: string, path: string): void {
  location.hash = `/v/${encodeURIComponent(vaultId)}/note/${encodeURIComponent(path)}`;
}

/** Navigate to a vault's home (no active note). */
export function navigateToVault(vaultId: string): void {
  location.hash = `/v/${encodeURIComponent(vaultId)}`;
}

/** Navigate to the top-level Vaults list. */
export function navigateToVaults(): void {
  location.hash = "/vaults";
}

/** Navigate to a share-link route. Mostly useful for testing — recipients
 *  arrive at this route organically from a link outside the app. */
export function navigateToShare(blob: string): void {
  location.hash = `/share/${encodeURIComponent(blob)}`;
}

// Router-side view of "current vault." Populated by the multiplexer on
// open/close; reading this keeps existing `navigateTo(path)` callsites
// working without each one having to thread a vaultId.
let _currentVaultId: string | null = null;
export function setRouterCurrentVault(id: string | null): void {
  _currentVaultId = id;
}
export function getRouterCurrentVault(): string | null {
  return _currentVaultId;
}

/** Legacy callers that still pass just a path. Uses the router's current
 *  vault; if none, redirects to `#/vaults`. */
export function navigateTo(path: string, vaultId?: string): void {
  const id = vaultId ?? _currentVaultId;
  if (id) {
    navigateToNote(id, path);
  } else {
    navigateToVaults();
  }
}

export function navigateHome(): void {
  // "Home" in multi-vault = current vault's home, or the vaults list if
  // nothing is active.
  if (_currentVaultId) {
    navigateToVault(_currentVaultId);
  } else {
    navigateToVaults();
  }
}

function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, "");
  if (clean === "" || clean === "/") return { type: "home" };
  if (clean === "vaults") return { type: "vaults" };
  if (clean.startsWith("share/")) {
    const encoded = clean.slice("share/".length);
    try { return { type: "share", blob: decodeURIComponent(encoded) }; }
    catch { return { type: "vaults" }; }
  }
  if (clean.startsWith("v/")) {
    const rest = clean.slice(2);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      try { return { type: "vault", vaultId: decodeURIComponent(rest) }; }
      catch { return { type: "vaults" }; }
    }
    const vaultId = decodeURIComponent(rest.slice(0, slash));
    const afterId = rest.slice(slash + 1);
    if (afterId.startsWith("note/")) {
      const encoded = afterId.slice(5);
      try { return { type: "note", vaultId, path: decodeURIComponent(encoded) }; }
      catch { return { type: "vault", vaultId }; }
    }
    return { type: "vault", vaultId };
  }
  // Anything else — including legacy `#/note/…` — treated as home and resolved
  // downstream. Legacy bookmarks were invalidated by the multi-vault rollout.
  return { type: "home" };
}

window.addEventListener("hashchange", () => {
  window.dispatchEvent(
    new CustomEvent("route", { detail: currentRoute(), bubbles: false })
  );
});
