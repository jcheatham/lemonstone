// Wikilink resolution following Obsidian's algorithm (§7.2):
//   1. Exact basename match (case-sensitive)
//   2. Exact path match from vault root
//   3. Case-insensitive basename match
//   4. Unresolved

export class WikilinkResolver {
  /** basename (no ext, lowercased) → [full paths] — for case-insensitive lookup */
  private lowerIndex = new Map<string, string[]>();
  /** basename (no ext, original case) → [full paths] — for exact-case lookup */
  private exactIndex = new Map<string, string[]>();

  addPath(path: string): void {
    const base = basename(path);
    // Exact
    const exact = this.exactIndex.get(base) ?? [];
    if (!exact.includes(path)) exact.push(path);
    this.exactIndex.set(base, exact);
    // Case-insensitive
    const lower = base.toLowerCase();
    const lowerList = this.lowerIndex.get(lower) ?? [];
    if (!lowerList.includes(path)) lowerList.push(path);
    this.lowerIndex.set(lower, lowerList);
  }

  removePath(path: string): void {
    const base = basename(path);
    const exact = (this.exactIndex.get(base) ?? []).filter((p) => p !== path);
    if (exact.length) this.exactIndex.set(base, exact);
    else this.exactIndex.delete(base);

    const lower = base.toLowerCase();
    const lowerList = (this.lowerIndex.get(lower) ?? []).filter((p) => p !== path);
    if (lowerList.length) this.lowerIndex.set(lower, lowerList);
    else this.lowerIndex.delete(lower);
  }

  renamePath(oldPath: string, newPath: string): void {
    this.removePath(oldPath);
    this.addPath(newPath);
  }

  /**
   * Resolve a wikilink text (e.g. "My Note" or "folder/My Note") to a vault path.
   * Returns null if unresolved.
   */
  resolve(linkText: string, _fromPath?: string): string | null {
    // Step 1: exact basename match
    const exactList = this.exactIndex.get(linkText);
    if (exactList?.length) return exactList[0]!;

    // Step 2: exact path match (link text contains a slash)
    if (linkText.includes("/")) {
      const withExt = ensureMdExtension(linkText);
      const lower = linkText.toLowerCase();
      for (const paths of this.exactIndex.values()) {
        for (const p of paths) {
          if (p === withExt || p.endsWith(`/${withExt}`)) return p;
          if (p.toLowerCase().includes(lower)) return p;
        }
      }
    }

    // Step 3: case-insensitive basename match
    const lowerList = this.lowerIndex.get(linkText.toLowerCase());
    if (lowerList?.length) return lowerList[0]!;

    return null;
  }

  get allPaths(): string[] {
    const paths = new Set<string>();
    for (const list of this.exactIndex.values()) {
      for (const p of list) paths.add(p);
    }
    return Array.from(paths);
  }
}

function basename(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function ensureMdExtension(path: string): string {
  return path.includes(".") ? path : `${path}.md`;
}
