// ViewPlugin that adds decorations for Obsidian-flavored syntax:
// wikilinks, embeds, inline #tags, frontmatter block, callout markers.

import { ViewPlugin, ViewUpdate, Decoration, DecorationSet } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

// ── Decoration marks (CSS classes defined in theme.ts) ─────────────────────

const wikilink = Decoration.mark({ class: "cm-ls-wikilink" });
const embed = Decoration.mark({ class: "cm-ls-embed" });
const tag = Decoration.mark({ class: "cm-ls-tag" });
const frontmatterLine = Decoration.mark({ class: "cm-ls-frontmatter" });
const frontmatterFence = Decoration.mark({ class: "cm-ls-frontmatter-fence" });
const calloutMarker = Decoration.mark({ class: "cm-ls-callout-marker" });

// ── Regexes ────────────────────────────────────────────────────────────────

const WIKILINK_RE = /!?\[\[[^\]|\n]+(?:\|[^\]\n]*)?\]\]/g;
const TAG_RE = /(^|[\s,;(])#([a-zA-Z_À-ɏ][a-zA-Z0-9_À-ɏ/-]*)/g;
const CALLOUT_RE = /^>\s*\[!([^\]]+)\]/;
const FRONTMATTER_FENCE_RE = /^---\s*$/;

interface Mark {
  from: number;
  to: number;
  dec: Decoration;
}

function collectMarks(view: EditorView): Mark[] {
  const marks: Mark[] = [];
  const doc = view.state.doc;
  const { from: vpFrom, to: vpTo } = view.viewport;

  // ── Frontmatter detection ───────────────────────────────────────────────
  let frontmatterEnd = -1;

  if (doc.lines >= 1) {
    const firstLine = doc.line(1);
    if (FRONTMATTER_FENCE_RE.test(firstLine.text)) {
      for (let ln = 2; ln <= doc.lines; ln++) {
        const l = doc.line(ln);
        if (FRONTMATTER_FENCE_RE.test(l.text)) {
          frontmatterEnd = l.to;
          break;
        }
      }
    }
  }

  // ── Line-by-line scan of the visible viewport ───────────────────────────
  let lineFrom = doc.lineAt(vpFrom).from;

  while (lineFrom <= vpTo && lineFrom <= doc.length) {
    const line = doc.lineAt(lineFrom);
    const { from, to, text } = line;

    // Frontmatter block
    if (frontmatterEnd > 0 && from <= frontmatterEnd) {
      if (FRONTMATTER_FENCE_RE.test(text)) {
        marks.push({ from, to, dec: frontmatterFence });
      } else {
        marks.push({ from, to, dec: frontmatterLine });
      }
      lineFrom = to + 1;
      continue;
    }

    // Callout marker: > [!note]
    const calloutMatch = CALLOUT_RE.exec(text);
    if (calloutMatch) {
      const start = from + calloutMatch.index!;
      marks.push({ from: start, to: start + calloutMatch[0].length, dec: calloutMarker });
    }

    // Wikilinks and embeds: [[...]] and ![[...]]
    WIKILINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_RE.exec(text)) !== null) {
      const start = from + m.index!;
      const end = start + m[0].length;
      marks.push({ from: start, to: end, dec: m[0].startsWith("!") ? embed : wikilink });
    }

    // Inline tags — only outside frontmatter, code spans handled below
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(text)) !== null) {
      // m[1] is the leading whitespace/punctuation char, m[2] is the tag name
      const hashStart = from + m.index! + m[1]!.length;
      const end = hashStart + 1 + m[2]!.length;
      marks.push({ from: hashStart, to: end, dec: tag });
    }

    lineFrom = to + 1;
  }

  // Sort ascending by from (required by RangeSetBuilder).
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  return marks;
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;

  for (const { from, to, dec } of collectMarks(view)) {
    // Skip overlapping ranges (shouldn't happen, but be safe).
    if (from < lastTo) continue;
    builder.add(from, to, dec);
    lastTo = to;
  }

  return builder.finish();
}

export const obsidianDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);
