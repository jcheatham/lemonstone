import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// ── Lemonstone dark editor theme ────────────────────────────────────────────

export const lemonstoneTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      background: "var(--ls-color-bg, #1a1a2e)",
      color: "var(--ls-color-fg, #e0e0e0)",
      fontSize: "15px",
      lineHeight: "1.7",
    },
    ".cm-scroller": {
      fontFamily: "var(--ls-font-ui, system-ui, sans-serif)",
      overflow: "auto",
    },
    ".cm-content": {
      padding: "24px 0",
      caretColor: "var(--ls-color-accent, #7c6af7)",
      maxWidth: "720px",
      margin: "0 auto",
    },
    ".cm-line": { padding: "0 24px" },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: "var(--ls-color-accent, #7c6af7)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      background: "rgba(124, 106, 247, 0.25)",
    },
    ".cm-activeLine": { background: "rgba(255,255,255,0.03)" },
    ".cm-gutters": { display: "none" }, // no gutters in notes editor
    // Obsidian-flavored syntax classes
    ".cm-ls-wikilink": {
      color: "var(--ls-color-accent, #7c6af7)",
      textDecoration: "none",
      cursor: "pointer",
    },
    ".cm-ls-wikilink:hover": { textDecoration: "underline" },
    ".cm-ls-tag": {
      color: "#f6e05e",
      fontWeight: "500",
    },
    ".cm-ls-frontmatter": { color: "var(--ls-color-fg-subtle, #aaa)" },
    ".cm-ls-frontmatter-fence": {
      color: "var(--ls-color-border, #555)",
      fontWeight: "bold",
    },
    ".cm-ls-callout-marker": { color: "#86efac", fontWeight: "bold" },
    ".cm-ls-embed": { color: "#93c5fd" },
    // Conflict marker lines
    ".cm-ls-conflict-ours": { background: "rgba(34, 197, 94, 0.08)" },
    ".cm-ls-conflict-theirs": { background: "rgba(239, 68, 68, 0.08)" },
    ".cm-ls-conflict-divider": {
      color: "#f59e0b",
      fontWeight: "bold",
      background: "rgba(245, 158, 11, 0.06)",
    },
    // Search highlight
    ".cm-searchMatch": { background: "rgba(124, 106, 247, 0.3)" },
    ".cm-searchMatch.cm-searchMatch-selected": {
      background: "rgba(124, 106, 247, 0.55)",
    },
  },
  { dark: true }
);

// ── Syntax highlight style (Lezer token types → CSS) ────────────────────────

export const lemonstoneHighlight = syntaxHighlighting(
  HighlightStyle.define([
    // Headings
    { tag: t.heading1, color: "#e2e8f0", fontSize: "1.5em", fontWeight: "700" },
    { tag: t.heading2, color: "#e2e8f0", fontSize: "1.3em", fontWeight: "600" },
    { tag: t.heading3, color: "#e2e8f0", fontSize: "1.15em", fontWeight: "600" },
    { tag: [t.heading4, t.heading5, t.heading6], color: "#cbd5e1", fontWeight: "600" },
    // Emphasis
    { tag: t.strong, fontWeight: "700", color: "#f1f5f9" },
    { tag: t.emphasis, fontStyle: "italic", color: "#e2e8f0" },
    { tag: t.strikethrough, textDecoration: "line-through", color: "#94a3b8" },
    // Code
    { tag: t.monospace, fontFamily: "var(--ls-font-mono, monospace)", fontSize: "0.9em", color: "#f9a8d4", background: "rgba(255,255,255,0.06)", borderRadius: "3px" },
    { tag: t.string, color: "#86efac" },
    // Links
    { tag: t.link, color: "var(--ls-color-accent, #7c6af7)" },
    { tag: t.url, color: "#93c5fd" },
    // Meta / punctuation
    { tag: t.processingInstruction, color: "#94a3b8" },
    { tag: t.comment, color: "#64748b", fontStyle: "italic" },
    { tag: t.meta, color: "#94a3b8" },
    { tag: t.punctuation, color: "#64748b" },
    // Blockquote
    { tag: t.quote, color: "#cbd5e1", fontStyle: "italic" },
    // List markers
    { tag: t.list, color: "#7c6af7" },
    // Keywords (YAML frontmatter keys parsed as properties)
    { tag: t.propertyName, color: "#93c5fd" },
    { tag: t.bool, color: "#f59e0b" },
    { tag: t.number, color: "#fb923c" },
  ])
);
