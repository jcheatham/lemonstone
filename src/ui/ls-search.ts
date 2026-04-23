// <ls-search> — full-text search panel backed by VaultSearch / MiniSearch.
//
// Features:
//   - Field-scoped queries: title:foo, tag:bar, path:baz, or plain (all fields)
//   - Regex mode: /pattern/ syntax
//   - Highlighted matched terms in result snippets
//   - Keyboard navigation (↑↓ Enter)
//
// Events (bubbles, composed):
//   file-open — detail: { path: string }

import { vaultService } from "../vault/index.ts";
import type { SearchResult } from "../vault/search.ts";

// ── Query parsing ──────────────────────────────────────────────────────────

interface ParsedQuery {
  kind: "text" | "regex";
  raw: string;
  fields?: string[];
  pattern?: RegExp;
}

function parseQuery(input: string): ParsedQuery | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Regex mode: /pattern/flags
  const reMatch = /^\/(.+)\/([gimsuy]*)$/.exec(trimmed);
  if (reMatch) {
    try {
      return { kind: "regex", raw: trimmed, pattern: new RegExp(reMatch[1]!, reMatch[2]) };
    } catch {
      return null;
    }
  }

  // Field-scoped: "field:rest" where field is title|tag|tags|path|body
  const fieldMatch = /^(title|tag|tags|path|body):(.+)/.exec(trimmed);
  if (fieldMatch) {
    const field = fieldMatch[1] === "tags" ? "tag" : fieldMatch[1]!;
    const fieldMap: Record<string, string> = { tag: "tags", title: "title", path: "path", body: "body" };
    return { kind: "text", raw: fieldMatch[2]!.trim(), fields: [fieldMap[field]!] };
  }

  return { kind: "text", raw: trimmed };
}

// ── Highlight helper ───────────────────────────────────────────────────────

