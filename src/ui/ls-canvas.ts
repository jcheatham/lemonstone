// <ls-canvas> — JSON Canvas viewer/editor.
//
// Phase 2: read-only rendering + pan/zoom.
// Phase 4 (this file, current): selection, drag, inline text edit, add-node
// toolbar, delete, and `canvas-change` events so <ls-app> can persist edits.
//
// Rendering strategy:
//   - One CSS transform on #viewport handles pan/zoom for everything inside.
//   - HTML nodes (absolute-positioned divs) for content — best text + image.
//   - SVG layer for edges — bezier curves between node sides.
//   - Groups sit on their own lower z-layer so they render behind other nodes.
//   - Incremental node-DOM updates so selection/contenteditable state survives
//     re-renders.
//
// Properties:
//   document — CanvasDocument (see src/canvas/types.ts)
//
// Events (bubbles, composed):
//   canvas-change — detail: { document }  fired after any user mutation
//                   (add/remove/move/text). Caller persists.

import {
  addNode,
  updateNode,
  moveNode,
  removeNodes,
  boundingBox,
  type CanvasDocument,
  type CanvasNode,
  type CanvasEdge,
  type CanvasSide,
  type TextNode,
  type LinkNode,
  type FileNode,
} from "../canvas/index.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

const style = `
  :host {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--ls-color-bg, #1a1a2e);
    cursor: grab;
    user-select: none;
    touch-action: none;
    outline: none;
  }
  :host(.panning) { cursor: grabbing; }
  :host(:focus) { outline: none; }

  #viewport {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    will-change: transform;
  }

  .group-layer, .node-layer {
    position: absolute;
    top: 0;
    left: 0;
    overflow: visible;
  }
  svg#edges {
    position: absolute;
    top: 0;
    left: 0;
    width: 1px;
    height: 1px;
    overflow: visible;
    pointer-events: none;
  }

  .node {
    position: absolute;
    box-sizing: border-box;
    background: #24243a;
    border: 1px solid var(--ls-color-border, #2a2a3e);
    border-radius: 6px;
    padding: 10px 12px;
    color: var(--ls-color-fg, #e0e0e0);
    font-size: 13px;
    line-height: 1.45;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    word-wrap: break-word;
    white-space: pre-wrap;
    cursor: default;
  }
  .node:hover { border-color: rgba(124,106,247,0.4); }
  .node.selected {
    border-color: var(--ls-color-accent, #7c6af7);
    box-shadow: 0 0 0 2px rgba(124,106,247,0.35), 0 2px 8px rgba(0,0,0,0.3);
  }
  .node.dragging { opacity: 0.85; }
  .node.file {
    background: #1e2d3a;
    border-color: #2e3d4a;
  }
  .node.link {
    background: #2a1f3a;
    border-color: #3a2f4a;
  }
  .node.group {
    background: rgba(255,255,255,0.015);
    border-style: dashed;
    border-width: 2px;
    padding-top: 22px;
  }
  .node-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ls-color-fg-muted, #64748b);
    margin-bottom: 6px;
  }
  .node.group .node-label {
    position: absolute;
    top: 4px; left: 12px;
    margin: 0;
  }
  .node .text-body {
    outline: none;
    white-space: pre-wrap;
    word-break: break-word;
    min-height: 1em;
    cursor: text;
  }
  .node a {
    color: var(--ls-color-accent, #7c6af7);
    text-decoration: none;
    word-break: break-all;
  }
  .node a:hover { text-decoration: underline; }

  /* Toolbar */
  #toolbar {
    position: absolute;
    top: 10px;
    left: 10px;
    display: flex;
    gap: 4px;
    background: rgba(0,0,0,0.5);
    padding: 4px;
    border-radius: 6px;
    border: 1px solid var(--ls-color-border, #2a2a3e);
    backdrop-filter: blur(6px);
    z-index: 10;
  }
  #toolbar button {
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--ls-color-fg, #e0e0e0);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    padding: 4px 10px;
  }
  #toolbar button:hover {
    background: rgba(255,255,255,0.06);
    border-color: var(--ls-color-border, #2a2a3e);
  }

  /* Empty-state hint */
  #empty-state {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 13px;
    pointer-events: none;
    text-align: center;
    padding: 40px;
  }
  #empty-state kbd {
    background: rgba(255,255,255,0.07);
    border: 1px solid var(--ls-color-border, #2a2a3e);
    border-radius: 4px;
    padding: 1px 6px;
    font-family: var(--ls-font-mono, monospace);
    font-size: 11px;
  }

  /* Zoom HUD */
  #hud {
    position: absolute;
    bottom: 8px; right: 10px;
    font-size: 11px;
    color: var(--ls-color-fg-muted, #64748b);
    background: rgba(0,0,0,0.35);
    padding: 2px 8px;
    border-radius: 4px;
    font-family: var(--ls-font-mono, monospace);
    pointer-events: none;
  }
`;

