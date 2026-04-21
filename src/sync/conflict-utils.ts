// Conflict file naming and preservation utilities (§6.4, §6.7).
//
// In v1 (identity codec) the 3-way merge path is always taken and these
// helpers are never invoked at runtime. They MUST be implemented and tested
// in v1 so that v2 (encryption) is a policy flip, not new code.

/**
 * Produce the sibling path for a preserved conflict loser.
 *
 * Examples:
 *   notes/project.md, 2026-04-20T14:22:00Z
 *   → notes/project.conflict-2026-04-20T14-22-00Z.md
 *
 *   daily/2026-04-20.md, 2026-04-20T14:22:00Z
 *   → daily/2026-04-20.conflict-2026-04-20T14-22-00Z.md
 *
 *   attachments/image.png, 2026-04-20T14:22:00Z
 *   → attachments/image.conflict-2026-04-20T14-22-00Z.png
 */
export function makeConflictPath(originalPath: string, timestamp: Date): string {
  const iso = timestamp
    .toISOString()
    .replace(/:/g, "-")   // colons → dashes (filesystem safe)
    .replace(/\.\d+Z$/, "Z"); // drop milliseconds: .000Z → Z

  const lastSlash = originalPath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? originalPath.slice(0, lastSlash + 1) : "";
  const filename = lastSlash >= 0 ? originalPath.slice(lastSlash + 1) : originalPath;

  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) {
    // No extension or hidden file (starts with dot)
    return `${dir}${filename}.conflict-${iso}`;
  }
  const base = filename.slice(0, lastDot);
  const ext = filename.slice(lastDot); // includes the dot
  return `${dir}${base}.conflict-${iso}${ext}`;
}

/**
 * True if a path looks like a conflict-preservation sibling.
 * Used to filter these out of normal vault listings.
 */
export function isConflictPath(path: string): boolean {
  return /\.conflict-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z/.test(path);
}
