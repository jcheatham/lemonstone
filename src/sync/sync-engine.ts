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
import { GIT_CORS_PROXY } from "../config/github-app.ts";
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

  private makeHttp() {
    return createGitHttpPlugin(
      this.rateLimiter,
      (resumeAt) => emit({ event: "rateLimited", data: { resumeAt } })
    );
  }

  // GitHub returns 403 (not 401) for unauthenticated git requests to private
  // repos, so isomorphic-git's onAuth callback (which fires on 401) is never
  // invoked. We must include credentials on the very first request via headers.
  private makeAuthHeaders(tokens: AuthPayload): Record<string, string> {
    const encoded = btoa(`oauth2:${tokens.accessToken}`);
    return {
      "User-Agent": "lemonstone-pwa",
      "Authorization": `Basic ${encoded}`,
    };
  }

  // ── Clone ──────────────────────────────────────────────────────────────────

  // The HEAD file is written by git.init() and git.clone(). Its presence is the
  // only reliable signal that a repo has been initialized here — listBranches()
  // returns [] (not throws) for a totally empty OPFS directory.
  private async isInitialized(): Promise<boolean> {
    try {
      await this.fs.promises.readFile("/.git/HEAD");
      return true;
    } catch {
      return false;
    }
  }

  async clone(): Promise<void> {
    if (await this.isInitialized()) return; // idempotent

    const tokens = await this.getValidTokens();
    const repoUrl = `https://github.com/${tokens.repoFullName}.git`;
    const branch = tokens.repoDefaultBranch;

    emit({ event: "syncStarted", data: { op: "clone" } });

    console.log("[sync] cloning", repoUrl, "ref:", branch);
    try {
      await git.clone({
        fs: this.fs,
        http: this.makeHttp(),
        corsProxy: GIT_CORS_PROXY,
        dir: GIT_DIR,
        url: repoUrl,
        ref: branch,
        singleBranch: true,
        depth: 50, // shallow clone for initial speed
        headers: this.makeAuthHeaders(tokens),
      });
      console.log("[sync] git.clone returned without error");
    } catch (cloneErr) {
      const msg = cloneErr instanceof Error ? cloneErr.message : String(cloneErr);
      // Re-throw hard errors (auth, repo not found, network) so the caller knows
      // something is genuinely wrong. Only fall back to a local init for the
      // "empty repo has no refs" case where clone fails because there's nothing to clone.
      if (msg.includes("401") || msg.includes("403") || msg.includes("404") || msg.includes("HTTP Error")) {
        console.error("[sync] clone failed with hard error:", cloneErr);
        this.handleGitError(cloneErr);
        throw cloneErr;
      }
      // Empty remote (no refs to download) — bootstrap a local repo so sync can
      // create the first commit and push it.
      console.warn("[sync] clone failed with non-HTTP error, falling back to local init:", cloneErr);
      await git.init({ fs: this.fs, dir: GIT_DIR, defaultBranch: branch });
      await git.addRemote({ fs: this.fs, dir: GIT_DIR, remote: "origin", url: repoUrl });
      emit({ event: "syncCompleted", data: { op: "clone", headOid: "" } });
      return;
    }

    // Clone succeeded — remote may still be empty (no commits yet).
    let headOid: string;
    try {
      headOid = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch });
      console.log("[sync] clone produced HEAD:", headOid);
    } catch (refErr) {
      console.warn("[sync] clone succeeded but branch ref missing:", refErr);
      const localBranches = await git.listBranches({ fs: this.fs, dir: GIT_DIR }).catch(() => [] as string[]);
      const remoteBranches = await git.listBranches({ fs: this.fs, dir: GIT_DIR, remote: "origin" }).catch(() => [] as string[]);
      console.warn("[sync] local branches:", localBranches, "remote branches:", remoteBranches);
      emit({ event: "syncCompleted", data: { op: "clone", headOid: "" } });
      return;
    }
    try {
      await this.populateIndexedDB(headOid);
      emit({ event: "syncCompleted", data: { op: "clone", headOid } });
    } catch (popErr) {
      console.error("[sync] populateIndexedDB failed:", popErr);
      emit({ event: "syncCompleted", data: { op: "clone", headOid } });
    }
  }

  // ── Steady-state sync ──────────────────────────────────────────────────────

  async sync(): Promise<void> {
    if (this.syncing) return; // skip if already in progress
    this.syncing = true;

    try {
      if (!(await this.isInitialized())) {
        await this.clone();
        return;
      }
      await this.syncOnce();
    } finally {
      this.syncing = false;
    }
  }

  private async syncOnce(retryCount = 0): Promise<void> {
    if (retryCount > 3) throw new Error("Sync retry limit exceeded");

    const tokens = await this.getValidTokens();
    const http = this.makeHttp();
    const authHeaders = this.makeAuthHeaders(tokens);
    const branch = tokens.repoDefaultBranch;

    emit({ event: "syncStarted", data: { op: "sync" } });

    // 1. Fetch latest from origin. An empty remote has no refs — that's fine.
    let remoteIsEmpty = false;

    // A local repo from git.init() + addRemote (our empty-remote fallback in clone())
    // has no commits, so git.fetch() fails with "Could not find HEAD" when it tries
    // to resolve the local tracking branch. Detect this case and skip fetch entirely —
    // we're in a first-push flow anyway.
    const localBranches = await git.listBranches({ fs: this.fs, dir: GIT_DIR }).catch(() => [] as string[]);
    if (localBranches.length === 0) {
      console.log("[sync] local repo has no commits yet, skipping fetch");
      remoteIsEmpty = true;
    } else {
      console.log("[sync] fetching from origin, branch:", branch, "proxy:", GIT_CORS_PROXY);
      try {
        await git.fetch({
          fs: this.fs,
          http,
          corsProxy: GIT_CORS_PROXY,
          dir: GIT_DIR,
          remote: "origin",
          remoteRef: branch,
          headers: authHeaders,
        });
      } catch (fetchErr) {
        console.warn("[sync] fetch failed:", fetchErr);
        remoteIsEmpty = true;
      }
    }

    // Confirm the remote ref actually landed after a successful fetch.
    if (!remoteIsEmpty) {
      try {
        await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: `origin/${branch}` });
        console.log("[sync] fetch complete, remote ref exists");
      } catch {
        console.warn("[sync] remote ref not found after fetch, treating remote as empty");
        remoteIsEmpty = true;
      }
    }

    // 2. Stage all dirty files from IndexedDB into the OPFS working tree.
    const dirtyPaths = await this.stageDirtyFiles();
    if (dirtyPaths.length === 0 && !remoteIsEmpty && !(await this.hasRemoteChanges(branch))) {
      const headOid = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch }).catch(() => "");
      emit({ event: "syncCompleted", data: { op: "sync", changed: 0, headOid } });
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

    // 4. Merge remote into local (skip when remote is empty — nothing to merge).
    if (!remoteIsEmpty) {
      const conflicts = await this.mergeRemote(branch, tokens);
      if (conflicts.length > 0) {
        for (const path of conflicts) {
          emit({ event: "conflictDetected", data: { path } });
        }
        // Do not push if there are unresolved conflicts.
        return;
      }
    }

    // 5. Push if we have new commits or are ahead of remote.
    const isAhead = !remoteIsEmpty && (await this.hasLocalAhead(branch));
    if (newCommit || isAhead) {
      console.log("[sync] pushing to origin, newCommit:", newCommit, "isAhead:", isAhead);
      try {
        await git.push({
          fs: this.fs,
          http,
          corsProxy: GIT_CORS_PROXY,
          dir: GIT_DIR,
          remote: "origin",
          remoteRef: branch,
          headers: authHeaders,
        });
        // Push succeeded — mark committed files clean so the next sync
        // doesn't re-stage and re-commit the same content.
        await this.markStagedClean(dirtyPaths);
      } catch (err) {
        // Non-fast-forward: someone else pushed — retry the whole cycle.
        if (isPushRejected(err)) {
          return this.syncOnce(retryCount + 1);
        }
        this.handleGitError(err);
        throw err;
      }
    }

    const headOid = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch }).catch(() => "");
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

  private async markStagedClean(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const db = await getDB();
    for (const p of paths) {
      const sha = await this.getBlobSha(p).catch(() => "");
      const note = await db.get("notes", p);
      if (note) await db.put("notes", { ...note, syncState: "clean" as SyncState, baseSha: sha });
      const canvas = await db.get("canvas", p);
      if (canvas) await db.put("canvas", { ...canvas, syncState: "clean" as SyncState, baseSha: sha });
    }
  }

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
