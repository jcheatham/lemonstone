import { describe, it, expect, beforeEach } from "vitest";
import { navigateToS3, navigateToVault, currentRoute, type Route } from "../src/ui/router.ts";

function collectRoutes(): { routes: Route[]; stop: () => void } {
  const routes: Route[] = [];
  const handler = (e: Event) => routes.push((e as CustomEvent<Route>).detail);
  window.addEventListener("route", handler);
  return { routes, stop: () => window.removeEventListener("route", handler) };
}

describe("router", () => {
  beforeEach(() => {
    location.hash = "";
  });

  it("dispatches a route event on a genuine navigation", async () => {
    const { routes, stop } = collectRoutes();
    navigateToVault("vault-a");
    // happy-dom dispatches native hashchange asynchronously (unlike the
    // explicit emitRoute() fallback below, which is synchronous) — give it a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(routes).toEqual([{ type: "vault", vaultId: "vault-a" }]);
    stop();
  });

  it("still dispatches a route event when navigating to the already-active route", () => {
    // Regression test: browsers don't fire hashchange when location.hash is
    // set to its current value, so re-clicking the same S3 card entry (or
    // reloading on a route that was already active) must not silently no-op.
    navigateToS3("vault-a", "card-1");
    const { routes, stop } = collectRoutes();
    navigateToS3("vault-a", "card-1"); // same route again — must still fire
    expect(routes).toEqual([{ type: "s3", vaultId: "vault-a", cardId: "card-1", prefix: "" }]);
    stop();
  });

  it("dispatches on every repeated navigation to the same route, not just the second", () => {
    navigateToS3("vault-a", "card-1");
    const { routes, stop } = collectRoutes();
    navigateToS3("vault-a", "card-1");
    navigateToS3("vault-a", "card-1");
    navigateToS3("vault-a", "card-1");
    expect(routes).toHaveLength(3);
    stop();
  });

  it("currentRoute reflects the route dispatched for a repeated navigation", () => {
    navigateToS3("vault-a", "card-1");
    navigateToS3("vault-a", "card-1");
    expect(currentRoute()).toEqual({ type: "s3", vaultId: "vault-a", cardId: "card-1", prefix: "" });
  });
});
