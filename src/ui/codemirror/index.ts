// Assembles all CodeMirror extensions for the Lemonstone editor.

import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
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