function highlight(text: string, terms: string[]): string {
  if (!terms.length) return escHtml(text);
  const pattern = new RegExp(
    `(${terms.map((t) => escRe(t)).join("|")})`,
    "gi"
  );
  return text.replace(pattern, "<mark>$1</mark>").replace(/[<>]/g, (c) =>
    c === "<" ? "<" : c === ">" ? ">" : c
  );
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Styles ─────────────────────────────────────────────────────────────────

const style = `
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-size: 13px;
  }
  .search-header {
    padding: 10px 12px 6px;
    flex-shrink: 0;
  }
  .search-input-wrap {
    display: flex;
    align-items: center;
    background: var(--ls-color-bg-input, #0f0f1a);
    border: 1px solid var(--ls-color-border, #333);
    border-radius: 6px;
    padding: 5px 10px;
    gap: 6px;
  }
  .search-input-wrap:focus-within {
    border-color: var(--ls-color-accent, #7c6af7);
  }
  .search-icon { color: var(--ls-color-fg-muted, #64748b); flex-shrink: 0; }
  input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--ls-color-fg, #e0e0e0);
    font-size: 13px;
    font-family: inherit;
    caret-color: var(--ls-color-accent, #7c6af7);
  }
  .scope-hint {
    font-size: 10px;
    color: var(--ls-color-fg-muted, #64748b);
    padding: 3px 12px 0;
  }
  .results-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0 8px;
  }
  .result-item {
    padding: 6px 12px;
    cursor: pointer;
    border-bottom: 1px solid var(--ls-color-border-subtle, rgba(255,255,255,0.04));
  }
  .result-item:hover, .result-item.selected {
    background: rgba(124,106,247,0.1);
  }
  .result-title {
    font-weight: 500;
    color: var(--ls-color-fg, #e0e0e0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .result-path {
    font-size: 11px;
    color: var(--ls-color-fg-muted, #64748b);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .result-score {
    float: right;
    font-size: 10px;
    color: var(--ls-color-fg-muted, #64748b);
    margin-left: 4px;
  }
  mark {
    background: rgba(124,106,247,0.3);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
  .state-msg {
    padding: 16px 12px;
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 12px;
    font-style: italic;
    text-align: center;
  }
  .regex-badge {
    font-size: 10px;
    background: rgba(124,106,247,0.2);
    color: var(--ls-color-accent, #7c6af7);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: var(--ls-font-mono, monospace);
    flex-shrink: 0;
  }
  .result-count {
    font-size: 11px;
    color: var(--ls-color-fg-muted, #64748b);
    padding: 0 12px 4px;
    flex-shrink: 0;
  }
`;

// ── Component ──────────────────────────────────────────────────────────────

export class LSSearch extends HTMLElement {
  #shadow: ShadowRoot;
  #input!: HTMLInputElement;
  #resultsList!: HTMLElement;
  #countEl!: HTMLElement;
  #debounce: ReturnType<typeof setTimeout> | null = null;
  #results: (SearchResult | string)[] = []; // SearchResult for text, string path for regex
  #selectedIndex = 0;
  #regexBadge!: HTMLElement;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    this.#buildDOM();
  }

  connectedCallback(): void {
    this.#input.addEventListener("keydown", this.#onKey);
  }

  focus(): void {
    this.#input.focus();
    this.#input.select();
  }

  // ── DOM ────────────────────────────────────────────────────────────────────

  #buildDOM(): void {
    const header = document.createElement("div");
    header.className = "search-header";

    const inputWrap = document.createElement("div");
    inputWrap.className = "search-input-wrap";

    const icon = document.createElement("span");
    icon.className = "search-icon";
    icon.textContent = "🔍";

    this.#input = document.createElement("input");
    this.#input.type = "text";
    this.#input.placeholder = "Search notes…";
    this.#input.setAttribute("autocomplete", "off");
    this.#input.addEventListener("input", () => this.#onInput());

    this.#regexBadge = document.createElement("span");
    this.#regexBadge.className = "regex-badge";
    this.#regexBadge.textContent = "/.*/";
    this.#regexBadge.style.display = "none";

    inputWrap.append(icon, this.#input, this.#regexBadge);
    header.appendChild(inputWrap);

    const hint = document.createElement("div");
    hint.className = "scope-hint";
    hint.textContent = "title: · tag: · path: · body: · /regex/";
    header.appendChild(hint);

    this.#countEl = document.createElement("div");
    this.#countEl.className = "result-count";

    this.#resultsList = document.createElement("div");
    this.#resultsList.className = "results-scroll";

    this.#showState("Type to search");

    this.#shadow.append(header, this.#countEl, this.#resultsList);
  }

  // ── Search logic ───────────────────────────────────────────────────────────

  #onInput(): void {
    if (this.#debounce) clearTimeout(this.#debounce);
    const val = this.#input.value;
    if (!val.trim()) {
      this.#regexBadge.style.display = "none";
      this.#countEl.textContent = "";
      this.#showState("Type to search");
      return;
    }
    this.#debounce = setTimeout(() => this.#runSearch(val), 150);
  }

  async #runSearch(val: string): Promise<void> {
    const parsed = parseQuery(val);
    if (!parsed) {
      this.#regexBadge.style.display = "none";
      this.#showState("Invalid query");
      return;
    }

    if (parsed.kind === "regex" && parsed.pattern) {
      this.#regexBadge.style.display = "";
      this.#showState("Searching…");
      try {
        const paths = await vaultService.searchRegex(parsed.pattern);
        this.#results = paths;
        this.#selectedIndex = 0;
        this.#renderRegexResults(paths, parsed.pattern);
      } catch {
        this.#showState("Regex search failed");
      }
    } else {
      this.#regexBadge.style.display = "none";
      const results = vaultService.searchFullText(parsed.raw, parsed.fields ? { fields: parsed.fields } : undefined);
      this.#results = results;
      this.#selectedIndex = 0;
      this.#renderTextResults(results);
    }
  }

  #renderTextResults(results: SearchResult[]): void {
    this.#resultsList.innerHTML = "";
    this.#countEl.textContent = results.length
      ? `${results.length} result${results.length === 1 ? "" : "s"}`
      : "";

    if (results.length === 0) {
      this.#showState("No results");
      return;
    }

    results.forEach((r, i) => {
      const item = document.createElement("div");
      item.className = "result-item" + (i === this.#selectedIndex ? " selected" : "");
      item.dataset["idx"] = String(i);

      const scoreEl = document.createElement("span");
      scoreEl.className = "result-score";
      scoreEl.textContent = r.score.toFixed(1);

      const title = document.createElement("div");
      title.className = "result-title";
      title.innerHTML = highlight(r.title, r.terms) + scoreEl.outerHTML;

      const path = document.createElement("div");
      path.className = "result-path";
      path.innerHTML = highlight(r.path, r.terms);

      item.append(title, path);
      item.addEventListener("click", () => this.#open(i));
      this.#resultsList.appendChild(item);
    });
  }

  #renderRegexResults(paths: string[], pattern: RegExp): void {
    this.#resultsList.innerHTML = "";
    this.#countEl.textContent = paths.length
      ? `${paths.length} match${paths.length === 1 ? "" : "es"}`
      : "";

    if (paths.length === 0) {
      this.#showState("No matches");
      return;
    }

    paths.forEach((p, i) => {
      const item = document.createElement("div");
      item.className = "result-item" + (i === this.#selectedIndex ? " selected" : "");
      item.dataset["idx"] = String(i);

      const base = p.split("/").pop() ?? p;
      const name = base;

      const title = document.createElement("div");
      title.className = "result-title";
      title.textContent = name;

      const pathEl = document.createElement("div");
      pathEl.className = "result-path";
      // Highlight path segments matching the regex
      try {
        pathEl.innerHTML = p.replace(pattern, (m) => `<mark>${escHtml(m)}</mark>`);
      } catch {
        pathEl.textContent = p;
      }

      item.append(title, pathEl);
      item.addEventListener("click", () => this.#open(i));
      this.#resultsList.appendChild(item);
    });
  }

  #showState(msg: string): void {
    this.#resultsList.innerHTML = "";
    const el = document.createElement("div");
    el.className = "state-msg";
    el.textContent = msg;
    this.#resultsList.appendChild(el);
  }

  #open(index: number): void {
    const item = this.#results[index];
    if (!item) return;
    const path = typeof item === "string" ? item : item.path;
    this.dispatchEvent(
      new CustomEvent("file-open", {
        bubbles: true,
        composed: true,
        detail: { path },
      })
    );
  }

  // ── Keyboard navigation ────────────────────────────────────────────────────

  #onKey = (e: KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.#selectedIndex = Math.min(this.#selectedIndex + 1, this.#results.length - 1);
      this.#updateSelected();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.#selectedIndex = Math.max(this.#selectedIndex - 1, 0);
      this.#updateSelected();
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.#open(this.#selectedIndex);
    }
  };

  #updateSelected(): void {
    this.#resultsList.querySelectorAll(".result-item").forEach((el, i) => {
      el.classList.toggle("selected", i === this.#selectedIndex);
    });
    this.#resultsList
      .querySelectorAll(".result-item")
      [this.#selectedIndex]?.scrollIntoView({ block: "nearest" });
  }
}

customElements.define("ls-search", LSSearch);
