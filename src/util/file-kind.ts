// Consolidated vault-path → file-kind mapping. Folders aren't paths to a
// file, so callers that already know they have a folder should use the
// `"folder"` TargetKind directly rather than calling this.

export function fileKind(path: string): "note" | "canvas" | "snippet" {
  if (path.endsWith(".canvas")) return "canvas";
  if (path.toLowerCase().endsWith(".html")) return "snippet";
  return "note";
}
