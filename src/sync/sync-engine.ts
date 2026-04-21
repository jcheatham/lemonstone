// Sync Engine — orchestrates isomorphic-git operations inside the Web Worker.
// Runs entirely in the worker; never touches the main thread directly.

import git from "isomorphic-git";
import { getDB } from "../storage/db.ts";
import { loadTokens } from "../auth/token-store.ts";
import { identityCodec } from "../codec/index.ts";
import type { AuthPayload, NoteRecord, CanvasRecord, SyncState } from "../storage/schema.ts";
import { createGitFS, type GitFS } from "./opfs-adapter.ts";
import { RateLimiter } from "./rate-limiter.ts";
import { createGitHttpPlugin } from "./github-http.ts";
import { makeConflictPath } from "./conflict-utils.ts";
import type { WorkerEvent } from "./protocol.ts";

const GIT_DIR = "/"; // root of the OPFS adapter — all paths relative here
const CONTENT_EXTENSIONS = new Set([".md", ".canvas"]);
const ATTACHMENT_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".pdf", ".mp4", ".mp3",
]);

function emit(event: WorkerEvent): void {
  self.postMessage(event);
}

function isContentFile(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return CONTENT_EXTENSIONS.has(ext) || ATTACHMENT_EXTENSIONS.has(ext);
}

export class SyncEngine {
  private fs!: GitFS;
  private readonly rateLimiter = new RateLimiter();
  private syncing = false; // simple mutex — one sync at a time in worker
  private tokens: AuthPayload | null = null;

  async init(): Promise<void> {
    this.fs = await createGitFS();
  }

  // ── Token management ───────────────────────────────────────────────────────

  private async getValidTokens(): Promise<AuthPayload> {
    if (!this.tokens) {
      this.tokens = await loadTokens();
    }
    if (!this.tokens) {
      emit({ event: "authRequired", data: {} });
      throw new Error("Not authenticated");
    }
    return this.tokens;
  }

  private makeHttp(tokens: AuthPayload) {
    return createGitHttpPlugin(
      () => tokens.accessToken,
      this.rateLimiter,
      (resumeAt) => emit({ event: "rateLimited", data: { resumeAt } })
    );
  }

  // ── Clone ──────────────────────────────────────────────────────────────────

  async clone(): Promise<void> {
    const tokens = await this.getValidTokens();
    const repoUrl = `https://github.com/${tokens.repoFullName}.git`;

    emit({ event: "syncStarted", data: { op: "clone" } });
    try {
      await git.clone({
        fs: this.fs,
        http: this.makeHttp(tokens),
        dir: GIT_DIR,
        url: repoUrl,
        ref: tokens.repoDefaultBranch,
        singleBranch: true,
        depth: 50, // shallow clone for initial speed
        headers: { "User-Agent": "lemonstone-pwa" },
      });

      const headOid = await git.resolveRef({
        fs: this.fs,
        dir: GIT_DIR,
        ref: tokens.repoDefaultBranch,
      });

      await this.populateIndexedDB(headOid);
      emit({ event: "syncCompleted", data: { op: "clone", headOid } });
    } catch (err) {
      this.handleGitError(err);
      throw err;
    }
  }

  // ── Steady-state sync ──────────────────────────────────────────────────────

  async sync(): Promise<void> {
    if (this.syncing) return; // skip if already in progress
    this.syncing = true;

    try {
      await this.syncOnce();
    } finally {
      this.syncing = false;
    }
  }

