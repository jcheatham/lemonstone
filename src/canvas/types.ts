// JSON Canvas v1.0 — https://jsoncanvas.org/spec/1.0/
// On-disk format for .canvas files. Kept as close to the spec as possible
// so files round-trip with Obsidian's canvas feature.

export type CanvasColor =
  | "1" | "2" | "3" | "4" | "5" | "6"  // preset palette
  | string;                              // #rrggbb hex

export type CanvasSide = "top" | "right" | "bottom" | "left";

export type CanvasEdgeEnd = "none" | "arrow";

export interface CanvasNodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
}

export interface TextNode extends CanvasNodeBase {
  type: "text";
  text: string;
}

/** Reference to another file in the vault (Markdown note or attachment). */
export interface FileNode extends CanvasNodeBase {
  type: "file";
  file: string;          // vault-relative path
  subpath?: string;      // optional #heading or #^block-id
}

export interface LinkNode extends CanvasNodeBase {
  type: "link";
  url: string;
}

export interface GroupNode extends CanvasNodeBase {
  type: "group";
  label?: string;
  background?: string;
  backgroundStyle?: "cover" | "ratio" | "repeat";
}

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode;

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: CanvasSide;
  toSide?: CanvasSide;
  fromEnd?: CanvasEdgeEnd;
  toEnd?: CanvasEdgeEnd;
  color?: CanvasColor;
  label?: string;
}

export interface CanvasDocument {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  // The spec permits custom top-level fields — we preserve them on parse so
  // we don't drop data written by other clients (e.g. Obsidian metadata).
  [extra: string]: unknown;
}

export function emptyCanvas(): CanvasDocument {
  return { nodes: [], edges: [] };
}

/**
 * Parse a canvas file's text content. Returns an empty document on malformed
 * input so the editor can still open a damaged file and let the user repair it.
 */
export function parseCanvas(text: string): CanvasDocument {
  if (!text || !text.trim()) return emptyCanvas();
  try {
    const parsed = JSON.parse(text) as Partial<CanvasDocument>;
    return {
      ...parsed,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    return emptyCanvas();
  }
}

export function serializeCanvas(doc: CanvasDocument): string {
  // Stable key order (nodes before edges) and 2-space indent match Obsidian's
  // output so diffs are clean.
  const { nodes, edges, ...rest } = doc;
  const ordered = { nodes, edges, ...rest };
  return JSON.stringify(ordered, null, 2) + "\n";
}