// JSON Canvas preset color palette (spec §Metadata).
const PRESET_COLORS: Record<string, string> = {
  "1": "#ff6b6b",
  "2": "#ffa94d",
  "3": "#ffd43b",
  "4": "#51cf66",
  "5": "#22b8cf",
  "6": "#9775fa",
};

const DEFAULT_NODE_SIZE = { width: 240, height: 80 };

function resolveColor(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  return PRESET_COLORS[color] ?? color;
}

function sidePoint(node: CanvasNode, side: CanvasSide | undefined): [number, number] {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  switch (side) {
    case "top":    return [cx, node.y];
    case "right":  return [node.x + node.width, cy];
    case "bottom": return [cx, node.y + node.height];
    case "left":   return [node.x, cy];
    default:       return [cx, cy];
  }
}

function autoSides(from: CanvasNode, to: CanvasNode): [CanvasSide, CanvasSide] {
  const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
  const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? ["right", "left"] : ["left", "right"];
  }
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
}

export class LSCanvas extends HTMLElement {
  #shadow: ShadowRoot;
  #doc: CanvasDocument = { nodes: [], edges: [] };

  #viewport!: HTMLElement;
  #groupLayer!: HTMLElement;
  #edgesSvg!: SVGSVGElement;
  #nodeLayer!: HTMLElement;
  #hud!: HTMLElement;
  #emptyState!: HTMLElement;

  #panX = 0;
  #panY = 0;
  #zoom = 1;
  #hasFit = false;

  /** Node-ID → rendered HTMLElement, for incremental render. */
  #nodeEls = new Map<string, HTMLElement>();
  #selected = new Set<string>();
  #editingId: string | null = null;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);

    this.#viewport = document.createElement("div");
    this.#viewport.id = "viewport";

    this.#groupLayer = document.createElement("div");
    this.#groupLayer.className = "group-layer";

    this.#edgesSvg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    this.#edgesSvg.id = "edges";
    this.#installArrowMarker();

    this.#nodeLayer = document.createElement("div");
    this.#nodeLayer.className = "node-layer";

    this.#viewport.append(this.#groupLayer, this.#edgesSvg, this.#nodeLayer);
    this.#shadow.appendChild(this.#viewport);

    this.#emptyState = document.createElement("div");
    this.#emptyState.id = "empty-state";
    this.#emptyState.innerHTML =
      "Double-click anywhere to add a text node.<br>Or use the toolbar above.";
    this.#shadow.appendChild(this.#emptyState);

    this.#installToolbar();