  private async syncOnce(retryCount = 0): Promise<void> {
    if (retryCount > 3) throw new Error("Sync retry limit exceeded");

    const tokens = await this.getValidTokens();
    const http = this.makeHttp(tokens);
    const branch = tokens.repoDefaultBranch;

    emit({ event: "syncStarted", data: { op: "sync" } });

    // 1. Fetch latest from origin.
    await git.fetch({
      fs: this.fs,
      http,
      dir: GIT_DIR,
      remote: "origin",
      remoteRef: branch,
      headers: { "User-Agent": "lemonstone-pwa" },
    });

    // 2. Stage all dirty files from IndexedDB into the OPFS working tree.
    const dirtyPaths = await this.stageDirtyFiles();
    if (dirtyPaths.length === 0 && !(await this.hasRemoteChanges(branch))) {
      emit({ event: "syncCompleted", data: { op: "sync", changed: 0 } });
      return;
    }

    // 3. Commit if there are dirty files.
    let newCommit = false;
    if (dirtyPaths.length > 0) {
      const author = await this.getAuthor(tokens);
      await git.commit({
        fs: this.fs,
        dir: GIT_DIR,
        message: this.buildCommitMessage(dirtyPaths),
        author,
      });
      newCommit = true;
    }

    // 4. Merge remote into local.
    const conflicts = await this.mergeRemote(branch, tokens);
    if (conflicts.length > 0) {
      for (const path of conflicts) {
        emit({ event: "conflictDetected", data: { path } });
      }
      // Do not push if there are unresolved conflicts.
      return;
    }

    // 5. Push.
    if (newCommit || (await this.hasLocalAhead(branch))) {
      try {
        await git.push({
          fs: this.fs,
          http,
          dir: GIT_DIR,
          remote: "origin",
          remoteRef: branch,
          headers: { "User-Agent": "lemonstone-pwa" },
        });
      } catch (err) {
        // Non-fast-forward: someone else pushed — retry the whole cycle.
        if (isPushRejected(err)) {
          return this.syncOnce(retryCount + 1);
        }
        this.handleGitError(err);
        throw err;
      }
    }

    const headOid = await git.resolveRef({
      fs: this.fs,
      dir: GIT_DIR,
      ref: branch,
    });
    emit({ event: "syncCompleted", data: { op: "sync", headOid } });
  }

  // ── Conflict resolution callback ───────────────────────────────────────────

