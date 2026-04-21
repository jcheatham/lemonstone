// Conflict marker decoration and resolution widget (§6.4).
// Detects <<<<<<< / ======= / >>>>>>> blocks and renders an inline toolbar
// with "Keep mine / Keep theirs / Keep both" actions.

import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  WidgetType,
  EditorView,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

// ── Widget that renders the resolution toolbar ──────────────────────────────

interface ConflictBlock {
  /** Line number (1-based) of <<<<<<< */
  startLine: number;
  /** Line number of ======= */
  dividerLine: number;
  /** Line number of >>>>>>> */
  endLine: number;
  /** Content of the "ours" section (between <<<<<<< and =======) */
  ours: string;
  /** Content of the "theirs" section (between ======= and >>>>>>>) */
  theirs: string;
}

class ConflictWidget extends WidgetType {
  constructor(private readonly block: ConflictBlock) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-ls-conflict-widget";
    wrap.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:4px 24px;" +
      "font-size:12px;background:rgba(245,158,11,0.08);border-left:3px solid #f59e0b;";

    const label = document.createElement("span");
    label.textContent = "⚡ Conflict";
    label.style.cssText = "color:#f59e0b;font-weight:600;margin-right:4px;";
    wrap.appendChild(label);

    const btnStyle =
      "padding:2px 8px;border:1px solid;border-radius:4px;cursor:pointer;" +
      "font-size:11px;font-family:inherit;background:transparent;";

    const mine = document.createElement("button");
    mine.textContent = "Keep mine";
    mine.style.cssText = btnStyle + "color:#86efac;border-color:#86efac;";
    mine.addEventListener("click", (e) => {
      e.preventDefault();
      this.resolve(view, "mine");
    });

    const theirs = document.createElement("button");
    theirs.textContent = "Keep theirs";
    theirs.style.cssText = btnStyle + "color:#f87171;border-color:#f87171;";
    theirs.addEventListener("click", (e) => {
      e.preventDefault();
      this.resolve(view, "theirs");
    });

    const both = document.createElement("button");
    both.textContent = "Keep both";
    both.style.cssText = btnStyle + "color:#93c5fd;border-color:#93c5fd;";
    both.addEventListener("click", (e) => {
      e.preventDefault();
      this.resolve(view, "both");
    });

    wrap.append(mine, theirs, both);
    return wrap;
  }

  private resolve(
    view: EditorView,
    choice: "mine" | "theirs" | "both"
  ): void {
    const doc = view.state.doc;
    const start = doc.line(this.block.startLine);
    const end = doc.line(this.block.endLine);

    let replacement: string;
    if (choice === "mine") {
      replacement = this.block.ours;
    } else if (choice === "theirs") {
      replacement = this.block.theirs;
    } else {
      replacement =
        this.block.ours +
        (this.block.ours.endsWith("\n") ? "" : "\n") +
        this.block.theirs;
    }

    view.dispatch({
      changes: {
        from: start.from,
        to: end.to,
        insert: replacement,
      },
    });
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof ConflictWidget &&
      other.block.startLine === this.block.startLine
    );
  }

  ignoreEvent(): boolean {
    return false; // let click events through
  }
}

// ── Parse conflict blocks from the document ─────────────────────────────────

function findConflicts(view: EditorView): ConflictBlock[] {
  const doc = view.state.doc;
  const blocks: ConflictBlock[] = [];

  let startLine = -1;
  let dividerLine = -1;

  for (let ln = 1; ln <= doc.lines; ln++) {
    const text = doc.line(ln).text;
    if (text.startsWith("<<<<<<<")) {
      startLine = ln;
      dividerLine = -1;
    } else if (text.startsWith("=======") && startLine > 0) {
      dividerLine = ln;
    } else if (text.startsWith(">>>>>>>") && startLine > 0 && dividerLine > 0) {
      // Collect section text
      const oursLines: string[] = [];
      for (let i = startLine + 1; i < dividerLine; i++) {
        oursLines.push(doc.line(i).text);
      }
      const theirsLines: string[] = [];
      for (let i = dividerLine + 1; i < ln; i++) {
        theirsLines.push(doc.line(i).text);
      }
      blocks.push({
        startLine,
        dividerLine,
        endLine: ln,
        ours: oursLines.join("\n") + (oursLines.length > 0 ? "\n" : ""),
        theirs: theirsLines.join("\n") + (theirsLines.length > 0 ? "\n" : ""),
      });
      startLine = -1;
      dividerLine = -1;
    }
  }

  return blocks;
}

// ── Decoration marks for conflict lines ────────────────────────────────────

const oursLineDec = Decoration.line({ class: "cm-ls-conflict-ours" });
const theirsLineDec = Decoration.line({ class: "cm-ls-conflict-theirs" });
const dividerLineDec = Decoration.line({ class: "cm-ls-conflict-divider" });

function buildConflictDecorations(view: EditorView): DecorationSet {
  const blocks = findConflicts(view);
  if (blocks.length === 0) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  for (const block of blocks) {
    // Widget above the <<<<<<< line
    const startPos = doc.line(block.startLine).from;
    builder.add(
      startPos,
      startPos,
      Decoration.widget({ widget: new ConflictWidget(block), side: -1 })
    );

    // Color <<<<<<< line
    builder.add(startPos, startPos, dividerLineDec);

    // Color "ours" lines
    for (let ln = block.startLine + 1; ln < block.dividerLine; ln++) {
      const lFrom = doc.line(ln).from;
      builder.add(lFrom, lFrom, oursLineDec);
    }

    // Color ======= line
    const divPos = doc.line(block.dividerLine).from;
    builder.add(divPos, divPos, dividerLineDec);

    // Color "theirs" lines
    for (let ln = block.dividerLine + 1; ln < block.endLine; ln++) {
      const lFrom = doc.line(ln).from;
      builder.add(lFrom, lFrom, theirsLineDec);
    }

    // Color >>>>>>> line
    const endPos = doc.line(block.endLine).from;
    builder.add(endPos, endPos, dividerLineDec);
  }

  return builder.finish();
}

export const conflictMarkers = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildConflictDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildConflictDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);
