// Tag extraction per §7.3:
// - Inline #tag tokens from the Markdown body
// - tags: array from YAML frontmatter
//
// Exclusions: #-fragments inside URLs, text inside code fences or inline code.

/** Pattern for a valid tag: starts with letter/underscore, allows / for nesting. */
const TAG_PATTERN = /#([a-zA-Z_À-ɏ][a-zA-Z0-9_À-ɏ/-]*)/g;

/** Strips content that should not be scanned for tags. */
function stripNonTagContent(content: string): string {
  // Fenced code blocks (``` or ~~~)
  let s = content.replace(/^(`{3,}|~{3,})[\s\S]*?\1/gm, " ");
  // Inline code
  s = s.replace(/`[^`\n]+`/g, " ");
  // URLs — replace scheme+host+path so #-anchors are excluded
  s = s.replace(/https?:\/\/[^\s)>\]"']*/g, " ");
  return s;
}

export function extractInlineTags(body: string): string[] {
  const cleaned = stripNonTagContent(body);
  const tags = new Set<string>();
  let m: RegExpExecArray | null;
  // Reset lastIndex since TAG_PATTERN is module-level with /g flag.
  TAG_PATTERN.lastIndex = 0;
  while ((m = TAG_PATTERN.exec(cleaned)) !== null) {
    tags.add(m[1]!.toLowerCase());
  }
  return Array.from(tags);
}

export function extractFrontmatterTags(
  frontmatter: Record<string, unknown>
): string[] {
  const raw = frontmatter["tags"] ?? frontmatter["tag"];
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((t) => String(t).replace(/^#/, "").trim().toLowerCase())
    .filter(Boolean);
}

export function extractAllTags(
  body: string,
  frontmatter: Record<string, unknown>
): string[] {
  const combined = new Set([
    ...extractInlineTags(body),
    ...extractFrontmatterTags(frontmatter),
  ]);
  return Array.from(combined);
}
