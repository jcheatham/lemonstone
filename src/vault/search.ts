// MiniSearch wrapper with snapshot support (§7.4).
import MiniSearch from "minisearch";
import { parseFrontmatter } from "./frontmatter.ts";
import { extractAllTags } from "./tags.ts";

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  terms: string[];
}

interface SearchDoc {
  id: string;   // path
  path: string;
  title: string;
  body: string;
  tags: string; // space-joined for MiniSearch
}

const SEARCH_OPTIONS = {
  fields: ["title", "body", "tags", "path"] as string[],
  storeFields: ["title", "path"] as Array<keyof SearchDoc>,
};

function makeDoc(path: string, content: string): SearchDoc {
  const { frontmatter, body } = parseFrontmatter(content);
  const tags = extractAllTags(body, frontmatter);
  const titleMatch = /^#\s+(.+)$/m.exec(body);
  const filename = path.split("/").pop() ?? path;
  const title = titleMatch
    ? titleMatch[1]!.trim()
    : filename.replace(/\.[^.]+$/, "");

  return {
    id: path,
    path,
    title,
    body,
    tags: tags.join(" "),
  };
}

export class VaultSearch {
  private ms: MiniSearch<SearchDoc>;

  constructor() {
    this.ms = new MiniSearch<SearchDoc>(SEARCH_OPTIONS);
  }

  add(path: string, content: string): void {
    const doc = makeDoc(path, content);
    if (this.ms.has(path)) {
      this.ms.replace(doc);
    } else {
      this.ms.add(doc);
    }
  }

  remove(path: string): void {
    if (this.ms.has(path)) {
      this.ms.discard(path);
    }
  }

  search(
    query: string,
    opts?: { fields?: string[]; prefix?: boolean; fuzzy?: number }
  ): SearchResult[] {
    if (!query.trim()) return [];

    const results = this.ms.search(query, {
      prefix: opts?.prefix ?? true,
      fuzzy: opts?.fuzzy ?? 0.2,
      boost: { title: 2 },
      fields: opts?.fields as string[] | undefined,
    });

    return results.map((r) => ({
      path: r.path as string,
      title: r.title as string,
      score: r.score,
      terms: r.terms,
    }));
  }

  /** Returns paths of all notes that contain the query as a regex (slow path). */
  async searchRegex(
    pattern: RegExp,
    loadNote: (path: string) => Promise<string | null>
  ): Promise<string[]> {
    const allDocs = this.ms.search("", { prefix: false, fuzzy: 0 });
    const paths = allDocs.map((d) => d.path as string);
    const matches: string[] = [];
    for (const path of paths) {
      const content = await loadNote(path);
      if (content && pattern.test(content)) matches.push(path);
    }
    return matches;
  }

  /** Serialize index to JSON string for snapshot storage. */
  serialize(): string {
    return JSON.stringify(this.ms);
  }

  /** Rebuild a VaultSearch from a serialized snapshot. */
  static deserialize(json: string): VaultSearch {
    const vs = new VaultSearch();
    vs.ms = MiniSearch.loadJSON<SearchDoc>(json, SEARCH_OPTIONS);
    return vs;
  }

  get documentCount(): number {
    return this.ms.documentCount;
  }
}
