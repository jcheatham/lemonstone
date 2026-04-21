// Autocomplete for [[wikilinks]]: triggers on [[ and offers vault note paths.

import {
  autocompletion,
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { WikilinkResolver } from "../../vault/wikilink-resolver.ts";

// Injected by the editor; avoids a hard dependency on the vaultService singleton
// so the editor stays testable in isolation.
let resolver: WikilinkResolver | null = null;

export function setWikilinkResolver(r: WikilinkResolver): void {
  resolver = r;
}

function basenameNoExt(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function wikilinkCompletionSource(
  ctx: CompletionContext
): CompletionResult | null {
  if (!resolver) return null;

  // Match from [[ up to the cursor, allowing letters, spaces, slashes.
  const before = ctx.matchBefore(/\[\[[^\]]*$/);
  if (!before || (!ctx.explicit && before.text.length < 3)) return null;

  const query = before.text.slice(2).toLowerCase(); // text after [[
  const paths = resolver.allPaths;

  const options = paths
    .filter((p) => p.endsWith(".md"))
    .map((p) => {
      const base = basenameNoExt(p);
      return {
        label: base,
        detail: p,
        apply: `${base}]]`,
        boost: base.toLowerCase().startsWith(query) ? 1 : 0,
      };
    })
    .filter((o) => !query || o.label.toLowerCase().includes(query))
    .sort((a, b) => b.boost - a.boost || a.label.localeCompare(b.label))
    .slice(0, 50);

  if (options.length === 0) return null;

  return {
    from: before.from + 2, // start after [[
    options,
    filter: false, // we already filtered
  };
}

export const wikilinkAutocomplete = autocompletion({
  override: [wikilinkCompletionSource],
  activateOnTyping: true,
  closeOnBlur: true,
});
