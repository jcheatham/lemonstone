// Hash-based router. Route format: #/note/<encoded-path>
// Dispatches a "route" CustomEvent on window with { detail: Route }.

export type Route =
  | { type: "note"; path: string }
  | { type: "home" };

export function currentRoute(): Route {
  return parseHash(location.hash);
}

export function navigateTo(path: string): void {
  location.hash = `/note/${encodeURIComponent(path)}`;
}

export function navigateHome(): void {
  location.hash = "";
}

function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, "");
  if (clean.startsWith("note/")) {
    const encoded = clean.slice(5);
    try {
      return { type: "note", path: decodeURIComponent(encoded) };
    } catch {
      return { type: "home" };
    }
  }
  return { type: "home" };
}

window.addEventListener("hashchange", () => {
  window.dispatchEvent(
    new CustomEvent("route", { detail: currentRoute(), bubbles: false })
  );
});
