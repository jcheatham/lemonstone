// Minimal YAML frontmatter parser for Obsidian-flavored Markdown.
// Handles the subset actually used in practice: scalars, inline arrays, block arrays.

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  /** Content with the frontmatter block stripped. */
  body: string;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }
  // Find closing ---
  const afterOpen = content.indexOf("\n", 3);
  if (afterOpen === -1) return { frontmatter: {}, body: content };

  const closeIdx = content.indexOf("\n---", afterOpen);
  if (closeIdx === -1) return { frontmatter: {}, body: content };

  const yamlStr = content.slice(afterOpen + 1, closeIdx);
  const body = content.slice(closeIdx + 4).replace(/^\r?\n/, "");
  return { frontmatter: parseYaml(yamlStr), body };
}

function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    // Skip blank / comment lines
    if (/^\s*(#|$)/.test(line)) { i++; continue; }

    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) { i++; continue; }

    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();

    if (rawVal === "" || rawVal === "|" || rawVal === ">") {
      // Check if next lines are a block list
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1]!)) {
        i++;
        items.push(lines[i]!.replace(/^\s+-\s*/, "").trim());
      }
      result[key] = items.length > 0 ? items : null;
    } else if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
      // Inline array: [a, b, "c d"]
      result[key] = parseInlineArray(rawVal.slice(1, -1));
    } else {
      result[key] = parseScalar(rawVal);
    }
    i++;
  }
  return result;
}

function parseInlineArray(inner: string): unknown[] {
  const items: unknown[] = [];
  for (const part of inner.split(",")) {
    const v = part.trim();
    if (v) items.push(parseScalar(v));
  }
  return items;
}

function parseScalar(s: string): unknown {
  // Strip surrounding quotes
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  const n = Number(s);
  if (!isNaN(n) && s !== "") return n;
  return s;
}
