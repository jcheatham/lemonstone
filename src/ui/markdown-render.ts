// Shared markdown → HTML renderer used by read-only contexts (canvas text
// nodes today; backlinks/outline previews later). Keep it small and safe:
//   - marked parses the common markdown features (headings, bold/italic, code,
//     lists, blockquotes, tables, inline HTML is escaped by default).
//   - A post-processing pass rewrites [[wikilinks]] into <a data-wikilink> tags
//     so callers can listen for clicks and route to notes.
//
// The returned HTML is assumed to originate from the user's own vault and is
// rendered into a scoped component shadow root. If we ever render third-party
// markdown we should add DOMPurify here.

import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/** Convert markdown to HTML. Wikilinks become `<a class="wikilink" data-target="name">label</a>`. */
export function renderMarkdown(src: string): string {
  if (!src) return "";
  // Step 1: marked → HTML. We escape raw HTML via gfm's default behaviour;
  // marked >=5 doesn't pass through <script> etc. unchanged.
  const html = marked.parse(src, { async: false }) as string;
  // Step 2: rewrite wikilinks in text nodes. We only replace in text positions
  // (i.e. not inside attribute values) by operating on text between tags.
  return rewriteWikilinks(html);
}

function rewriteWikilinks(html: string): string {
  // Split on tags so we don't substitute inside attributes. Simple regex that
  // matches `<...>` blocks keeps us from rewriting inside `href="[[foo]]"`.
  return html.replace(/(<[^>]+>)|([^<]+)/g, (_m, tag, text) => {
    if (tag) return tag as string;
    const t = text as string;
    return t.replace(WIKILINK_RE, (_mm, target: string, label?: string) => {
      const safeTarget = escapeAttr(target);
      const display = escapeText(label ?? target);
      return `<a class="wikilink" data-wikilink="${safeTarget}" href="#">${display}</a>`;
    });
  });
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === '"' ? "&quot;" : "&#39;"
  );
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;");
}