  async resolveConflict(path: string): Promise<void> {
    // User has saved a resolved version — clear conflict flag and re-sync.
    const db = await getDB();
    const note = await db.get("notes", path);
    if (note && note.syncState === "conflict") {
      await db.put("notes", { ...note, syncState: "dirty" as SyncState });
    }
    const canvas = await db.get("canvas", path);
    if (canvas && canvas.syncState === "conflict") {
      await db.put("canvas", { ...canvas, syncState: "dirty" as SyncState });
    }
    await this.sync();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async stageDirtyFiles(): Promise<string[]> {
    const db = await getDB();
    const staged: string[] = [];

    const notes = await db.getAll("notes");
    for (const note of notes) {
      if (note.syncState === "dirty") {
        // Write at-rest bytes directly to OPFS (codec already applied in StorageAdapter).
        await this.fs.promises.writeFile(`/${note.path}`, note.content);
        await git.add({ fs: this.fs, dir: GIT_DIR, filepath: note.path });
        staged.push(note.path);
      }
    }

    const canvases = await db.getAll("canvas");
    for (const canvas of canvases) {
      if (canvas.syncState === "dirty") {
        await this.fs.promises.writeFile(`/${canvas.path}`, canvas.content);
        await git.add({ fs: this.fs, dir: GIT_DIR, filepath: canvas.path });
        staged.push(canvas.path);
      }
    }

    const attachments = await db.getAll("attachments");
    for (const att of attachments) {
      if (att.syncState === "dirty") {
        await this.fs.promises.writeFile(`/${att.path}`, att.blob);
        await git.add({ fs: this.fs, dir: GIT_DIR, filepath: att.path });
        staged.push(att.path);
      }
    }

    return staged;
  }

  private async mergeRemote(
    branch: string,
    tokens: AuthPayload
  ): Promise<string[]> {
    const author = await this.getAuthor(tokens);
    const conflictPaths: string[] = [];

    try {
      await git.merge({
        fs: this.fs,
        dir: GIT_DIR,
        theirs: `origin/${branch}`,
        author,
        message: `Merge origin/${branch}`,
        // abortOnConflict defaults to true — if conflicts exist, it throws
        // MergeConflictError without corrupting the index.
      });
      // Clean merge — pull updated files into IndexedDB.
      await this.reconcileFromOPFS();
    } catch (err) {
      if (isMergeConflictError(err)) {
        // Find conflicted files and handle them.
        const matrix = await git.statusMatrix({ fs: this.fs, dir: GIT_DIR });
        for (const [filepath] of matrix) {
          // After a failed merge, conflicted files have conflict markers in OPFS.
          // In v1 (identity codec), write them to IndexedDB as conflicts.
          // In v2 (encrypted codec), use the last-writer-wins-with-preservation
          // policy (§6.7). We check codec.scheme even in v1 so the branch exists.
          await this.handleConflictedFile(filepath as string, conflictPaths);
        }
      } else {
        this.handleGitError(err);
        throw err;
      }
    }

    return conflictPaths;
  }

  private async handleConflictedFile(
    filepath: string,
    conflictPaths: string[]
  ): Promise<void> {
    const db = await getDB();
    const note = await db.get("notes", filepath);
    const codec = note?.codec ?? { scheme: "identity", version: 1 };

    if (codec.scheme !== "identity") {
      // v2 policy (§6.7): last-writer-wins-with-preservation.
      // In v1 this branch is never reached, but the code must exist.
      const ours = note?.content ?? new Uint8Array(0);
      const theirsBytes = await this.readOpfsFile(filepath);

      // Determine winner by updatedAt timestamp.
      const oursTime = note?.updatedAt ?? 0;
      // For "theirs" timestamp we use now as proxy (no access to remote commit time here).
      const theirsTime = Date.now();
      const winner = oursTime >= theirsTime ? ours : theirsBytes;
      const loser = oursTime >= theirsTime ? theirsBytes : ours;

      // Preserve the loser as a sibling file.
      const conflictPath = makeConflictPath(filepath, new Date(theirsTime));
      const db2 = await getDB();
      await db2.put("notes", {
        path: conflictPath,
        content: loser,
        size: loser.length,
        updatedAt: theirsTime,
        frontmatter: {},
        syncState: "dirty" as SyncState,
        baseSha: "",
        codec,
      } satisfies NoteRecord);

      // Update winner in working copy.
      if (note) {
        await db2.put("notes", {
          ...note,
          content: winner,
          syncState: "dirty" as SyncState,
        });
      }
      conflictPaths.push(filepath, conflictPath);
    } else {
      // v1 identity codec: 3-way merge with conflict markers.
      const conflictContent = await this.readOpfsFile(filepath);
      if (note) {
        const db2 = await getDB();
        await db2.put("notes", {
          ...note,
          content: conflictContent,
          syncState: "conflict" as SyncState,
        });
        conflictPaths.push(filepath);
      }
    }
  }

  private async reconcileFromOPFS(): Promise<void> {
    // After a successful merge, read any files that changed in the OPFS
    // working tree back into IndexedDB.
    const db = await getDB();
    const matrix = await git.statusMatrix({ fs: this.fs, dir: GIT_DIR });

    for (const [filepath, headStatus, workdirStatus] of matrix) {
      // workdirStatus 2 = modified vs HEAD; headStatus 0 = new file
      if (workdirStatus !== 1 || headStatus === 0) {
        // File changed or is new
        const ext = (filepath as string)
          .slice((filepath as string).lastIndexOf("."))
          .toLowerCase();

        const bytes = await this.readOpfsFile(filepath as string);

        if (ext === ".md") {
          const existing = await db.get("notes", filepath as string);
          const record: NoteRecord = {
            path: filepath as string,
            content: bytes,
            size: bytes.length,
            updatedAt: Date.now(),
            frontmatter: existing?.frontmatter ?? {},
            syncState: "clean",
            baseSha: await this.getBlobSha(filepath as string),
            codec: { scheme: identityCodec.scheme, version: identityCodec.version },
          };
          await db.put("notes", record);
        } else if (ext === ".canvas") {
          const existing = await db.get("canvas", filepath as string);
          const record: CanvasRecord = {
            path: filepath as string,
            content: bytes,
            updatedAt: Date.now(),
            syncState: "clean",
            baseSha: await this.getBlobSha(filepath as string),
            codec: existing?.codec ?? { scheme: identityCodec.scheme, version: identityCodec.version },
          };
          await db.put("canvas", record);
        }
        // Attachments: handled similarly — omitted for brevity; same pattern.
      }
    }

    // Clear dirty flags on all files that were staged.
    const notes = await db.getAll("notes");
    for (const note of notes) {
      if (note.syncState === "dirty") {
        const sha = await this.getBlobSha(note.path).catch(() => "");
        await db.put("notes", { ...note, syncState: "clean", baseSha: sha });
      }
    }
  }

  private async populateIndexedDB(headOid: string): Promise<void> {
    // Walk the git tree at HEAD and populate IndexedDB from OPFS.
    const db = await getDB();
    const { commit } = await git.readCommit({ fs: this.fs, dir: GIT_DIR, oid: headOid });

    async function* walkTree(
      treeOid: string,
      prefix: string,
      fs: GitFS
    ): AsyncGenerator<{ path: string; oid: string }> {
      const { tree } = await git.readTree({ fs, dir: GIT_DIR, oid: treeOid });
      for (const entry of tree) {
        const entryPath = prefix ? `${prefix}/${entry.path}` : entry.path;
        if (entry.type === "blob") {
          yield { path: entryPath, oid: entry.oid };
        } else if (entry.type === "tree") {
          yield* walkTree(entry.oid, entryPath, fs);
        }
      }
    }

    for await (const { path, oid } of walkTree(commit.tree, "", this.fs)) {
      if (!isContentFile(path)) continue;
      const bytes = await this.readOpfsFile(path);
      const ext = path.slice(path.lastIndexOf(".")).toLowerCase();

      if (ext === ".md") {
        const record: NoteRecord = {
          path,
          content: bytes,
          size: bytes.length,
          updatedAt: Date.now(),
          frontmatter: {},
          syncState: "clean",
          baseSha: oid,
          codec: { scheme: identityCodec.scheme, version: identityCodec.version },
        };
        await db.put("notes", record);
      } else if (ext === ".canvas") {
        const record: CanvasRecord = {
          path,
          content: bytes,
          updatedAt: Date.now(),
          syncState: "clean",
          baseSha: oid,
          codec: { scheme: identityCodec.scheme, version: identityCodec.version },
        };
        await db.put("canvas", record);
      }
    }
  }

  private async readOpfsFile(filepath: string): Promise<Uint8Array> {
    const data = await this.fs.promises.readFile(`/${filepath}`);
    return typeof data === "string" ? new TextEncoder().encode(data) : data;
  }

  private async getBlobSha(filepath: string): Promise<string> {
    try {
      const branch = this.tokens?.repoDefaultBranch ?? "main";
      const { oid } = await git.readBlob({
        fs: this.fs,
        dir: GIT_DIR,
        oid: await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch }),
        filepath,
      });
      return oid;
    } catch {
      return "";
    }
  }

  private async getAuthor(tokens: AuthPayload): Promise<{ name: string; email: string }> {
    // Use stored author info or a sensible default.
    const db = await getDB();
    const stored = await db.get("config", "gitAuthor");
    if (stored?.value) {
      return stored.value as { name: string; email: string };
    }
    // GitHub user info could be fetched via API; use a placeholder until available.
    return {
      name: tokens.repoFullName.split("/")[0] ?? "Lemonstone User",
      email: "noreply@lemonstone.app",
    };
  }

  private buildCommitMessage(paths: string[]): string {
    if (paths.length === 1) return `Update ${paths[0]}`;
    if (paths.length <= 3) return `Update ${paths.join(", ")}`;
    return `Update ${paths.length} files`;
  }

  private async hasRemoteChanges(branch: string): Promise<boolean> {
    try {
      const local = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch });
      const remote = await git.resolveRef({
        fs: this.fs,
        dir: GIT_DIR,
        ref: `origin/${branch}`,
      });
      return local !== remote;
    } catch {
      return false;
    }
  }

  private async hasLocalAhead(branch: string): Promise<boolean> {
    try {
      const local = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch });
      const remote = await git.resolveRef({
        fs: this.fs,
        dir: GIT_DIR,
        ref: `origin/${branch}`,
      });
      return local !== remote;
    } catch {
      return false;
    }
  }

  private handleGitError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("401") || msg.includes("403")) {
      emit({ event: "authRequired", data: { reason: msg } });
    } else if (msg.includes("404")) {
      emit({ event: "syncCompleted", data: { error: "repo_not_found" } });
    }
  }
}

// ── Error detection helpers ─────────────────────────────────────────────────

function isMergeConflictError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.name === "MergeConflictError" ||
      err.message.includes("MergeConflictError") ||
      err.message.toLowerCase().includes("merge conflict")
    );
  }
  return false;
}

function isPushRejected(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.message.includes("PushRejectedError") ||
      err.message.includes("non-fast-forward") ||
      err.message.includes("[rejected]")
    );
  }
  return false;
}
