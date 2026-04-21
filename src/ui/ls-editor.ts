// <ls-editor> — CodeMirror 6 editor Custom Element.
//
// Attributes:
//   path  — vault path of the currently displayed note (reflects to property)
//
// Properties:
//   value    — get/set the editor content
//   readonly — get/set read-only mode
//
// Methods:
//   focus()
//   insertAtCursor(text)
//   scrollToLine(n)
//
// Events (bubbles, composed):
//   input   — fired on every document change; detail: { content: string; path: string }
//   wikilink-click — user clicked a [[link]]; detail: { target: string }

import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { createEditorExtensions, setWikilinkResolver } from "./codemirror/index.ts";
import { vaultService } from "../vault/index.ts";

export class LSEditor extends HTMLElement {
  static observedAttributes = ["path", "readonly"];

  #view: EditorView | null = null;
  #path = "";
  #pendingValue: string | null = null;
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;

  connectedCallback(): void {
    // Wire up the wikilink resolver once on first mount.
    setWikilinkResolver((vaultService as unknown as { resolver: import("../vault/wikilink-resolver.ts").WikilinkResolver }).resolver);

    const shadow = this.attachShadow({ mode: "open" });

    // Container that fills the shadow root.
    const container = document.createElement("div");
    container.style.cssText = "height:100%;overflow:hidden;";
    shadow.appendChild(container);

    this.#view = new EditorView({
      state: EditorState.create({
        doc: this.#pendingValue ?? "",
        extensions: createEditorExtensions({
          onDocChange: (content) => this.#onDocChange(content),
        }),
      }),
      parent: container,
    });

    this.#pendingValue = null;
  }

  disconnectedCallback(): void {
    this.#view?.destroy();
    this.#view = null;
  }

  attributeChangedCallback(
    name: string,
    _old: string | null,
    value: string | null
  ): void {
    if (name === "path") {
      this.#path = value ?? "";
    }
    if (name === "readonly" && this.#view) {
      // Recreate state to toggle readOnly (simplest approach for v1).
      const current = this.#view.state.doc.toString();
      this.#view.setState(
        EditorState.create({
          doc: current,
          extensions: createEditorExtensions({
            onDocChange: (content) => this.#onDocChange(content),
            readonly: value !== null,
          }),
        })
      );
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get value(): string {
    return this.#view?.state.doc.toString() ?? this.#pendingValue ?? "";
  }

  set value(content: string) {
    if (!this.#view) {
      this.#pendingValue = content;
      return;
    }
    const current = this.#view.state.doc.toString();
    if (current === content) return; // no-op avoids cursor reset
    this.#view.dispatch({
      changes: { from: 0, to: current.length, insert: content },
      // Move cursor to start to avoid stale positions.
      selection: { anchor: 0 },
    });
  }

  get path(): string {
    return this.#path;
  }

  set path(p: string) {
    this.#path = p;
    this.setAttribute("path", p);
  }

  focus(): void {
    this.#view?.focus();
  }

  insertAtCursor(text: string): void {
    if (!this.#view) return;
    const { from, to } = this.#view.state.selection.main;
    this.#view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    this.#view.focus();
  }

  scrollToLine(n: number): void {
    if (!this.#view) return;
    const lineCount = this.#view.state.doc.lines;
    const safeN = Math.max(1, Math.min(n, lineCount));
    const line = this.#view.state.doc.line(safeN);
    this.#view.dispatch({
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  #onDocChange(content: string): void {
    // Debounce to avoid flooding the vault service on every keystroke.
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      this.dispatchEvent(
        new CustomEvent("input", {
          bubbles: true,
          composed: true,
          detail: { content, path: this.#path },
        })
      );
    }, 300);

    // Check for wikilink clicks is handled in the obsidian-decorations plugin
    // via a separate click listener added below.
    void content;
  }
}

customElements.define("ls-editor", LSEditor);
