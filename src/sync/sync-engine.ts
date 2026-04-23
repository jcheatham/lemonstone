// Sync Engine — orchestrates isomorphic-git operations inside the Web Worker.
// Runs entirely in the worker; never touches the main thread directly.

import git from "isomorphic-git";
import { getDB } from "../storage/db.ts";
import { loadTokens } from "../auth/token-store.ts";
import {
  identityCodec,
  KEYS_JSON_PATH,
  isKeysFile,
  layersForPath,
  type Zone,
} from "../codec/index.ts";
import type { CodecDescriptor } from "../codec/index.ts";
import type { AuthPayload, NoteRecord, CanvasRecord, SyncState } from "../storage/schema.ts";
import { createGitFS, type GitFS } from "./opfs-adapter.ts";
import { RateLimiter } from "./rate-limiter.ts";
import { createGitHttpPlugin } from "./github-http.ts";
import { makeConflictPath } from "./conflict-utils.ts";
import { GIT_CORS_PROXY } from "../config/github-app.ts";
import type { WorkerEvent } from "./protocol.ts";

const GIT_DIR = "/"; // root of the OPFS adapter — all paths relative here
// Text-ish extensions get treated like notes (stored in the notes store,
// opened in the markdown/text editor). Easy to extend as we add support.
const TEXT_EXTENSIONS = new Set([".md", ".txt"]);
const CONTENT_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ".canvas"]);
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

function codecsEqual(a: CodecDescriptor, b: CodecDescriptor): boolean {
  if (a.scheme !== b.scheme) return false;
  if (a.scheme === "identity") return true;
  if (b.scheme !== "age") return false; // narrowing
  return a.layers.length === b.layers.length && a.layers.every((l, i) => l === b.layers[i]);
}

export interface SyncEngineConfig {
  /** Opaque vault id; emitted back in events so the client routes them correctly. */
  readonly vaultId: string;
  /** IndexedDB database name holding this vault's data (including its auth record). */
  readonly dbName: string;
  /** OPFS directory this vault's git working tree lives in. */
  readonly opfsDir: string;
}

export class SyncEngine {
  private fs!: GitFS;
  private readonly rateLimiter = new RateLimiter();
  // Tracks the single in-flight sync. Concurrent callers coalesce onto it
  // (see `sync()`), so we never early-return a resolved promise while a real
  // sync is still running — which would leave UI busy-states hanging.
  private syncPromise: Promise<void> | null = null;
  private tokens: AuthPayload | null = null;

  constructor(private readonly config: SyncEngineConfig) {}

  async init(): Promise<void> {
    this.fs = await createGitFS(this.config.opfsDir);
  }

  /** Emit a worker event with vaultId tagged onto the data, so the main
   *  thread can route it regardless of which engine produced it. */
  private emit(event: { event: WorkerEvent["event"]; data: Record<string, unknown> }): void {
    emit({ event: event.event, data: { ...event.data, vaultId: this.config.vaultId } });
  }

  // ── Token management ───────────────────────────────────────────────────────

  private async getValidTokens(): Promise<AuthPayload> {
    if (!this.tokens) {
      this.tokens = await loadTokens(this.config.dbName);
    }
    if (!this.tokens) {
      emit({ event: "authRequired", data: { vaultId: this.config.vaultId } });
      throw new Error("Not authenticated");
    }
    return this.tokens;
  }

  private makeHttp() {
    return createGitHttpPlugin(
      this.rateLimiter,
      (resumeAt) => this.emit({ event: "rateLimited", data: { resumeAt } })
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

    this.emit({ event: "syncStarted", data: { op: "clone" } });

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
      this.emit({ event: "syncCompleted", data: { op: "clone", headOid: "" } });
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
      this.emit({ event: "syncCompleted", data: { op: "clone", headOid: "" } });
      return;
    }
    try {
      await this.populateIndexedDB(headOid);
      this.emit({ event: "syncCompleted", data: { op: "clone", headOid } });
    } catch (popErr) {
      console.error("[sync] populateIndexedDB failed:", popErr);
      this.emit({ event: "syncCompleted", data: { op: "clone", headOid } });
    }
  }

  // ── Force pull / force push (escape hatches) ─────────────────────────────

