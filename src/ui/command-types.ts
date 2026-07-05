// Shared command/category vocabulary used by <ls-command-palette>, the
// Commands category panel, and <ls-context-menu>. Kept dependency-free so
// none of those components need to import from one another.

export type TargetKind = "note" | "canvas" | "snippet" | "folder";

export interface CommandTarget {
  path: string;
  kind: TargetKind;
}

export type CommandCategory = "file" | "folder" | "navigation" | "vault" | "canvas" | "global";

export const CATEGORY_ORDER: CommandCategory[] = [
  "file",
  "folder",
  "navigation",
  "vault",
  "canvas",
  "global",
];

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  file: "File",
  folder: "Folder",
  navigation: "Navigate",
  vault: "Vault & Sync",
  canvas: "Canvas",
  global: "General",
};

export interface PaletteCommand {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  category: CommandCategory;
  /** Gates inclusion in a context menu for a specific file-tree row. Commands
   *  without this predicate are palette/Commands-panel-only (e.g. sync,
   *  quick-open) and never appear in a right-click/"..." menu. */
  isApplicable?(target: CommandTarget): boolean;
}

/** Buckets items by `category`, in `CATEGORY_ORDER`, dropping empty buckets. */
export function groupByCategory<T extends { category: CommandCategory }>(
  items: readonly T[]
): Array<{ category: CommandCategory; items: T[] }> {
  const buckets = new Map<CommandCategory, T[]>();
  for (const item of items) {
    const bucket = buckets.get(item.category);
    if (bucket) bucket.push(item);
    else buckets.set(item.category, [item]);
  }
  return CATEGORY_ORDER.filter((c) => buckets.has(c)).map((c) => ({
    category: c,
    items: buckets.get(c)!,
  }));
}
