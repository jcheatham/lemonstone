// Pure-function mutation API for CanvasDocument. Every operation returns a
// new document; callers replace the old reference. Keeps undo/redo, diffing,
// and React-free change detection straightforward.

import type {
  CanvasDocument,
  CanvasNode,
  CanvasEdge,
  CanvasSide,
} from "./types.ts";

function uid(): string {
  // Canvas spec requires unique string IDs. UUID is overkill; Obsidian uses
  // 16-char hex. We match that style.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Node mutations ──────────────────────────────────────────────────────────

export function addNode(doc: CanvasDocument, node: Omit<CanvasNode, "id"> & { id?: string }): CanvasDocument {
  const full = { ...node, id: node.id ?? uid() } as CanvasNode;
  return { ...doc, nodes: [...doc.nodes, full] };
}

export function updateNode(
  doc: CanvasDocument,
  id: string,
  patch: Partial<CanvasNode>
): CanvasDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as CanvasNode) : n)),
  };
}

export function moveNode(doc: CanvasDocument, id: string, dx: number, dy: number): CanvasDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === id ? ({ ...n, x: n.x + dx, y: n.y + dy } as CanvasNode) : n
    ),
  };
}

export function resizeNode(
  doc: CanvasDocument,
  id: string,
  width: number,
  height: number
): CanvasDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === id
        ? ({ ...n, width: Math.max(40, width), height: Math.max(30, height) } as CanvasNode)
        : n
    ),
  };
}

export function removeNode(doc: CanvasDocument, id: string): CanvasDocument {
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== id),
    // Cascade: drop edges that referenced the removed node.
    edges: doc.edges.filter((e) => e.fromNode !== id && e.toNode !== id),
  };
}

export function removeNodes(doc: CanvasDocument, ids: Set<string>): CanvasDocument {
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !ids.has(n.id)),
    edges: doc.edges.filter((e) => !ids.has(e.fromNode) && !ids.has(e.toNode)),
  };
}

// ── Edge mutations ──────────────────────────────────────────────────────────

export function connectNodes(
  doc: CanvasDocument,
  fromNode: string,
  toNode: string,
  opts: { fromSide?: CanvasSide; toSide?: CanvasSide; label?: string } = {}
): CanvasDocument {
  // No-op if an identical edge already exists.
  const exists = doc.edges.some(
    (e) =>
      e.fromNode === fromNode &&
      e.toNode === toNode &&
      e.fromSide === opts.fromSide &&
      e.toSide === opts.toSide
  );
  if (exists) return doc;
  const edge: CanvasEdge = {
    id: uid(),
    fromNode,
    toNode,
    ...opts,
  };
  return { ...doc, edges: [...doc.edges, edge] };
}

export function updateEdge(
  doc: CanvasDocument,
  id: string,
  patch: Partial<CanvasEdge>
): CanvasDocument {
  return {
    ...doc,
    edges: doc.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  };
}

export function removeEdge(doc: CanvasDocument, id: string): CanvasDocument {
  return { ...doc, edges: doc.edges.filter((e) => e.id !== id) };
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function getNode(doc: CanvasDocument, id: string): CanvasNode | undefined {
  return doc.nodes.find((n) => n.id === id);
}

export function getEdgesForNode(doc: CanvasDocument, id: string): CanvasEdge[] {
  return doc.edges.filter((e) => e.fromNode === id || e.toNode === id);
}

/**
 * Union-merge two canvases for "keep both" conflict resolution.
 * Nodes and edges from `a` win on ID collisions — random UUID IDs make
 * collisions vanishingly rare in practice, but if the same node was edited
 * on both sides, the local version is preserved.
 */
export function mergeCanvases(a: CanvasDocument, b: CanvasDocument): CanvasDocument {
  const nodeIds = new Set(a.nodes.map((n) => n.id));
  const edgeIds = new Set(a.edges.map((e) => e.id));
  return {
    ...a,
    nodes: [...a.nodes, ...b.nodes.filter((n) => !nodeIds.has(n.id))],
    edges: [...a.edges, ...b.edges.filter((e) => !edgeIds.has(e.id))],
  };
}

/**
 * Bounding box of a set of nodes (or all nodes if ids is omitted). Returns
 * null if there are no matching nodes.
 */
export function boundingBox(
  doc: CanvasDocument,
  ids?: Iterable<string>
): { x: number; y: number; width: number; height: number } | null {
  const set = ids ? new Set(ids) : null;
  const targets = set ? doc.nodes.filter((n) => set.has(n.id)) : doc.nodes;
  if (targets.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of targets) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