  /**
   * Discard everything local and rebuild from remote:
   *   1. wipe IDB content stores (notes/canvas/attachments/tombstones)
   *   2. delete the OPFS git dir so clone() starts fresh
   *   3. clone from remote + populateIndexedDB
   * Auth tokens and config are preserved.
   */
  async forcePull(): Promise<void> {
    this.emit({ event: "syncStarted", data: { op: "forcePull" } });
    const db = await getDB(this.config.dbName);
    await Promise.all([
      db.clear("notes"),
      db.clear("canvas"),
      db.clear("attachments"),
      db.clear("tombstones"),
    ]);
    // Remove the OPFS git dir so isInitialized() returns false and clone() runs.
    try {
      const storageRoot = await navigator.storage.getDirectory();
      await storageRoot.removeEntry(this.config.opfsDir, { recursive: true });
    } catch { /* not present — that's fine */ }
    // Re-init the adapter so it points at a fresh directory.
    this.fs = await createGitFS(this.config.opfsDir);
    await this.clone();
  }

  /**
   * Overwrite the remote branch with local state, regardless of divergence.
   * Dangerous — any commits on remote not present locally are lost. Called
   * only after an explicit user confirmation at the UI layer.
   */
  async forcePush(): Promise<void> {
    this.emit({ event: "syncStarted", data: { op: "forcePush" } });
    const tokens = await this.getValidTokens();
    const http = this.makeHttp();
    const authHeaders = this.makeAuthHeaders(tokens);
    const branch = tokens.repoDefaultBranch;

    // Stage anything dirty + committed tombstones so local reflects IDB.
    const staged = await this.stageDirtyFiles();
    if (staged.length > 0) {
      const author = await this.getAuthor(tokens);
      await git.commit({
        fs: this.fs,
        dir: GIT_DIR,
        message: this.buildCommitMessage(staged),
        author,
      });
    }

    await git.push({
      fs: this.fs,
      http,
      corsProxy: GIT_CORS_PROXY,
      dir: GIT_DIR,
      remote: "origin",
      remoteRef: branch,
      force: true,
      headers: authHeaders,
    });
    await this.markStagedClean(staged);

    const headOid = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch }).catch(() => "");
    this.emit({ event: "syncCompleted", data: { op: "forcePush", headOid } });
  }

  // ── Steady-state sync ──────────────────────────────────────────────────────

  async sync(): Promise<void> {
    // Coalesce concurrent callers onto the same in-flight promise. Early
    // returning here would leave downstream UI waiting for a `syncCompleted`
    // event that never arrives (the in-flight sync emits only once, and this
    // call's promise would already have resolved).
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.#runSync().finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  async #runSync(): Promise<void> {
    try {
      if (!(await this.isInitialized())) {
        await this.clone();
        return;
      }
      await this.syncOnce();
    } catch (err) {
      // A throw anywhere inside the sync pipeline would otherwise leave any
      // UI that saw `syncStarted` hanging forever. Emit a terminal event
      // before re-throwing so listeners can transition out of their busy
      // state. The caller's promise still rejects as before.
      const branch = this.tokens?.repoDefaultBranch ?? "main";
      const headOid = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch }).catch(() => "");
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ event: "syncCompleted", data: { op: "sync", error: "failed", message, headOid } });
      throw err;
    }
  }

  private async syncOnce(retryCount = 0): Promise<void> {
    if (retryCount > 3) throw new Error("Sync retry limit exceeded");

    const tokens = await this.getValidTokens();
    const http = this.makeHttp();
    const authHeaders = this.makeAuthHeaders(tokens);
    const branch = tokens.repoDefaultBranch;

    this.emit({ event: "syncStarted", data: { op: "sync" } });

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
      this.emit({ event: "syncCompleted", data: { op: "sync", changed: 0, headOid } });
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
          this.emit({ event: "conflictDetected", data: { path } });
        }
        // Do not push if there are unresolved conflicts. Still emit a
        // terminal event so busy-indicators in the UI can transition out.
        const headOid = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch }).catch(() => "");
        this.emit({ event: "syncCompleted", data: { op: "sync", conflicts: conflicts.length, headOid } });
        return;
      }
    }

    // 5. Pre-push safety net. Refuse to push if the commit/merge result is
    // missing remote files that the user hasn't explicitly tombstoned. This
    // catches a class of failures where a merge silently drops files
    // (isomorphic-git quirks, shallow history, divergent histories, etc.)
    // and prevents the bad state from reaching GitHub.
    if (!remoteIsEmpty && (newCommit || (await this.hasLocalAhead(branch)))) {
      const dropped = await this.#detectUnexpectedDrops(branch);
      if (dropped.length > 0) {
        const msg = `Refusing to push: merge result is missing ${dropped.length} file(s) that exist on remote and were not explicitly deleted: ${dropped.slice(0, 3).join(", ")}${dropped.length > 3 ? "…" : ""}`;
        console.error("[sync]", msg, dropped);
        this.emit({ event: "syncCompleted", data: { op: "sync", error: "unsafe_push", dropped } });
        throw new Error(msg);
      }
    }

    // 6. Push if we have new commits or are ahead of remote.
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
    this.emit({ event: "syncCompleted", data: { op: "sync", headOid } });
  }

  // ── Conflict resolution callback ───────────────────────────────────────────

  async resolveConflict(path: string): Promise<void> {
    // User has saved a resolved version — clear conflict flag and re-sync.
    const db = await getDB(this.config.dbName);
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
    const db = await getDB(this.config.dbName);
    for (const p of paths) {
      // Any tombstone for this path was just honored by the push — clear it.
      await db.delete("tombstones", p);
      const sha = await this.getBlobSha(p).catch(() => "");
      const note = await db.get("notes", p);
      if (note) await db.put("notes", { ...note, syncState: "clean" as SyncState, baseSha: sha });
      const canvas = await db.get("canvas", p);
      if (canvas) await db.put("canvas", { ...canvas, syncState: "clean" as SyncState, baseSha: sha });
    }
  }

  private async stageDirtyFiles(): Promise<string[]> {
    const db = await getDB(this.config.dbName);
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

    // Stage deletions via explicit tombstones ONLY. Absence from IDB is not
    // a reliable signal — a stale IndexedDB from an old client or a partial
    // reconcile would otherwise silently remove remote data. Tombstones are
    // written by vaultService.delete* and cleared in markStagedClean after
    // a successful push.
    const tombstones = await db.getAll("tombstones");
    if (tombstones.length > 0) {
      // Collect HEAD paths so we can drop tombstones for files that never made
      // it to git (created + deleted locally in the same session).
      const branch = this.tokens?.repoDefaultBranch ?? "main";
      const headOid = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch }).catch(() => "");
      const headPaths = new Set<string>();
      if (headOid) {
        const { commit } = await git.readCommit({ fs: this.fs, dir: GIT_DIR, oid: headOid });
        const fs = this.fs;
        async function* walkTree(treeOid: string, prefix: string): AsyncGenerator<string> {
          const { tree } = await git.readTree({ fs, dir: GIT_DIR, oid: treeOid });
          for (const entry of tree) {
            const entryPath = prefix ? `${prefix}/${entry.path}` : entry.path;
            if (entry.type === "blob") yield entryPath;
            else if (entry.type === "tree") yield* walkTree(entry.oid, entryPath);
          }
        }
        for await (const p of walkTree(commit.tree, "")) headPaths.add(p);
      }

      for (const tomb of tombstones) {
        if (!headPaths.has(tomb.path)) {
          // Never committed — tombstone is obsolete, just drop it.
          try { await this.fs.promises.unlink(`/${tomb.path}`); } catch { /* ok */ }
          await db.delete("tombstones", tomb.path);
          continue;
        }
        try { await this.fs.promises.unlink(`/${tomb.path}`); } catch { /* already gone */ }
        try {
          await git.remove({ fs: this.fs, dir: GIT_DIR, filepath: tomb.path });
          staged.push(tomb.path);
        } catch (err) {
          console.warn("[sync] git.remove failed for tombstone:", tomb.path, err);
        }
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
    // keys.json is managed out-of-band (never through the codec or IDB).
    // A conflict here means two devices rotated the passphrase simultaneously;
    // leave the file in OPFS with merge markers for manual resolution.
    if (filepath === ".lemonstone/keys.json") {
      conflictPaths.push(filepath);
      return;
    }
    const db = await getDB(this.config.dbName);
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
      const db2 = await getDB(this.config.dbName);
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
    } else if (filepath.endsWith(".canvas")) {
      // Canvas files can't use conflict markers (would break JSON parsing),
      // so instead we stash both sides and surface a resolution UI.
      const canvas = await db.get("canvas", filepath);
      if (!canvas) return;
      const branch = this.tokens?.repoDefaultBranch ?? "main";
      const ours = await this.readBlobAt(`refs/heads/${branch}`, filepath);
      const theirs = await this.readBlobAt(`refs/remotes/origin/${branch}`, filepath);
      if (!ours || !theirs) {
        console.warn("[sync] canvas conflict: could not read ours/theirs blobs", filepath);
        return;
      }
      await db.put("canvas", {
        ...canvas,
        content: ours,
        syncState: "conflict" as SyncState,
        conflict: { theirs },
      });
      conflictPaths.push(filepath);
    } else {
      // v1 identity codec: 3-way merge with conflict markers.
      const conflictContent = await this.readOpfsFile(filepath);
      if (note) {
        const db2 = await getDB(this.config.dbName);
        await db2.put("notes", {
          ...note,
          content: conflictContent,
          syncState: "conflict" as SyncState,
        });
        conflictPaths.push(filepath);
      }
    }
  }

  /** Return the OID of the current HEAD commit, or "" if the repo isn't
   *  initialized / the ref can't be resolved. Used by the UI to label the
   *  repo with its current sha independently of sync events. */
  async getHead(): Promise<string> {
    const tokens = this.tokens ?? await loadTokens(this.config.dbName).catch(() => null);
    const branch = tokens?.repoDefaultBranch ?? "main";
    try {
      return await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch });
    } catch {
      return "";
    }
  }

  /** Read a file directly from the OPFS working tree. Returns null if missing.
   *  Used for repo-level config files (e.g. .lemonstone/keys.json) that aren't
   *  tracked through IndexedDB but ARE committed to git. */
  async readRepoFile(path: string): Promise<Uint8Array | null> {
    try {
      const data = await this.fs.promises.readFile(`/${path}`);
      return typeof data === "string" ? new TextEncoder().encode(data) : data;
    } catch {
      return null;
    }
  }

  /** Write a file directly to the OPFS working tree and stage it in git.
   *  A subsequent sync() call will commit + push it. */
  async writeRepoFile(path: string, bytes: Uint8Array): Promise<void> {
    await this.fs.promises.writeFile(`/${path}`, bytes);
    await git.add({ fs: this.fs, dir: GIT_DIR, filepath: path });
  }

  /** Read a file's blob bytes from a specific ref (branch / remote branch). */
  private async readBlobAt(ref: string, filepath: string): Promise<Uint8Array | null> {
    try {
      const oid = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref });
      const commit = await git.readCommit({ fs: this.fs, dir: GIT_DIR, oid });
      // readBlob can take a commit oid + filepath and walk the tree.
      const { blob } = await git.readBlob({
        fs: this.fs,
        dir: GIT_DIR,
        oid: commit.commit.tree,
        filepath,
      });
      return blob;
    } catch (err) {
      console.warn("[sync] readBlobAt failed", ref, filepath, err);
      return null;
    }
  }

  private async reconcileFromOPFS(): Promise<void> {
    // After a successful merge/fast-forward, bring IndexedDB in line with HEAD.
    // Walks the current tree and compares each blob's OID to the note's baseSha.
    // Status-matrix-based detection doesn't work here because a fast-forward
    // merge leaves workdir === HEAD for every file (nothing looks "modified").
    const db = await getDB(this.config.dbName);
    const branch = this.tokens?.repoDefaultBranch ?? "main";
    const headOid = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch }).catch(() => "");
    if (!headOid) return;
    const { commit } = await git.readCommit({ fs: this.fs, dir: GIT_DIR, oid: headOid });
    // Always re-derive the codec from keys.json — it's authoritative. An
    // existing record's codec could be stale (e.g. set to identity from a
    // pre-encryption reconcile, but keys.json was just added this merge).
    const zones = await this.loadZones();

    const fs = this.fs;
    async function* walkTree(treeOid: string, prefix: string): AsyncGenerator<{ path: string; oid: string }> {
      const { tree } = await git.readTree({ fs, dir: GIT_DIR, oid: treeOid });
      for (const entry of tree) {
        const entryPath = prefix ? `${prefix}/${entry.path}` : entry.path;
        if (entry.type === "blob") yield { path: entryPath, oid: entry.oid };
        else if (entry.type === "tree") yield* walkTree(entry.oid, entryPath);
      }
    }

    const seenPaths = new Set<string>();
    for await (const { path, oid } of walkTree(commit.tree, "")) {
      if (!isContentFile(path)) continue;
      seenPaths.add(path);
      const ext = path.slice(path.lastIndexOf(".")).toLowerCase();

      const expectedCodec = this.codecForPath(path, zones);

      if (TEXT_EXTENSIONS.has(ext)) {
        const existing = await db.get("notes", path);
        // Preserve local dirty edits — they'll sync on the next tick.
        if (existing?.syncState === "dirty") continue;
        // Shortcut: bytes AND codec match — nothing to do. The codec check
        // catches the case where a new keys.json was just pulled but the
        // file's bytes didn't change; without it the record would keep its
        // stale descriptor and reads would misinterpret the bytes.
        if (existing && existing.baseSha === oid && codecsEqual(existing.codec, expectedCodec)) continue;

        const bytes = await this.readBlobBytes(oid);
        if (!bytes) continue;
        const record: NoteRecord = {
          path,
          content: bytes,
          size: bytes.length,
          updatedAt: Date.now(),
          frontmatter: existing?.frontmatter ?? {},
          syncState: "clean",
          baseSha: oid,
          codec: expectedCodec,
        };
        await db.put("notes", record);
      } else if (ext === ".canvas") {
        const existing = await db.get("canvas", path);
        if (existing?.syncState === "dirty") continue;
        if (existing && existing.baseSha === oid && codecsEqual(existing.codec, expectedCodec)) continue;

        const bytes = await this.readBlobBytes(oid);
        if (!bytes) continue;
        const record: CanvasRecord = {
          path,
          content: bytes,
          updatedAt: Date.now(),
          syncState: "clean",
          baseSha: oid,
          codec: expectedCodec,
        };
        await db.put("canvas", record);
      }
    }

    // Remove clean notes that no longer exist in HEAD (removed on the remote).
    // Dirty notes are preserved — they may be new local files not yet pushed.
    const existingNotes = await db.getAll("notes");
    for (const note of existingNotes) {
      if (note.syncState !== "dirty" && !seenPaths.has(note.path)) {
        await db.delete("notes", note.path);
      }
    }
    const existingCanvases = await db.getAll("canvas");
    for (const c of existingCanvases) {
      if (c.syncState !== "dirty" && !seenPaths.has(c.path)) {
        await db.delete("canvas", c.path);
      }
    }
  }

  private async populateIndexedDB(headOid: string): Promise<void> {
    // Walk the git tree at HEAD and populate IndexedDB from OPFS.
    const db = await getDB(this.config.dbName);
    const { commit } = await git.readCommit({ fs: this.fs, dir: GIT_DIR, oid: headOid });
    // Zone policy drives each record's codec descriptor: without this step a
    // fresh clone on a second device would stamp every encrypted file as
    // `identity`, and subsequent reads would hand raw ciphertext to the UI.
    const zones = await this.loadZones();

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
      const bytes = await this.readBlobBytes(oid);
      if (!bytes) continue;
      const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
      const codec = this.codecForPath(path, zones);

      if (TEXT_EXTENSIONS.has(ext)) {
        const record: NoteRecord = {
          path,
          content: bytes,
          size: bytes.length,
          updatedAt: Date.now(),
          frontmatter: {},
          syncState: "clean",
          baseSha: oid,
          codec,
        };
        await db.put("notes", record);
      } else if (ext === ".canvas") {
        const record: CanvasRecord = {
          path,
          content: bytes,
          updatedAt: Date.now(),
          syncState: "clean",
          baseSha: oid,
          codec,
        };
        await db.put("canvas", record);
      }
    }
  }

  private async readOpfsFile(filepath: string): Promise<Uint8Array> {
    const data = await this.fs.promises.readFile(`/${filepath}`);
    return typeof data === "string" ? new TextEncoder().encode(data) : data;
  }

  /** Read and parse the vault's keys.json (zone policy) from OPFS.
   *  Returns an empty array if the file is absent or unparseable. We never
   *  throw here — a missing or corrupt keys.json should degrade to "this is a
   *  plaintext vault" rather than aborting the entire sync. */
  private async loadZones(): Promise<Zone[]> {
    try {
      const bytes = await this.fs.promises.readFile(`/${KEYS_JSON_PATH}`);
      const text = typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
      const parsed = JSON.parse(text);
      return isKeysFile(parsed) ? parsed.zones : [];
    } catch {
      return [];
    }
  }

  /** Build the codec descriptor that matches a file's on-disk layering.
   *  If any zone prefix covers the path, the file is age-encrypted under
   *  those zones (innermost first in `layers`). Otherwise it's plaintext. */
  private codecForPath(path: string, zones: readonly Zone[]): CodecDescriptor {
    const layers = layersForPath(path, zones);
    if (layers.length === 0) {
      return { scheme: identityCodec.scheme, version: identityCodec.version };
    }
    return { scheme: "age", version: 1, layers };
  }

  /**
   * Read a blob's bytes directly from git's object store by OID. More reliable
   * than reading the working tree: survives partial merges, half-checked-out
   * states, or any scenario where OPFS is out of sync with git's index.
   * Returns null if the blob can't be read (shouldn't happen after a fetch,
   * but log and skip rather than aborting the whole sync).
   */
  private async readBlobBytes(oid: string): Promise<Uint8Array | null> {
    try {
      const { blob } = await git.readBlob({ fs: this.fs, dir: GIT_DIR, oid });
      return blob;
    } catch (err) {
      console.warn("[sync] could not read blob", oid, err);
      return null;
    }
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
    const db = await getDB(this.config.dbName);
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

  /**
   * Enumerate every blob path reachable from a commit's tree.
   * Used by the pre-push safety check to diff local vs remote trees.
   */
  private async treePaths(commitOid: string): Promise<Set<string>> {
    const out = new Set<string>();
    if (!commitOid) return out;
    let commit;
    try {
      commit = await git.readCommit({ fs: this.fs, dir: GIT_DIR, oid: commitOid });
    } catch {
      return out;
    }
    const fs = this.fs;
    async function* walk(treeOid: string, prefix: string): AsyncGenerator<string> {
      const { tree } = await git.readTree({ fs, dir: GIT_DIR, oid: treeOid });
      for (const entry of tree) {
        const p = prefix ? `${prefix}/${entry.path}` : entry.path;
        if (entry.type === "blob") yield p;
        else if (entry.type === "tree") yield* walk(entry.oid, p);
      }
    }
    for await (const p of walk(commit.commit.tree, "")) out.add(p);
    return out;
  }

  /**
   * Return the set of file paths that exist on origin/<branch> but are
   * missing from local <branch>'s tree, minus any paths covered by
   * tombstones. A non-empty result means a push would silently remove
   * remote data — abort.
   */
  async #detectUnexpectedDrops(branch: string): Promise<string[]> {
    const localOid = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch }).catch(() => "");
    const remoteOid = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: `origin/${branch}` }).catch(() => "");
    if (!localOid || !remoteOid) return [];

    const [localPaths, remotePaths] = await Promise.all([
      this.treePaths(localOid),
      this.treePaths(remoteOid),
    ]);

    const db = await getDB(this.config.dbName);
    const tombstoned = new Set((await db.getAll("tombstones")).map((t) => t.path));

    const dropped: string[] = [];
    for (const p of remotePaths) {
      if (localPaths.has(p)) continue;
      if (tombstoned.has(p)) continue;
      dropped.push(p);
    }
    return dropped;
  }

  /**
   * Recent commit history for the current branch (for the "view history"
   * palette command). Returns up to `limit` commits in reverse-chrono order.
   */
  async recentCommits(limit = 30): Promise<{ oid: string; message: string; author: string; date: number }[]> {
    const branch = this.tokens?.repoDefaultBranch ?? "main";
    try {
      const entries = await git.log({ fs: this.fs, dir: GIT_DIR, ref: branch, depth: limit });
      return entries.map((e) => ({
        oid: e.oid,
        message: e.commit.message.split("\n")[0] ?? "",
        author: e.commit.author.name,
        date: e.commit.author.timestamp * 1000,
      }));
    } catch (err) {
      console.warn("[sync] recentCommits failed:", err);
      return [];
    }
  }

  /**
   * Metadata for a single commit plus the list of files changed relative to
   * its first parent. Used by the History view to show what a commit did.
   */
  async commitDetails(oid: string): Promise<{
    oid: string;
    message: string;
    author: string;
    date: number;
    changes: Array<{ path: string; status: "A" | "M" | "D" }>;
  } | null> {
    try {
      const { commit } = await git.readCommit({ fs: this.fs, dir: GIT_DIR, oid });
      const curPaths = await this.treePaths(oid);
      let parentPaths = new Set<string>();
      if (commit.parent && commit.parent[0]) {
        parentPaths = await this.treePaths(commit.parent[0]);
      }

      // For modification detection, compare blob OIDs at each path when both
      // sides have the path. Requires walking both trees a second time to
      // collect OIDs, not just paths.
      const curBlobs = await this.treeBlobs(oid);
      const parentBlobs = commit.parent?.[0] ? await this.treeBlobs(commit.parent[0]) : new Map<string, string>();

      const changes: Array<{ path: string; status: "A" | "M" | "D" }> = [];
      for (const p of curPaths) {
        if (!parentPaths.has(p)) changes.push({ path: p, status: "A" });
        else if (curBlobs.get(p) !== parentBlobs.get(p)) changes.push({ path: p, status: "M" });
      }
      for (const p of parentPaths) {
        if (!curPaths.has(p)) changes.push({ path: p, status: "D" });
      }
      changes.sort((a, b) => a.path.localeCompare(b.path));

      return {
        oid,
        message: commit.message,
        author: `${commit.author.name} <${commit.author.email}>`,
        date: commit.author.timestamp * 1000,
        changes,
      };
    } catch (err) {
      console.warn("[sync] commitDetails failed:", err);
      return null;
    }
  }

  private async treeBlobs(commitOid: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    let commit;
    try { commit = await git.readCommit({ fs: this.fs, dir: GIT_DIR, oid: commitOid }); }
    catch { return out; }
    const fs = this.fs;
    async function* walk(treeOid: string, prefix: string): AsyncGenerator<{ path: string; oid: string }> {
      const { tree } = await git.readTree({ fs, dir: GIT_DIR, oid: treeOid });
      for (const entry of tree) {
        const p = prefix ? `${prefix}/${entry.path}` : entry.path;
        if (entry.type === "blob") yield { path: p, oid: entry.oid };
        else if (entry.type === "tree") yield* walk(entry.oid, p);
      }
    }
    for await (const { path, oid } of walk(commit.commit.tree, "")) out.set(path, oid);
    return out;
  }

  /**
   * Create a new commit whose tree matches the target commit. Forward-only —
   * no history rewriting. Files added since the target commit are removed
   * (tombstoned so the safety check allows the push); modified files revert
   * to their target-commit content.
   */
  async restoreToCommit(targetOid: string): Promise<void> {
    this.emit({ event: "syncStarted", data: { op: "restore" } });
    const branch = this.tokens?.repoDefaultBranch ?? "main";
    const headOid = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch });

    const headBlobs = await this.treeBlobs(headOid);
    const targetBlobs = await this.treeBlobs(targetOid);

    const db = await getDB(this.config.dbName);

    // 1. Files present in HEAD but not in target: remove + tombstone.
    for (const [path] of headBlobs) {
      if (targetBlobs.has(path)) continue;
      try { await this.fs.promises.unlink(`/${path}`); } catch { /* ok */ }
      try { await git.remove({ fs: this.fs, dir: GIT_DIR, filepath: path }); } catch { /* ok */ }
      await db.put("tombstones", { path, deletedAt: Date.now() });
      await db.delete("notes", path).catch(() => {});
      await db.delete("canvas", path).catch(() => {});
    }

    // 2. Files in target: write target's blob content to OPFS + git.add.
    //    Skip if content matches what's already in the working tree.
    for (const [path, blobOid] of targetBlobs) {
      if (headBlobs.get(path) === blobOid) continue; // unchanged
      const bytes = await this.readBlobBytes(blobOid);
      if (!bytes) continue;
      await this.fs.promises.writeFile(`/${path}`, bytes);
      await git.add({ fs: this.fs, dir: GIT_DIR, filepath: path });
      // Also clear tombstones for this path in case a tombstone was stale.
      await db.delete("tombstones", path).catch(() => {});
    }

    // 3. Commit the restoration.
    const author = await this.getAuthor(await this.getValidTokens());
    const short = targetOid.slice(0, 7);
    await git.commit({
      fs: this.fs,
      dir: GIT_DIR,
      message: `Restore to ${short}`,
      author,
    });

    // 4. Rebuild IDB from the new HEAD so the UI reflects the restored state.
    const newHead = await git.resolveRef({ fs: this.fs, dir: GIT_DIR, ref: branch });
    await this.populateIndexedDB(newHead);

    // 5. Hand back to normal sync for the actual push.
    this.emit({ event: "syncCompleted", data: { op: "restore", headOid: newHead } });
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
      this.emit({ event: "syncCompleted", data: { error: "repo_not_found" } });
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
