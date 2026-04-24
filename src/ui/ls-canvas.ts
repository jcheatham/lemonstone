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
  resizeNode,
  removeNodes,
  connectNodes,
  removeEdge,
  boundingBox,
  type CanvasDocument,
  type CanvasNode,
  type CanvasEdge,
  type CanvasSide,
  type TextNode,
  type LinkNode,
  type FileNode,
} from "../canvas/index.ts";
import { renderMarkdown } from "./markdown-render.ts";

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
  /* Paths accept pointer events on their stroke so edges are clickable even
     though the SVG container is pointer-through. Ghost path used during edge
     creation never accepts events. */
  svg#edges path.edge { pointer-events: stroke; cursor: pointer; }
  svg#edges path.edge-hit {
    /* Invisible fat stroke that catches clicks along a thin edge. */
    pointer-events: stroke;
    stroke: transparent;
    fill: none;
    cursor: pointer;
  }
  svg#edges path.edge.selected {
    stroke-width: 3;
    filter: drop-shadow(0 0 4px var(--ls-color-accent, #7c6af7));
  }
  svg#edges path.ghost {
    pointer-events: none;
    stroke-dasharray: 5 4;
    opacity: 0.7;
  }
  svg#edges circle.endpoint {
    pointer-events: all;
    cursor: grab;
    fill: var(--ls-color-bg, #1a1a2e);
    stroke: var(--ls-color-accent, #7c6af7);
    stroke-width: 2;
  }
  svg#edges circle.endpoint:hover {
    fill: var(--ls-color-accent, #7c6af7);
  }
  :host(.endpoint-dragging) svg#edges circle.endpoint { cursor: grabbing; }

  .node {
    position: absolute;
    box-sizing: border-box;
    background: #24243a;
    border: 1px solid var(--ls-color-border, #2a2a3e);
    border-radius: 6px;
    color: var(--ls-color-fg, #e0e0e0);
    font-size: 13px;
    line-height: 1.45;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    word-wrap: break-word;
    white-space: pre-wrap;
    cursor: default;
    /* No overflow:hidden here — it would clip the connection handles that
       poke out past the border. Content clipping/scrolling happens on the
       inner .node-content wrapper. */
  }
  .node > .node-content {
    width: 100%;
    height: 100%;
    padding: 10px 12px;
    box-sizing: border-box;
    overflow-y: auto;
    overflow-x: hidden;
    border-radius: inherit;
  }
  /* Subtle scrollbar so it doesn't fight the dark theme. */
  .node > .node-content::-webkit-scrollbar { width: 6px; height: 6px; }
  .node > .node-content::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.15);
    border-radius: 3px;
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
  }
  .node.group > .node-content {
    padding-top: 22px;
    overflow: visible;
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
  /* Text-node body — same element across rendered and editing states. */
  .node .text-body {
    outline: none;
    word-break: break-word;
    cursor: text;
    user-select: text;
  }
  .node .text-body.editing {
    white-space: pre-wrap;
    background: rgba(255,255,255,0.04);
    outline: 2px solid var(--ls-color-accent, #7c6af7);
    outline-offset: 2px;
    border-radius: 3px;
    min-height: 1em;
  }
  .node .text-body h1,
  .node .text-body h2,
  .node .text-body h3,
  .node .text-body h4 {
    margin: 0 0 6px;
    line-height: 1.2;
  }
  .node .text-body h1 { font-size: 17px; }
  .node .text-body h2 { font-size: 15px; }
  .node .text-body h3 { font-size: 14px; }
  .node .text-body h4 { font-size: 13px; color: var(--ls-color-fg-muted, #64748b); }
  .node .text-body p { margin: 0 0 8px; }
  .node .text-body p:last-child { margin-bottom: 0; }
  .node .text-body ul,
  .node .text-body ol { margin: 0 0 8px; padding-left: 20px; }
  .node .text-body code {
    background: rgba(255,255,255,0.08);
    padding: 1px 4px;
    border-radius: 3px;
    font-family: var(--ls-font-mono, monospace);
    font-size: 12px;
  }
  .node .text-body pre {
    background: rgba(0,0,0,0.3);
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 0 0 8px;
  }
  .node .text-body pre code { background: none; padding: 0; }
  .node .text-body blockquote {
    border-left: 3px solid var(--ls-color-border, #2a2a3e);
    padding-left: 10px;
    color: var(--ls-color-fg-muted, #64748b);
    margin: 0 0 8px;
  }
  .node .text-body a {
    color: var(--ls-color-accent, #7c6af7);
    text-decoration: none;
  }
  .node .text-body a:hover { text-decoration: underline; }
  .node .text-body a.wikilink {
    background: rgba(124,106,247,0.12);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .node .text-body strong { color: var(--ls-color-fg, #e0e0e0); }
  .node .text-body hr {
    border: none;
    border-top: 1px solid var(--ls-color-border, #2a2a3e);
    margin: 10px 0;
  }

  /* Resize grip — bottom-right corner, revealed on hover/select. */
  .resize-grip {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 14px;
    height: 14px;
    cursor: nwse-resize;
    opacity: 0;
    background:
      linear-gradient(135deg, transparent 0 50%, var(--ls-color-fg-muted, #64748b) 50% 60%, transparent 60% 70%, var(--ls-color-fg-muted, #64748b) 70% 80%, transparent 80%);
    transition: opacity 0.12s;
    z-index: 1;
  }
  .node:hover > .resize-grip,
  .node.selected > .resize-grip { opacity: 1; }
  :host(.resizing) { cursor: nwse-resize; }

  /* Connection handles — hidden unless the node is selected or a drag is
     underway. We used to show them on hover too, but they protruded past the
     node border enough to hijack clicks on nearby edges. */
  .handle {
    position: absolute;
    width: 9px;
    height: 9px;
    background: var(--ls-color-accent, #7c6af7);
    border: 2px solid var(--ls-color-bg, #1a1a2e);
    border-radius: 50%;
    cursor: crosshair;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s;
    z-index: 1;
  }
  .node.selected > .handle,
  :host(.connecting) .handle {
    opacity: 1;
    pointer-events: all;
  }
  .handle.top    { top: -5px;    left: 50%;   margin-left: -4.5px; }
  .handle.right  { right: -5px;  top: 50%;    margin-top: -4.5px; }
  .handle.bottom { bottom: -5px; left: 50%;   margin-left: -4.5px; }
  .handle.left   { left: -5px;   top: 50%;    margin-top: -4.5px; }
  :host(.connecting) .node { cursor: crosshair; }
  :host(.connecting) .node.drop-target {
    box-shadow: 0 0 0 3px var(--ls-color-accent, #7c6af7), 0 2px 8px rgba(0,0,0,0.3);
  }
  .node a {
    color: var(--ls-color-accent, #7c6af7);
    text-decoration: none;
    word-break: break-all;
  }
  .node a:hover { text-decoration: underline; }
  .node .file-link { display: block; cursor: pointer; }

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

  /* Conflict banner */
  #conflict-banner {
    position: absolute;
    top: 0; left: 0; right: 0;
    display: none;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: rgba(245,158,11,0.14);
    border-bottom: 1px solid #f59e0b;
    color: #fcd34d;
    font-size: 12px;
    z-index: 20;
  }
  #conflict-banner.visible { display: flex; }
  #conflict-banner button {
    background: rgba(255,255,255,0.08);
    border: 1px solid currentColor;
    color: inherit;
    border-radius: 4px;
    padding: 2px 10px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  #conflict-banner button:hover { background: rgba(255,255,255,0.16); }
  #conflict-banner .spacer { flex: 1; }

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

/** Which side of a node is closest to a world-space point. */
function nearestSide(node: CanvasNode, wx: number, wy: number): CanvasSide {
  const left = Math.abs(wx - node.x);
  const right = Math.abs(wx - (node.x + node.width));
  const top = Math.abs(wy - node.y);
  const bottom = Math.abs(wy - (node.y + node.height));
  const min = Math.min(left, right, top, bottom);
  if (min === left) return "left";
  if (min === right) return "right";
  if (min === top) return "top";
  return "bottom";
}

function autoSides(from: CanvasNode, to: CanvasNode): [CanvasSide, CanvasSide] {
  const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
  const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? ["right", "left"] : ["left", "right"];
  }
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
}

/** Smooth bezier between two points with control handles bulging along the
 * dominant axis — same routing used for both live ghosts and committed edges. */
function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const mainX = Math.abs(dx) >= Math.abs(dy);
  const bulge = Math.min(160, (mainX ? Math.abs(dx) : Math.abs(dy)) * 0.5);
  const cx1 = mainX ? x1 + Math.sign(dx || 1) * bulge : x1;
  const cy1 = mainX ? y1 : y1 + Math.sign(dy || 1) * bulge;
  const cx2 = mainX ? x2 - Math.sign(dx || 1) * bulge : x2;
  const cy2 = mainX ? y2 : y2 - Math.sign(dy || 1) * bulge;
  return `M ${x1},${y1} C ${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`;
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
  #conflictBanner!: HTMLElement;
  #conflictActive = false;

  #panX = 0;
  #panY = 0;
  #zoom = 1;
  #hasFit = false;

  /** All currently-active touch pointers (pointerType === "touch"), indexed
   *  by pointerId. Drives pinch-zoom detection and handling on mobile. */
  #touchPointers = new Map<number, { x: number; y: number }>();
  /** When true, an ongoing pinch gesture has ownership of pointer events;
   *  the single-finger pan logic steps aside. */
  #pinchActive = false;
  /** Abort callback for the current pointer-driven gesture (pan, node drag,
   *  resize, edge-create, endpoint drag). Pinch calls this when a second
   *  finger joins so a node drag in progress can't fight pinch over the
   *  same pointer stream. */
  #activeGestureCleanup: (() => void) | null = null;

  /** Node-ID → rendered HTMLElement, for incremental render. */
  #nodeEls = new Map<string, HTMLElement>();
  #selected = new Set<string>();
  #selectedEdges = new Set<string>();
  #editingId: string | null = null;
  /** Live ghost path + metadata during an edge-creation drag. */
  #connecting: {
    fromNode: string;
    fromSide: CanvasSide;
    ghost: SVGPathElement;
    currentTarget: string | null;
  } | null = null;
  /** Manual double-click detection: tracks the last pointerdown per node so
   * we don't depend on the browser's native dblclick (which refuses to fire
   * when the pointer wiggles between clicks — common on trackpads). */
  #lastNodeDown: { id: string; time: number; x: number; y: number } | null = null;

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
    this.#emptyState.textContent = "Use the toolbar above to add a node.";
    this.#shadow.appendChild(this.#emptyState);

    this.#conflictBanner = document.createElement("div");
    this.#conflictBanner.id = "conflict-banner";
    this.#shadow.appendChild(this.#conflictBanner);

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
    // Permanent cleanup for the touch-pointer map. Gesture-specific handlers
    // (pan's onUp, pinch's onEnd) also remove entries, but if a pinch ends
    // with one finger still down, no gesture tracks the remaining pointer —
    // and when it eventually lifts, nothing cleans up its entry. That
    // leaves a stale "ghost" finger that future pinch checks count as an
    // active second touch, producing spurious zoom reactions during what
    // should be single-finger pans.
    this.addEventListener("pointerup", this.#onGlobalPointerEnd);
    this.addEventListener("pointercancel", this.#onGlobalPointerEnd);
    this.#render();
    this.#updateHud();
    this.#updateEmptyState();
  }

  disconnectedCallback(): void {
    this.removeEventListener("pointerdown", this.#onPointerDown);
    this.removeEventListener("wheel", this.#onWheel);
    this.removeEventListener("dblclick", this.#onDblClick);
    this.removeEventListener("pointerup", this.#onGlobalPointerEnd);
    this.removeEventListener("pointercancel", this.#onGlobalPointerEnd);
    this.removeEventListener("keydown", this.#onKeyDown);
  }

  /**
   * Toggle the conflict banner. Pass true when the canvas file is in a
   * merge-conflict state; false to clear. The actual "theirs" document is
   * owned by the caller (ls-app reads it from the IDB record when the user
   * picks a resolution).
   */
  setConflict(active: boolean): void {
    if (this.#conflictActive === active) return;
    this.#conflictActive = active;
    this.#renderConflictBanner();
  }

  #renderConflictBanner(): void {
    this.#conflictBanner.replaceChildren();
    this.#conflictBanner.classList.toggle("visible", this.#conflictActive);
    if (!this.#conflictActive) return;
    const label = document.createElement("span");
    label.textContent = "Merge conflict: remote diverged from local.";
    const spacer = document.createElement("span");
    spacer.className = "spacer";
    const mineBtn = document.createElement("button");
    mineBtn.textContent = "Keep mine";
    mineBtn.addEventListener("click", () => this.#emitResolve("mine"));
    const theirsBtn = document.createElement("button");
    theirsBtn.textContent = "Keep theirs";
    theirsBtn.addEventListener("click", () => this.#emitResolve("theirs"));
    const bothBtn = document.createElement("button");
    bothBtn.textContent = "Keep both";
    bothBtn.addEventListener("click", () => this.#emitResolve("both"));
    this.#conflictBanner.append(label, spacer, mineBtn, theirsBtn, bothBtn);
  }

  #emitResolve(choice: "mine" | "theirs" | "both"): void {
    this.dispatchEvent(
      new CustomEvent("canvas-resolve-conflict", {
        bubbles: true,
        composed: true,
        detail: { choice },
      })
    );
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
    // Track every touch so multi-touch gestures (pinch-zoom) work even if
    // one of the fingers landed on a node. Mouse/pen go through the normal
    // single-pointer path.
    if (e.pointerType === "touch") {
      this.#touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.#touchPointers.size >= 2) {
        // A second finger just joined — switch to pinch mode. Abort any
        // single-finger gesture (pan, node drag, resize, …) already in
        // progress so it doesn't fight pinch over the same pointer stream.
        this.#abortActiveGesture();
        if (!this.#pinchActive) this.#startPinch();
        return;
      }
    }

    if (e.button !== 0 && e.button !== 1) return;
    const inner = e.composedPath()[0] as Element | null;

    // Toolbar / HUD / empty-state → ignore.
    if (inner?.closest?.("#toolbar") || inner?.closest?.("#hud")) return;

    // If the press is on a node (including anything inside it), let the
    // node's own listener handle it. Node handlers call stopPropagation on
    // inner children (handles, resize grip, links) so we won't get here then.
    if (inner?.closest?.(".node:not(.group)")) return;

    // Drop focus on any contenteditable that's currently being edited.
    if (this.#editingId) this.#commitEdit();

    // Empty space → pan + clear selection.
    this.#clearSelection();
    this.#startPan(e);
  };

  /** Two-finger pinch handler.
   *
   *  Baselines the canvas pan/zoom + finger positions at gesture start and
   *  computes every subsequent frame directly from the current finger
   *  positions relative to that baseline. Earlier versions did frame-to-
   *  frame incremental math, which accumulated rounding and anchor-shift
   *  errors — those showed up as visible 5-10% zoom jumps.
   *
   *  The invariant we maintain: the canvas-space point that was under the
   *  initial midpoint stays under the current midpoint. That point is
   *  computed once (initial) and reused every frame, so there's nothing
   *  to drift. */
  #startPinch(): void {
    this.#pinchActive = true;
    this.classList.add("panning");

    const pts = () => [...this.#touchPointers.values()] as { x: number; y: number }[];
    const MIN_PAIR_DIST = 10;

    let initialDist: number;
    // Anchor in CANVAS coordinates — the point under the user's initial
    // midpoint. This is the invariant: the same canvas point should stay
    // under the current midpoint for the duration of the gesture. Once
    // captured at snapshot time, it never changes — no drift.
    let anchorCanvasX: number;
    let anchorCanvasY: number;
    let initialZoom: number;

    const snapshot = (): void => {
      const [a, b] = pts();
      initialDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const initialMidX = (a!.x + b!.x) / 2;
      const initialMidY = (a!.y + b!.y) / 2;
      initialZoom = this.#zoom;
      // Read rect AT snapshot time to resolve initialMid into canvas coords.
      const rect = this.getBoundingClientRect();
      anchorCanvasX = (initialMidX - rect.left - this.#panX) / this.#zoom;
      anchorCanvasY = (initialMidY - rect.top - this.#panY) / this.#zoom;
    };
    snapshot();

    const onMove = (ev: PointerEvent): void => {
      if (!this.#touchPointers.has(ev.pointerId)) return;
      this.#touchPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.#touchPointers.size !== 2) return;
      const [a, b] = pts();
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (dist < MIN_PAIR_DIST || initialDist < MIN_PAIR_DIST) {
        // Fingers too close to measure a reliable zoom factor — re-baseline
        // silently until they're apart enough.
        snapshot();
        return;
      }
      const midX = (a!.x + b!.x) / 2;
      const midY = (a!.y + b!.y) / 2;

      // Absolute zoom derived from initial state — not frame-to-frame.
      const newZoom = Math.max(0.1, Math.min(4, initialZoom * (dist / initialDist)));

      // Re-read rect EVERY frame. On mobile the host's client-space position
      // can shift mid-gesture when the browser hides/shows its toolbar,
      // the visual viewport jumps, or the keyboard dismisses. Cached rects
      // cause a visible snap at the end when reality catches up.
      const rect = this.getBoundingClientRect();
      const currentHostX = midX - rect.left;
      const currentHostY = midY - rect.top;

      // Solve for pan that keeps `anchorCanvas` sitting under `currentHost`:
      //   currentHost = anchorCanvas * newZoom + newPan
      this.#panX = currentHostX - anchorCanvasX * newZoom;
      this.#panY = currentHostY - anchorCanvasY * newZoom;
      this.#zoom = newZoom;

      this.#applyTransform();
      this.#updateHud();
    };

    const onEnd = (ev: PointerEvent): void => {
      this.#touchPointers.delete(ev.pointerId);
      if (this.#touchPointers.size < 2) {
        this.#pinchActive = false;
        this.classList.remove("panning");
        this.removeEventListener("pointermove", onMove);
        this.removeEventListener("pointerup", onEnd);
        this.removeEventListener("pointercancel", onEnd);
      } else {
        // Still 2+ fingers (user lifted a third) — re-baseline so the new
        // pair's positions are the reference for the rest of the gesture.
        snapshot();
      }
    };

    this.addEventListener("pointermove", onMove);
    this.addEventListener("pointerup", onEnd);
    this.addEventListener("pointercancel", onEnd);
  }

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
      // If pinch took over, back off — pinch's handler owns panX/panY now.
      if (this.#pinchActive) return;
      this.#panX = startPanX + (ev.clientX - startX);
      this.#panY = startPanY + (ev.clientY - startY);
      this.#applyTransform();
    };
    const cleanup = (): void => {
      this.classList.remove("panning");
      this.removeEventListener("pointermove", onMove);
      this.removeEventListener("pointerup", onUp);
      this.removeEventListener("pointercancel", onUp);
      if (this.#activeGestureCleanup === cleanup) this.#activeGestureCleanup = null;
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerType === "touch") this.#touchPointers.delete(ev.pointerId);
      cleanup();
    };
    this.#activeGestureCleanup = cleanup;
    this.addEventListener("pointermove", onMove);
    this.addEventListener("pointerup", onUp);
    this.addEventListener("pointercancel", onUp);
  }

  /** Abort whatever pointer gesture currently owns the event stream. Called
   *  by pinch-start so single-finger drags don't fight pinch for the same
   *  pointers. Each gesture's cleanup registers itself in
   *  `#activeGestureCleanup`; this just invokes and clears that. */
  #abortActiveGesture(): void {
    const cb = this.#activeGestureCleanup;
    this.#activeGestureCleanup = null;
    cb?.();
  }

  /** Always remove a touch pointer from the tracking map on release, even
   *  if no active gesture was listening for it. Prevents "ghost finger"
   *  state after a pinch-then-release where one finger lingered briefly. */
  #onGlobalPointerEnd = (e: PointerEvent): void => {
    if (e.pointerType === "touch") this.#touchPointers.delete(e.pointerId);
  };

  #onNodePointerDown(e: PointerEvent, nodeEl: HTMLElement): void {
    const id = nodeEl.dataset["id"]!;
    // If we're already editing this node, don't intercept — let the contenteditable handle.
    if (this.#editingId === id) return;

    // Defensive: wipe any stuck .dragging CSS from a previous session that
    // didn't clean up (lost pointerup due to window blur, etc.).
    for (const el of this.#nodeEls.values()) el.classList.remove("dragging");

    // Manual double-click detection. Deferred to a macrotask so the native
    // click sequence (pointerup, click, dblclick, focus adjustments) finishes
    // BEFORE we switch contentEditable on + focus. Otherwise browser default
    // behaviors during the click can fight with our programmatic focus.
    const now = performance.now();
    const last = this.#lastNodeDown;
    if (
      last &&
      last.id === id &&
      now - last.time < 500 &&
      Math.hypot(e.clientX - last.x, e.clientY - last.y) < 16
    ) {
      this.#lastNodeDown = null;
      const node = this.#doc.nodes.find((n) => n.id === id);
      if (node?.type === "text") {
        e.preventDefault();
        setTimeout(() => this.#beginEdit(id), 0);
        return;
      }
    }
    this.#lastNodeDown = { id, time: now, x: e.clientX, y: e.clientY };

    this.focus();

    // Selection: toggle with shift, otherwise replace. Node selection always
    // clears edge selection since they can't both be active at once.
    const hadEdgeSel = this.#selectedEdges.size > 0;
    if (hadEdgeSel) this.#selectedEdges.clear();
    if (e.shiftKey) {
      if (this.#selected.has(id)) this.#selected.delete(id);
      else this.#selected.add(id);
    } else if (!this.#selected.has(id)) {
      this.#selected.clear();
      this.#selected.add(id);
    }
    this.#syncSelectionClasses();
    if (hadEdgeSel) this.#renderEdges();

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
      // Pinch has taken over — stop updating node positions or we'll drag
      // the node along with the zoom gesture.
      if (this.#pinchActive) return;
      lastDx = (ev.clientX - startX) / this.#zoom;
      lastDy = (ev.clientY - startY) / this.#zoom;
      if (!dragging && Math.hypot(lastDx, lastDy) < 3) return; // dead zone
      dragging = true;
      // Now that a drag is underway, suppress text selection during the move.
      ev.preventDefault();
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
    const cleanup = (): void => {
      this.removeEventListener("pointermove", onMove);
      this.removeEventListener("pointerup", onUp);
      this.removeEventListener("pointercancel", onUp);
      for (const el of this.#nodeEls.values()) el.classList.remove("dragging");
      if (this.#activeGestureCleanup === cleanup) this.#activeGestureCleanup = null;
    };
    const onUp = (): void => {
      cleanup();
      // Commit only if we actually dragged AND pinch didn't hijack. If pinch
      // took over we roll the node positions back to their starts instead of
      // saving the half-finished drag.
      if (dragging && !this.#pinchActive) {
        let doc = this.#doc;
        for (const nid of this.#selected) {
          doc = moveNode(doc, nid, lastDx, lastDy);
        }
        this.#doc = doc;
        this.#renderEdges(); // final
        this.#emitChange();
      } else if (dragging) {
        // Pinch took over mid-drag — revert the nodes to their pre-drag spots
        // so we don't leave them stranded halfway.
        for (const [nid, pos] of startPositions) {
          const el = this.#nodeEls.get(nid);
          if (!el) continue;
          el.style.left = `${pos.x}px`;
          el.style.top = `${pos.y}px`;
        }
        this.#renderEdges();
      }
    };
    this.#activeGestureCleanup = cleanup;
    this.addEventListener("pointermove", onMove);
    this.addEventListener("pointerup", onUp);
    this.addEventListener("pointercancel", onUp);
  }

  #clearSelection(): void {
    const hadNodes = this.#selected.size > 0;
    const hadEdges = this.#selectedEdges.size > 0;
    this.#selected.clear();
    this.#selectedEdges.clear();
    if (hadNodes) this.#syncSelectionClasses();
    if (hadEdges) this.#renderEdges();
  }

  #syncSelectionClasses(): void {
    for (const [id, el] of this.#nodeEls) {
      el.classList.toggle("selected", this.#selected.has(id));
    }
  }

  // ── Edge creation (drag from handle) ─────────────────────────────────────

  #onHandlePointerDown(e: PointerEvent, nodeId: string, fromSide: CanvasSide): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const fromNode = this.#doc.nodes.find((n) => n.id === nodeId);
    if (!fromNode) return;

    const ghost = document.createElementNS(SVG_NS, "path") as SVGPathElement;
    ghost.classList.add("ghost");
    ghost.setAttribute("fill", "none");
    ghost.setAttribute("stroke", "var(--ls-color-accent, #7c6af7)");
    ghost.setAttribute("stroke-width", "2");
    ghost.setAttribute("stroke-linecap", "round");
    this.#edgesSvg.appendChild(ghost);

    this.#connecting = { fromNode: nodeId, fromSide, ghost, currentTarget: null };
    this.classList.add("connecting");
    try { this.setPointerCapture(e.pointerId); } catch { /* ok */ }

    const [startX, startY] = sidePoint(fromNode, fromSide);

    const onMove = (ev: PointerEvent): void => {
      const [wx, wy] = this.#screenToWorld(ev.clientX, ev.clientY);
      ghost.setAttribute("d", bezierPath(startX, startY, wx, wy));
      // Highlight potential drop target.
      const target = this.#nodeAtWorld(wx, wy);
      const nextTargetId = target && target.id !== nodeId ? target.id : null;
      if (this.#connecting && this.#connecting.currentTarget !== nextTargetId) {
        if (this.#connecting.currentTarget) {
          this.#nodeEls.get(this.#connecting.currentTarget)?.classList.remove("drop-target");
        }
        if (nextTargetId) {
          this.#nodeEls.get(nextTargetId)?.classList.add("drop-target");
        }
        this.#connecting.currentTarget = nextTargetId;
      }
    };
    const onUp = (ev: PointerEvent): void => {
      this.removeEventListener("pointermove", onMove);
      this.removeEventListener("pointerup", onUp);
      this.removeEventListener("pointercancel", onUp);
      this.classList.remove("connecting");
      ghost.remove();
      if (this.#connecting?.currentTarget) {
        this.#nodeEls.get(this.#connecting.currentTarget)?.classList.remove("drop-target");
      }

      const [wx, wy] = this.#screenToWorld(ev.clientX, ev.clientY);
      const target = this.#nodeAtWorld(wx, wy);
      if (target && target.id !== nodeId && target.type !== "group") {
        this.#doc = connectNodes(this.#doc, nodeId, target.id, { fromSide });
        this.#render();
        this.#emitChange();
      }
      this.#connecting = null;
    };
    this.addEventListener("pointermove", onMove);
    this.addEventListener("pointerup", onUp);
    this.addEventListener("pointercancel", onUp);
  }

  /** Hit-test: which node, if any, contains the given world coord. */
  #nodeAtWorld(wx: number, wy: number): CanvasNode | null {
    // Iterate in reverse so the top-most node wins for overlapping boxes.
    for (let i = this.#doc.nodes.length - 1; i >= 0; i--) {
      const n = this.#doc.nodes[i]!;
      if (wx >= n.x && wx <= n.x + n.width && wy >= n.y && wy <= n.y + n.height) {
        return n;
      }
    }
    return null;
  }

  // ── Resize (drag bottom-right grip) ──────────────────────────────────────

  #onResizePointerDown(e: PointerEvent, nodeId: string): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const node = this.#doc.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const el = this.#nodeEls.get(nodeId);
    if (!el) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = node.width;
    const startH = node.height;
    this.classList.add("resizing");
    try { this.setPointerCapture(e.pointerId); } catch { /* ok */ }

    let lastW = startW, lastH = startH;
    const onMove = (ev: PointerEvent): void => {
      lastW = Math.max(80, startW + (ev.clientX - startX) / this.#zoom);
      lastH = Math.max(40, startH + (ev.clientY - startY) / this.#zoom);
      el.style.width = `${lastW}px`;
      el.style.height = `${lastH}px`;
      // Redraw edges live so they follow the resized node's new sides.
      this.#renderEdgesLiveResize(nodeId, lastW, lastH);
    };
    const onUp = (): void => {
      this.classList.remove("resizing");
      this.removeEventListener("pointermove", onMove);
      this.removeEventListener("pointerup", onUp);
      this.removeEventListener("pointercancel", onUp);
      if (lastW !== startW || lastH !== startH) {
        this.#doc = resizeNode(this.#doc, nodeId, Math.round(lastW), Math.round(lastH));
        this.#renderEdges();
        this.#emitChange();
      }
    };
    this.addEventListener("pointermove", onMove);
    this.addEventListener("pointerup", onUp);
    this.addEventListener("pointercancel", onUp);
  }

  /** Redraw edges with a single node temporarily resized (used during drag). */
  #renderEdgesLiveResize(nodeId: string, w: number, h: number): void {
    [...this.#edgesSvg.querySelectorAll(":scope > path")].forEach((p) => p.remove());
    for (const edge of this.#doc.edges) {
      const from = this.#doc.nodes.find((n) => n.id === edge.fromNode);
      const to = this.#doc.nodes.find((n) => n.id === edge.toNode);
      if (!from || !to) continue;
      const fromProj = from.id === nodeId ? { ...from, width: w, height: h } : from;
      const toProj = to.id === nodeId ? { ...to, width: w, height: h } : to;
      this.#edgesSvg.appendChild(this.#edgePathBetween(edge, fromProj, toProj));
    }
  }

  // ── Edge selection ───────────────────────────────────────────────────────

  #onEdgePointerDown(e: PointerEvent, edgeId: string): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Clear node selection when picking an edge (and vice versa in node handler).
    this.#selected.clear();
    this.#syncSelectionClasses();
    if (e.shiftKey) {
      if (this.#selectedEdges.has(edgeId)) this.#selectedEdges.delete(edgeId);
      else this.#selectedEdges.add(edgeId);
    } else {
      this.#selectedEdges.clear();
      this.#selectedEdges.add(edgeId);
    }
    this.#renderEdges();
    this.focus();
  }

  // ── Double-click: add text node or enter edit mode ───────────────────────

  // Dblclick handling is attached directly to each text node in
  // #createNodeElement. Keeping the host stub empty preserves the existing
  // listener-attach/detach lifecycle without introducing dead behavior.
  #onDblClick = (_e: MouseEvent): void => { /* handled per-node */ };

  #onKeyDown = (e: KeyboardEvent): void => {
    // Don't steal keys while editing a text node.
    if (this.#editingId) {
      if (e.key === "Escape") {
        this.#commitEdit();
        e.preventDefault();
      }
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (this.#selected.size > 0) {
        e.preventDefault();
        this.#doc = removeNodes(this.#doc, new Set(this.#selected));
        this.#selected.clear();
        this.#render();
        this.#updateEmptyState();
        this.#emitChange();
        return;
      }
      if (this.#selectedEdges.size > 0) {
        e.preventDefault();
        let next = this.#doc;
        for (const id of this.#selectedEdges) next = removeEdge(next, id);
        this.#doc = next;
        this.#selectedEdges.clear();
        this.#renderEdges();
        this.#emitChange();
        return;
      }
    }
    if (e.key === "Escape") this.#clearSelection();
  };

  // ── Inline text editing ──────────────────────────────────────────────────

  /** Public so ls-app can expose a palette command as a keyboard fallback. */
  beginEditSelectedText(): boolean {
    if (this.#selected.size !== 1) return false;
    const id = [...this.#selected][0]!;
    const node = this.#doc.nodes.find((n) => n.id === id);
    if (node?.type !== "text") return false;
    this.#beginEdit(id);
    return true;
  }

  #beginEdit(id: string): void {
    if (this.#editingId === id) return;
    const el = this.#nodeEls.get(id);
    const node = this.#doc.nodes.find((n) => n.id === id);
    if (!el || !node || node.type !== "text") return;
    this.#editingId = id;
    this.#updateNodeElement(el, node);
    const body = el.querySelector<HTMLElement>(".text-body");
    if (!body) return;
    body.focus();
    // Chromium exposes ShadowRoot.getSelection() for caret placement inside
    // shadow trees; other engines fall back to window.getSelection.
    const shadowSel = (this.#shadow as unknown as { getSelection?: () => Selection | null }).getSelection;
    const sel = (typeof shadowSel === "function" ? shadowSel.call(this.#shadow) : null) ?? window.getSelection();
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
    this.#editingId = null;
    const el = this.#nodeEls.get(id);
    const body = el?.querySelector<HTMLElement>(".text-body");
    if (body) {
      const text = body.innerText.replace(/\n$/, "");
      const node = this.#doc.nodes.find((n) => n.id === id);
      if (node?.type === "text" && node.text !== text) {
        this.#doc = updateNode(this.#doc, id, { text } as Partial<TextNode>);
        this.#emitChange();
      }
    }
    // Re-render: the same body element stays, but contentEditable flips off
    // and innerHTML switches to the rendered markdown.
    if (el) {
      const node = this.#doc.nodes.find((n) => n.id === id);
      if (node) this.#updateNodeElement(el, node);
    }
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
    // Defer picking to the host app, which has access to the vault file list
    // and can open the quick-switcher in pick mode.
    this.dispatchEvent(new CustomEvent("request-file-pick", {
      bubbles: true,
      composed: true,
    }));
  }

  /** Insert a FileNode for the given vault path at the current viewport center. */
  insertFileNodeAtCenter(file: string): void {
    if (!file.trim()) return;
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
    // Content lives in its own wrapper so updates can replace body without
    // wiping the connection handles we add below.
    const content = document.createElement("div");
    content.className = "node-content";
    el.appendChild(content);

    // Direct pointerdown listener on the node. Double-click detection is
    // custom (see #lastNodeDown) AND we keep a native dblclick listener as
    // a fallback for browsers that do fire it cleanly.
    if (node.type !== "group") {
      el.addEventListener("pointerdown", (ev) => {
        this.#onNodePointerDown(ev, el);
      });
      el.addEventListener("dblclick", (ev) => {
        const current = this.#doc.nodes.find((n) => n.id === node.id);
        if (current?.type !== "text") return;
        ev.preventDefault();
        ev.stopPropagation();
        setTimeout(() => this.#beginEdit(node.id), 0);
      });
    }

    this.#updateNodeElement(el, node);
    // Groups don't carry edges.
    if (node.type !== "group") {
      for (const side of ["top", "right", "bottom", "left"] as CanvasSide[]) {
        const h = document.createElement("div");
        h.className = `handle ${side}`;
        h.dataset["side"] = side;
        h.addEventListener("pointerdown", (ev) => this.#onHandlePointerDown(ev, node.id, side));
        el.appendChild(h);
      }
    }
    // Resize grip — groups get one too (resizing a group is useful).
    const grip = document.createElement("div");
    grip.className = "resize-grip";
    grip.addEventListener("pointerdown", (ev) => this.#onResizePointerDown(ev, node.id));
    el.appendChild(grip);
    return el;
  }

  #updateNodeElement(el: HTMLElement, node: CanvasNode): void {
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.width = `${node.width}px`;
    el.style.height = `${node.height}px`;
    if (node.color) el.style.borderColor = resolveColor(node.color, "");

    // Re-render inner content into the dedicated .node-content wrapper so the
    // sibling connection handles aren't clobbered.
    const content = el.querySelector<HTMLElement>(":scope > .node-content") ?? (() => {
      const c = document.createElement("div");
      c.className = "node-content";
      el.prepend(c);
      return c;
    })();

    // For text nodes, reuse the existing body element across edit/render
    // transitions. Swapping the element out is what was causing focus loss
    // during double-click gestures.
    if (node.type === "text") {
      this.#renderTextBody(content, node);
      return;
    }

    content.replaceChildren();
    switch (node.type) {
      case "file": {
        const label = document.createElement("div");
        label.className = "node-label";
        label.textContent = "File";
        const link = document.createElement("a");
        link.className = "file-link";
        link.href = "#";
        link.textContent = node.file + (node.subpath ?? "");
        link.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.dispatchEvent(new CustomEvent("file-open", {
            bubbles: true, composed: true,
            detail: { path: node.file, subpath: node.subpath },
          }));
        });
        // Prevent the drag/selection path from capturing the click.
        link.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        content.append(label, link);
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
        a.addEventListener("pointerdown", (e) => e.stopPropagation());
        content.append(label, a);
        break;
      }
      case "group": {
        if (node.label) {
          const label = document.createElement("div");
          label.className = "node-label";
          label.textContent = node.label;
          content.appendChild(label);
        }
        break;
      }
    }
  }

  /** Render or update the body of a text node without replacing the element
   *  itself. This stability is crucial during edit-mode transitions — a DOM
   *  swap between pointerdown and pointerup will blur the contentEditable
   *  body before the user ever sees it focused. */
  #renderTextBody(content: HTMLElement, node: TextNode): void {
    let body = content.querySelector<HTMLElement>(":scope > .text-body");
    if (!body) {
      body = document.createElement("div");
      body.className = "text-body";
      content.replaceChildren(body);
    }

    const editing = this.#editingId === node.id;
    body.classList.toggle("editing", editing);

    if (editing) {
      // Don't overwrite content once editing starts — the user's keystrokes
      // live in the DOM. We only seed it on the first transition (when the
      // body was previously showing rendered markdown).
      if (body.dataset["mode"] !== "edit") {
        body.textContent = node.text || "";
        body.dataset["mode"] = "edit";
      }
      body.contentEditable = "true";
    } else {
      body.contentEditable = "false";
      body.dataset["mode"] = "rendered";
      if (node.text) {
        body.innerHTML = renderMarkdown(node.text);
        body.style.opacity = "";
        body.querySelectorAll<HTMLElement>("a.wikilink").forEach((a) => {
          a.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const target = a.dataset["wikilink"];
            if (!target) return;
            this.dispatchEvent(new CustomEvent("wikilink-click", {
              bubbles: true, composed: true, detail: { target },
            }));
          });
          a.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        });
        body.querySelectorAll<HTMLElement>("a:not(.wikilink)").forEach((a) => {
          a.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        });
      } else {
        body.textContent = "Double-click to edit";
        body.style.opacity = "0.5";
      }
    }
  }

  #renderEdges(): void {
    // Clear existing paths and endpoint handles (keep <defs>).
    [
      ...this.#edgesSvg.querySelectorAll(":scope > path"),
      ...this.#edgesSvg.querySelectorAll(":scope > circle"),
    ].forEach((n) => n.remove());
    for (const edge of this.#doc.edges) {
      const path = this.#createEdgePath(edge);
      if (path) this.#edgesSvg.appendChild(path);
    }
    // Draggable endpoint handles on selected edges.
    for (const edge of this.#doc.edges) {
      if (!this.#selectedEdges.has(edge.id)) continue;
      const from = this.#doc.nodes.find((n) => n.id === edge.fromNode);
      const to = this.#doc.nodes.find((n) => n.id === edge.toNode);
      if (!from || !to) continue;
      const [autoF, autoT] = autoSides(from, to);
      const [x1, y1] = sidePoint(from, edge.fromSide ?? autoF);
      const [x2, y2] = sidePoint(to, edge.toSide ?? autoT);
      this.#edgesSvg.appendChild(this.#createEndpoint(edge.id, "from", x1, y1));
      this.#edgesSvg.appendChild(this.#createEndpoint(edge.id, "to", x2, y2));
    }
  }

  #createEndpoint(edgeId: string, which: "from" | "to", x: number, y: number): SVGCircleElement {
    const c = document.createElementNS(SVG_NS, "circle") as SVGCircleElement;
    c.classList.add("endpoint");
    c.setAttribute("cx", String(x));
    c.setAttribute("cy", String(y));
    c.setAttribute("r", "6");
    c.addEventListener("pointerdown", (ev) => this.#onEndpointPointerDown(ev, edgeId, which));
    return c;
  }

  #onEndpointPointerDown(e: PointerEvent, edgeId: string, which: "from" | "to"): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const edge = this.#doc.edges.find((x) => x.id === edgeId);
    if (!edge) return;

    this.classList.add("endpoint-dragging");
    try { this.setPointerCapture(e.pointerId); } catch { /* ok */ }

    let dropTargetId: string | null = null;
    let dropSide: CanvasSide | null = null;

    const onMove = (ev: PointerEvent): void => {
      const [wx, wy] = this.#screenToWorld(ev.clientX, ev.clientY);
      const target = this.#nodeAtWorld(wx, wy);

      // Highlight updated drop target.
      if (dropTargetId && dropTargetId !== target?.id) {
        this.#nodeEls.get(dropTargetId)?.classList.remove("drop-target");
      }
      if (target && target.id !== dropTargetId) {
        this.#nodeEls.get(target.id)?.classList.add("drop-target");
      }
      dropTargetId = target && target.type !== "group" ? target.id : null;
      dropSide = target && target.type !== "group" ? nearestSide(target, wx, wy) : null;

      // Redraw edges with the endpoint at either the cursor (no target)
      // or the nearest side of the hovered target node.
      this.#renderEdgesLiveEndpoint(edge, which, wx, wy, target && target.type !== "group" ? target : null, dropSide);
    };
    const onUp = (): void => {
      this.removeEventListener("pointermove", onMove);
      this.removeEventListener("pointerup", onUp);
      this.removeEventListener("pointercancel", onUp);
      this.classList.remove("endpoint-dragging");
      if (dropTargetId) this.#nodeEls.get(dropTargetId)?.classList.remove("drop-target");

      if (dropTargetId && dropSide) {
        const otherId = which === "from" ? edge.toNode : edge.fromNode;
        // Don't create self-loops via rebinding.
        if (dropTargetId !== otherId || (which === "from" ? edge.fromSide !== dropSide : edge.toSide !== dropSide)) {
          const patch = which === "from"
            ? { fromNode: dropTargetId, fromSide: dropSide }
            : { toNode: dropTargetId, toSide: dropSide };
          this.#doc = {
            ...this.#doc,
            edges: this.#doc.edges.map((x) => (x.id === edgeId ? { ...x, ...patch } : x)),
          };
          this.#emitChange();
        }
      }
      this.#renderEdges();
    };
    this.addEventListener("pointermove", onMove);
    this.addEventListener("pointerup", onUp);
    this.addEventListener("pointercancel", onUp);
  }

  /** Redraw all edges, overriding the dragged edge's endpoint to follow the cursor / snap to a target side. */
  #renderEdgesLiveEndpoint(
    edge: CanvasEdge,
    which: "from" | "to",
    wx: number,
    wy: number,
    target: CanvasNode | null,
    side: CanvasSide | null
  ): void {
    [
      ...this.#edgesSvg.querySelectorAll(":scope > path"),
      ...this.#edgesSvg.querySelectorAll(":scope > circle"),
    ].forEach((n) => n.remove());

    for (const e of this.#doc.edges) {
      const from = this.#doc.nodes.find((n) => n.id === e.fromNode);
      const to = this.#doc.nodes.find((n) => n.id === e.toNode);
      if (!from || !to) continue;

      if (e.id === edge.id) {
        const [autoF, autoT] = autoSides(from, to);
        let [x1, y1] = sidePoint(from, e.fromSide ?? autoF);
        let [x2, y2] = sidePoint(to, e.toSide ?? autoT);
        if (which === "from") {
          if (target && side) [x1, y1] = sidePoint(target, side);
          else { x1 = wx; y1 = wy; }
        } else {
          if (target && side) [x2, y2] = sidePoint(target, side);
          else { x2 = wx; y2 = wy; }
        }
        const path = document.createElementNS(SVG_NS, "path") as SVGPathElement;
        path.setAttribute("d", bezierPath(x1, y1, x2, y2));
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "var(--ls-color-accent, #7c6af7)");
        path.style.color = "var(--ls-color-accent, #7c6af7)";
        path.setAttribute("stroke-width", "2");
        path.setAttribute("stroke-linecap", "round");
        path.classList.add("edge", "ghost");
        this.#edgesSvg.appendChild(path);
      } else {
        this.#edgesSvg.appendChild(this.#edgePathBetween(e, from, to));
      }
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

    const d = bezierPath(x1, y1, x2, y2);
    const path = document.createElementNS(SVG_NS, "path") as SVGPathElement;
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    const stroke = resolveColor(edge.color, "var(--ls-color-accent, #7c6af7)");
    path.setAttribute("stroke", stroke);
    path.style.color = stroke;
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.classList.add("edge");
    if (this.#selectedEdges.has(edge.id)) path.classList.add("selected");
    if (edge.toEnd !== "none") path.setAttribute("marker-end", "url(#arrow)");
    if (edge.fromEnd === "arrow") path.setAttribute("marker-start", "url(#arrow)");
    path.dataset["id"] = edge.id;
    path.addEventListener("pointerdown", (ev) => this.#onEdgePointerDown(ev, edge.id));
    return path;
  }

  // ── Zoom + trackpad pan ──────────────────────────────────────────────────

  #onWheel = (e: WheelEvent): void => {
    // If the wheel event originated inside a .node-content that has scrollable
    // overflow (oversized text node, etc.), let the browser scroll it natively
    // rather than consuming for canvas pan/zoom.
    const path = e.composedPath();
    for (const el of path) {
      if (el === this) break;
      if (!(el instanceof HTMLElement)) continue;
      if (!el.classList.contains("node-content")) continue;
      const scrollable =
        (el.scrollHeight > el.clientHeight && e.deltaY !== 0) ||
        (el.scrollWidth > el.clientWidth && e.deltaX !== 0);
      if (scrollable) return;
    }

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
