// Assembles all CodeMirror extensions for the Lemonstone editor.

import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorState, Compartment } from "@codemirror/state";
import { lemonstoneTheme, lemonstoneHighlight } from "./theme.ts";
import { obsidianDecorations } from "./obsidian-decorations.ts";
import { wikilinkAutocomplete } from "./wikilink-autocomplete.ts";
import { conflictMarkers } from "./conflict-markers.ts";

export { setWikilinkResolver } from "./wikilink-autocomplete.ts";

export function createEditorExtensions(opts: {
  onDocChange: (content: string) => void;
  readonly?: boolean;
}) {
  return [
    basicSetup,
    markdown(),
    lemonstoneTheme,
    lemonstoneHighlight,
    obsidianDecorations,
    conflictMarkers,
    wikilinkAutocomplete,
    keymap.of([indentWithTab, ...defaultKeymap]),
    indentUnit.of("  "),
    EditorState.readOnly.of(opts.readonly ?? false),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        opts.onDocChange(update.state.doc.toString());
      }
    }),
    // Soft wrap — notes are prose, not code.
    EditorView.lineWrapping,
  ];
}

/**
 * Extensions for the snippet source editor: HTML (with embedded JS/CSS
 * highlighting) instead of markdown, and none of the note-only decorations
 * (wikilinks, Obsidian syntax, conflict markers). `Mod-Enter` triggers a re-run.
 */
export function createSnippetEditorExtensions(opts: {
  onDocChange: (content: string) => void;
  onRun: () => void;
  readonly?: boolean;
  wrap: boolean;
  wrapCompartment: Compartment;
}) {
  return [
    basicSetup,
    html(),
    lemonstoneTheme,
    lemonstoneHighlight,
    keymap.of([
      { key: "Mod-Enter", preventDefault: true, run: () => { opts.onRun(); return true; } },
      indentWithTab,
      ...defaultKeymap,
    ]),
    indentUnit.of("  "),
    EditorState.readOnly.of(opts.readonly ?? false),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) opts.onDocChange(update.state.doc.toString());
    }),
    // Wrapped by default (mobile-friendly); toggleable via the snippet
    // toolbar for users who want to see real code structure + horizontal
    // scroll instead. See ls-snippet.ts's Wrap button.
    opts.wrapCompartment.of(opts.wrap ? EditorView.lineWrapping : []),
  ];
}