    this.#hud = document.createElement("div");
    this.#hud.id = "hud";
    this.#shadow.appendChild(this.#hud);
  }

  connectedCallback(): void {
    // Setting tabIndex mutates the `tabindex` attribute — forbidden in the
    // custom-element constructor, allowed here after the element is attached.
    if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
    this.addEventListener("pointerdown", this.#onPointerDown);
    this.addEventListener("wheel", this.#onWheel, { passive: false });
    this.addEventListener("dblclick", this.#onDblClick);
    this.addEventListener("keydown", this.#onKeyDown);
    this.#render();
    this.#updateHud();
    this.#updateEmptyState();
  }

  disconnectedCallback(): void {
    this.removeEventListener("pointerdown", this.#onPointerDown);
    this.removeEventListener("wheel", this.#onWheel);
    this.removeEventListener("dblclick", this.#onDblClick);
    this.removeEventListener("keydown", this.#onKeyDown);
  }

  get document(): CanvasDocument { return this.#doc; }
  set document(v: CanvasDocument) {
    this.#doc = v;
    this.#nodeEls.clear();
    this.#groupLayer.replaceChildren();
    this.#nodeLayer.replaceChildren();
    this.#selected.clear();
    this.#editingId = null;
    this.#render();
    if (!this.#hasFit && v.nodes.length > 0) {
      this.fit();
      this.#hasFit = true;
    }
    this.#updateEmptyState();
  }

  /** Center the viewport on the content bounding box with a small margin. */
  fit(): void {
    const bb = boundingBox(this.#doc);
    if (!bb) {
      this.#panX = 0; this.#panY = 0; this.#zoom = 1;
      this.#applyTransform();
      this.#updateHud();
      return;
    }
    const rect = this.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      requestAnimationFrame(() => this.fit());
      return;
    }
    const padding = 40;
    const zoom = Math.min(
      (rect.width - padding * 2) / (bb.width || 1),
      (rect.height - padding * 2) / (bb.height || 1),
      1
    );
    const cx = bb.x + bb.width / 2;
    const cy = bb.y + bb.height / 2;
    this.#zoom = zoom;
    this.#panX = rect.width / 2 - cx * zoom;
    this.#panY = rect.height / 2 - cy * zoom;
    this.#applyTransform();
    this.#updateHud();
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────

  #installToolbar(): void {
    const bar = document.createElement("div");
    bar.id = "toolbar";
    const makeBtn = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = title;
      // Pointerdown on the toolbar should NOT initiate a pan.
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("click", onClick);
      return b;
    };
    bar.appendChild(makeBtn("+ Text", "Add text node at viewport center", () => this.#addTextAtCenter()));
    bar.appendChild(makeBtn("+ Link", "Add link node", () => this.#addLinkAtCenter()));
    bar.appendChild(makeBtn("+ File", "Add file reference node", () => this.#addFileAtCenter()));
    bar.appendChild(makeBtn("Fit", "Zoom to fit all content", () => this.fit()));
    this.#shadow.appendChild(bar);
  }

  // ── Coord conversion ──────────────────────────────────────────────────────

  #screenToWorld(clientX: number, clientY: number): [number, number] {
    const rect = this.getBoundingClientRect();
    return [
      (clientX - rect.left - this.#panX) / this.#zoom,
      (clientY - rect.top - this.#panY) / this.#zoom,
    ];
  }

  #viewportCenter(): [number, number] {
    const rect = this.getBoundingClientRect();
    return this.#screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  // ── Viewport transform ───────────────────────────────────────────────────

  #applyTransform(): void {
    this.#viewport.style.transform =
      `translate(${this.#panX}px, ${this.#panY}px) scale(${this.#zoom})`;
  }

  #updateHud(): void {
    this.#hud.textContent = `${Math.round(this.#zoom * 100)}%`;
  }

  #updateEmptyState(): void {
    this.#emptyState.style.display = this.#doc.nodes.length === 0 ? "flex" : "none";
  }

  // ── Pointer: pan on empty, drag on node ──────────────────────────────────

  #onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return;
    const path = e.composedPath();
    const inner = path[0] as Element | null;

    // Toolbar / HUD / empty-state → ignore.
    if (inner?.closest?.("#toolbar") || inner?.closest?.("#hud")) return;

    // Drop focus on any contenteditable that's currently being edited.
    if (this.#editingId && !inner?.closest?.(`[data-id="${this.#editingId}"]`)) {
      this.#commitEdit();
    }

    const nodeEl = inner?.closest?.(".node") as HTMLElement | null;
    if (nodeEl && !nodeEl.classList.contains("group")) {
      this.#onNodePointerDown(e, nodeEl);
      return;
    }

    // Empty space → pan + clear selection.
    this.#clearSelection();
    this.#startPan(e);
  };

  #startPan(e: PointerEvent): void {
    e.preventDefault();
    this.focus();
    const startX = e.clientX;
    const startY = e.clientY;
    const startPanX = this.#panX;
    const startPanY = this.#panY;
    this.classList.add("panning");
    try { this.setPointerCapture(e.pointerId); } catch { /* noop */ }

    const onMove = (ev: PointerEvent): void => {
      this.#panX = startPanX + (ev.clientX - startX);
      this.#panY = startPanY + (ev.clientY - startY);
      this.#applyTransform();
    };
    const onUp = (): void => {
      this.classList.remove("panning");
      this.removeEventListener("pointermove", onMove);
      this.removeEventListener("pointerup", onUp);
      this.removeEventListener("pointercancel", onUp);
    };
    this.addEventListener("pointermove", onMove);
    this.addEventListener("pointerup", onUp);
    this.addEventListener("pointercancel", onUp);
  }

  #onNodePointerDown(e: PointerEvent, nodeEl: HTMLElement): void {
    const id = nodeEl.dataset["id"]!;
    // If we're already editing this node, don't intercept — let the contenteditable handle.
    if (this.#editingId === id) return;

    e.preventDefault();
    this.focus();

    // Selection: toggle with shift, otherwise replace.
    if (e.shiftKey) {
      if (this.#selected.has(id)) this.#selected.delete(id);
      else this.#selected.add(id);
    } else if (!this.#selected.has(id)) {
      this.#selected.clear();
      this.#selected.add(id);
    }
    this.#syncSelectionClasses();

    // Start a drag.
    const startX = e.clientX;
    const startY = e.clientY;
    const startPositions = new Map<string, { x: number; y: number }>();
    for (const nid of this.#selected) {
      const n = this.#doc.nodes.find((nn) => nn.id === nid);
      if (n) startPositions.set(nid, { x: n.x, y: n.y });
    }
    let dragging = false;
    let lastDx = 0, lastDy = 0;
    try { this.setPointerCapture(e.pointerId); } catch { /* noop */ }

    const onMove = (ev: PointerEvent): void => {
      lastDx = (ev.clientX - startX) / this.#zoom;
      lastDy = (ev.clientY - startY) / this.#zoom;
      if (!dragging && Math.hypot(lastDx, lastDy) < 3) return; // dead zone
      dragging = true;
      for (const [nid, pos] of startPositions) {
        const el = this.#nodeEls.get(nid);
        if (!el) continue;
        el.style.left = `${pos.x + lastDx}px`;
        el.style.top = `${pos.y + lastDy}px`;
        el.classList.add("dragging");
      }
      // Update edges live so they follow the dragged nodes.
      this.#renderEdgesLive(startPositions, lastDx, lastDy);
    };
    const onUp = (): void => {
      this.removeEventListener("pointermove", onMove);
      this.removeEventListener("pointerup", onUp);
      this.removeEventListener("pointercancel", onUp);
      for (const el of this.#nodeEls.values()) el.classList.remove("dragging");
      if (dragging) {
        let doc = this.#doc;
        for (const nid of this.#selected) {
          doc = moveNode(doc, nid, lastDx, lastDy);
        }
        this.#doc = doc;
        this.#renderEdges(); // final
        this.#emitChange();
      }
    };
    this.addEventListener("pointermove", onMove);
    this.addEventListener("pointerup", onUp);
    this.addEventListener("pointercancel", onUp);
  }

  #clearSelection(): void {
    if (this.#selected.size === 0) return;
    this.#selected.clear();
    this.#syncSelectionClasses();
  }

  #syncSelectionClasses(): void {
    for (const [id, el] of this.#nodeEls) {
      el.classList.toggle("selected", this.#selected.has(id));
    }
  }

  // ── Double-click: add text node or enter edit mode ───────────────────────

  #onDblClick = (e: MouseEvent): void => {
    const inner = e.composedPath()[0] as Element | null;
    if (inner?.closest?.("#toolbar") || inner?.closest?.("#hud")) return;

    const nodeEl = inner?.closest?.(".node") as HTMLElement | null;
    if (nodeEl && !nodeEl.classList.contains("group")) {
      const id = nodeEl.dataset["id"]!;
      const node = this.#doc.nodes.find((n) => n.id === id);
      if (node?.type === "text") {
        e.preventDefault();
        e.stopPropagation();
        this.#beginEdit(id);
      }
      return;
    }

    // Empty space: add a new text node at the click position.
    e.preventDefault();
    const [wx, wy] = this.#screenToWorld(e.clientX, e.clientY);
    this.#addTextAt(wx - DEFAULT_NODE_SIZE.width / 2, wy - DEFAULT_NODE_SIZE.height / 2);
  };

  #onKeyDown = (e: KeyboardEvent): void => {
    // Don't steal keys while editing a text node.
    if (this.#editingId) {
      if (e.key === "Escape") {
        this.#commitEdit();
        e.preventDefault();
      }
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && this.#selected.size > 0) {
      e.preventDefault();
      this.#doc = removeNodes(this.#doc, new Set(this.#selected));
      this.#selected.clear();
      this.#render();
      this.#updateEmptyState();
      this.#emitChange();
    }
    if (e.key === "Escape") this.#clearSelection();
  };

  // ── Inline text editing ──────────────────────────────────────────────────

  #beginEdit(id: string): void {
    const el = this.#nodeEls.get(id);
    if (!el) return;
    const body = el.querySelector<HTMLElement>(".text-body");
    if (!body) return;
    this.#editingId = id;
    body.contentEditable = "true";
    body.focus();
    // Select all contents for quick replace.
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(body);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    body.addEventListener("blur", this.#onEditBlur, { once: true });
  }

  #onEditBlur = (): void => {
    this.#commitEdit();
  };

  #commitEdit(): void {
    const id = this.#editingId;
    if (!id) return;
    const el = this.#nodeEls.get(id);
    const body = el?.querySelector<HTMLElement>(".text-body");
    if (body) {
      body.contentEditable = "false";
      const text = body.innerText.replace(/\n$/, ""); // trim trailing newline some browsers add
      const node = this.#doc.nodes.find((n) => n.id === id);
      if (node?.type === "text" && node.text !== text) {
        this.#doc = updateNode(this.#doc, id, { text } as Partial<TextNode>);
        this.#emitChange();
      }
    }
    this.#editingId = null;
  }

  // ── Node creation ────────────────────────────────────────────────────────

  #addTextAt(x: number, y: number): void {
    const node: Omit<TextNode, "id"> = {
      type: "text",
      text: "",
      x: Math.round(x),
      y: Math.round(y),
      width: DEFAULT_NODE_SIZE.width,
      height: DEFAULT_NODE_SIZE.height,
    };
    const doc = addNode(this.#doc, node);
    this.#doc = doc;
    const newId = doc.nodes[doc.nodes.length - 1]!.id;
    this.#render();
    this.#updateEmptyState();
    this.#selected = new Set([newId]);
    this.#syncSelectionClasses();
    this.#emitChange();
    // Drop straight into edit mode so the user can type.
    this.#beginEdit(newId);
  }

  #addTextAtCenter(): void {
    const [cx, cy] = this.#viewportCenter();
    this.#addTextAt(cx - DEFAULT_NODE_SIZE.width / 2, cy - DEFAULT_NODE_SIZE.height / 2);
  }

  #addLinkAtCenter(): void {
    const url = prompt("Link URL:", "https://");
    if (!url || !url.trim()) return;
    const [cx, cy] = this.#viewportCenter();
    const node: Omit<LinkNode, "id"> = {
      type: "link",
      url: url.trim(),
      x: Math.round(cx - DEFAULT_NODE_SIZE.width / 2),
      y: Math.round(cy - DEFAULT_NODE_SIZE.height / 2),
      width: DEFAULT_NODE_SIZE.width,
      height: DEFAULT_NODE_SIZE.height,
    };
    this.#doc = addNode(this.#doc, node);
    this.#render();
    this.#updateEmptyState();
    this.#emitChange();
  }

  #addFileAtCenter(): void {
    const file = prompt("File path (vault-relative, e.g. notes/foo.md):");
    if (!file || !file.trim()) return;
    const [cx, cy] = this.#viewportCenter();
    const node: Omit<FileNode, "id"> = {
      type: "file",
      file: file.trim(),
      x: Math.round(cx - DEFAULT_NODE_SIZE.width / 2),
      y: Math.round(cy - DEFAULT_NODE_SIZE.height / 2),
      width: DEFAULT_NODE_SIZE.width,
      height: DEFAULT_NODE_SIZE.height,
    };
    this.#doc = addNode(this.#doc, node);
    this.#render();
    this.#updateEmptyState();
    this.#emitChange();
  }

  // ── Events out ───────────────────────────────────────────────────────────

  #emitChange(): void {
    this.dispatchEvent(
      new CustomEvent("canvas-change", {
        bubbles: true,
        composed: true,
        detail: { document: this.#doc },
      })
    );
  }

  // ── Arrow marker (shared across all edges) ───────────────────────────────

  #installArrowMarker(): void {
    const defs = document.createElementNS(SVG_NS, "defs");
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "arrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "8");
    marker.setAttribute("markerHeight", "8");
    marker.setAttribute("orient", "auto-start-reverse");
    marker.setAttribute("markerUnits", "userSpaceOnUse");
    const tri = document.createElementNS(SVG_NS, "path");
    tri.setAttribute("d", "M 0,0 L 10,5 L 0,10 z");
    tri.setAttribute("fill", "currentColor");
    marker.appendChild(tri);
    defs.appendChild(marker);
    this.#edgesSvg.appendChild(defs);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  /** Incrementally sync node DOM to #doc, preserving existing elements. */
  #render(): void {
    const seen = new Set<string>();
    for (const node of this.#doc.nodes) {
      seen.add(node.id);
      let el = this.#nodeEls.get(node.id);
      if (!el) {
        el = this.#createNodeElement(node);
        this.#nodeEls.set(node.id, el);
        const layer = node.type === "group" ? this.#groupLayer : this.#nodeLayer;
        layer.appendChild(el);
      } else {
        this.#updateNodeElement(el, node);
      }
      if (this.#selected.has(node.id)) el.classList.add("selected");
      else el.classList.remove("selected");
    }
    for (const [id, el] of this.#nodeEls) {
      if (!seen.has(id)) {
        el.remove();
        this.#nodeEls.delete(id);
      }
    }
    this.#renderEdges();
    this.#applyTransform();
  }

  #createNodeElement(node: CanvasNode): HTMLElement {
    const el = document.createElement("div");
    el.className = `node ${node.type}`;
    el.dataset["id"] = node.id;
    this.#updateNodeElement(el, node);
    return el;
  }

  #updateNodeElement(el: HTMLElement, node: CanvasNode): void {
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.width = `${node.width}px`;
    el.style.height = `${node.height}px`;
    if (node.color) el.style.borderColor = resolveColor(node.color, "");

    // If we're editing this node, leave its body alone.
    if (this.#editingId === node.id) return;

    // Re-render inner content. Simple approach: clear + repopulate.
    el.replaceChildren();
    switch (node.type) {
      case "text": {
        const body = document.createElement("div");
        body.className = "text-body";
        body.textContent = node.text || "";
        if (!node.text) body.dataset["placeholder"] = "Double-click to edit";
        el.appendChild(body);
        break;
      }
      case "file": {
        const label = document.createElement("div");
        label.className = "node-label";
        label.textContent = "File";
        const path = document.createElement("div");
        path.textContent = node.file + (node.subpath ?? "");
        el.append(label, path);
        break;
      }
      case "link": {
        const label = document.createElement("div");
        label.className = "node-label";
        label.textContent = "Link";
        const a = document.createElement("a");
        a.href = node.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = node.url;
        // Don't start a drag when clicking the link itself.
        a.addEventListener("pointerdown", (e) => e.stopPropagation());
        el.append(label, a);
        break;
      }
      case "group": {
        if (node.label) {
          const label = document.createElement("div");
          label.className = "node-label";
          label.textContent = node.label;
          el.appendChild(label);
        }
        break;
      }
    }
  }

  #renderEdges(): void {
    // Clear existing paths (keep <defs>).
    [...this.#edgesSvg.querySelectorAll(":scope > path")].forEach((p) => p.remove());
    for (const edge of this.#doc.edges) {
      const path = this.#createEdgePath(edge);
      if (path) this.#edgesSvg.appendChild(path);
    }
  }

  /** Redraw edges during a drag using offset positions for the dragged set. */
  #renderEdgesLive(startPositions: Map<string, { x: number; y: number }>, dx: number, dy: number): void {
    [...this.#edgesSvg.querySelectorAll(":scope > path")].forEach((p) => p.remove());
    for (const edge of this.#doc.edges) {
      const from = this.#doc.nodes.find((n) => n.id === edge.fromNode);
      const to = this.#doc.nodes.find((n) => n.id === edge.toNode);
      if (!from || !to) continue;
      const fromProj = startPositions.has(from.id)
        ? { ...from, x: startPositions.get(from.id)!.x + dx, y: startPositions.get(from.id)!.y + dy }
        : from;
      const toProj = startPositions.has(to.id)
        ? { ...to, x: startPositions.get(to.id)!.x + dx, y: startPositions.get(to.id)!.y + dy }
        : to;
      const path = this.#edgePathBetween(edge, fromProj, toProj);
      this.#edgesSvg.appendChild(path);
    }
  }

  #createEdgePath(edge: CanvasEdge): SVGPathElement | null {
    const from = this.#doc.nodes.find((n) => n.id === edge.fromNode);
    const to = this.#doc.nodes.find((n) => n.id === edge.toNode);
    if (!from || !to) return null;
    return this.#edgePathBetween(edge, from, to);
  }

  #edgePathBetween(edge: CanvasEdge, from: CanvasNode, to: CanvasNode): SVGPathElement {
    const [autoFromSide, autoToSide] = autoSides(from, to);
    const [x1, y1] = sidePoint(from, edge.fromSide ?? autoFromSide);
    const [x2, y2] = sidePoint(to, edge.toSide ?? autoToSide);

    const dx = x2 - x1;
    const dy = y2 - y1;
    const mainX = Math.abs(dx) >= Math.abs(dy);
    const bulge = Math.min(160, (mainX ? Math.abs(dx) : Math.abs(dy)) * 0.5);
    const cx1 = mainX ? x1 + Math.sign(dx || 1) * bulge : x1;
    const cy1 = mainX ? y1 : y1 + Math.sign(dy || 1) * bulge;
    const cx2 = mainX ? x2 - Math.sign(dx || 1) * bulge : x2;
    const cy2 = mainX ? y2 : y2 - Math.sign(dy || 1) * bulge;

    const path = document.createElementNS(SVG_NS, "path") as SVGPathElement;
    path.setAttribute("d", `M ${x1},${y1} C ${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`);
    path.setAttribute("fill", "none");
    const stroke = resolveColor(edge.color, "var(--ls-color-accent, #7c6af7)");
    path.setAttribute("stroke", stroke);
    path.style.color = stroke;
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    if (edge.toEnd !== "none") path.setAttribute("marker-end", "url(#arrow)");
    if (edge.fromEnd === "arrow") path.setAttribute("marker-start", "url(#arrow)");
    return path;
  }

  // ── Zoom + trackpad pan ──────────────────────────────────────────────────

  #onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this.#panX -= e.deltaX;
      this.#panY -= e.deltaY;
      this.#applyTransform();
      return;
    }
    e.preventDefault();
    const rect = this.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.002);
    const newZoom = Math.max(0.1, Math.min(4, this.#zoom * factor));
    const ratio = newZoom / this.#zoom;
    this.#panX = cx - (cx - this.#panX) * ratio;
    this.#panY = cy - (cy - this.#panY) * ratio;
    this.#zoom = newZoom;
    this.#applyTransform();
    this.#updateHud();
  };
}

customElements.define("ls-canvas", LSCanvas);
