// Regression test for the fast-forward-merge / stale-index sync bug.
//
// SyncEngine.mergeRemote() fast-forwards the local branch to origin's HEAD
// via git.merge(), but isomorphic-git's merge() only updates the ref and
// the object database — it never touches the working directory or the git
// index. Without an explicit checkout, a device that just "synced" (and
// whose IndexedDB looks correct, via reconcileFromOPFS reading blobs
// straight from the object store) still has a stale git index. The next
// local edit stages+commits from that stale index, silently building a
// tree that drops every file which arrived in the fast-forward — which is
// exactly what trips the "would silently delete N remote files" unsafe-push
// refusal the next time that device tries to sync.
import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import git from "isomorphic-git";
import { SyncEngine } from "../src/sync/sync-engine.ts";
import type { GitFS } from "../src/sync/opfs-adapter.ts";
import type { AuthPayload } from "../src/storage/schema.ts";

const GIT_DIR = "/";
const enc = new TextEncoder();
const dec = new TextDecoder();

const tokens: AuthPayload = {
  accessToken: "x",
  refreshToken: "x",
  accessTokenExpiresAt: 0,
  refreshTokenExpiresAt: 0,
  installationId: 1,
  repoFullName: "owner/repo",
  repoDefaultBranch: "main",
};

type EngineInternals = {
  fs: GitFS;
  mergeRemote(branch: string, tokens: AuthPayload): Promise<string[]>;
};

async function makeEngine(id: string): Promise<EngineInternals> {
  // dbName and opfsDir must be distinct: they back separate IndexedDB
  // databases (app data via `idb`, and LightningFS's git filesystem). Reusing
  // one name for both makes the two collide on the same underlying database.
  const engine = new SyncEngine({
    vaultId: id,
    dbName: `test-sync-db-${id}`,
    opfsDir: `test-sync-git-${id}`,
  });
  await engine.init();
  return engine as unknown as EngineInternals;
}

describe("SyncEngine.mergeRemote", () => {
  it("checks out the fast-forwarded tree so a subsequent local commit doesn't drop remote files", async () => {
    const engine = await makeEngine(`ff-${Date.now()}`);
    const fs = engine.fs;

    // 1. This device's known-good history: one commit with a.md.
    await git.init({ fs, dir: GIT_DIR, defaultBranch: "main" });
    await fs.promises.writeFile("/a.md", enc.encode("hello"));
    await git.add({ fs, dir: GIT_DIR, filepath: "a.md" });
    const c1 = await git.commit({
      fs, dir: GIT_DIR, message: "c1",
      author: { name: "A", email: "a@example.com" },
    });

    // 2. Baseline: both branches at c1 — a device that's fully synced.
    await git.writeRef({ fs, dir: GIT_DIR, ref: "refs/remotes/origin/main", value: c1, force: true });

    // 3. Simulate a different device pushing a commit that adds b.md, by
    //    writing the objects directly (as `git.fetch` would populate the
    //    object database) without touching this device's index/workdir.
    const { commit: c1Commit } = await git.readCommit({ fs, dir: GIT_DIR, oid: c1 });
    const { tree: c1Tree } = await git.readTree({ fs, dir: GIT_DIR, oid: c1Commit.tree });
    const bBlobOid = await git.writeBlob({ fs, dir: GIT_DIR, blob: enc.encode("world") });
    const c2TreeOid = await git.writeTree({
      fs, dir: GIT_DIR,
      tree: [...c1Tree, { mode: "100644", path: "b.md", oid: bBlobOid, type: "blob" }],
    });
    const now = Math.floor(Date.now() / 1000);
    const c2 = await git.writeCommit({
      fs, dir: GIT_DIR,
      commit: {
        tree: c2TreeOid,
        parent: [c1],
        author: { name: "B", email: "b@example.com", timestamp: now, timezoneOffset: 0 },
        committer: { name: "B", email: "b@example.com", timestamp: now, timezoneOffset: 0 },
        message: "c2: add b.md",
      },
    });
    await git.writeRef({ fs, dir: GIT_DIR, ref: "refs/remotes/origin/main", value: c2, force: true });

    // Sanity check: this device hasn't seen b.md yet.
    await expect(fs.promises.readFile("/b.md")).rejects.toThrow();

    // 4. Run the code under test: fast-forward merge of origin/main into main.
    await engine.mergeRemote("main", tokens);

    // Local branch fast-forwarded...
    expect(await git.resolveRef({ fs, dir: GIT_DIR, ref: "main" })).toBe(c2);
    // ...and critically, the working tree was actually checked out (not
    // just the ref moved).
    const bContent = await fs.promises.readFile("/b.md");
    expect(dec.decode(bContent as Uint8Array)).toBe("world");

    // 5. Reproduce the user-visible bug: the device edits a.md and syncs,
    //    exactly like stageDirtyFiles() + git.commit() would.
    await fs.promises.writeFile("/a.md", enc.encode("hello again"));
    await git.add({ fs, dir: GIT_DIR, filepath: "a.md" });
    await git.commit({
      fs, dir: GIT_DIR, message: "edit a.md",
      author: { name: "B", email: "b@example.com" },
    });

    // The new commit's tree must still contain b.md. Before the fix, the
    // stale index meant this commit silently omitted it, which is what
    // made the pre-push safety net refuse the sync as an unsafe push.
    const headOid = await git.resolveRef({ fs, dir: GIT_DIR, ref: "main" });
    const { commit: headCommit } = await git.readCommit({ fs, dir: GIT_DIR, oid: headOid });
    const { tree: headTree } = await git.readTree({ fs, dir: GIT_DIR, oid: headCommit.tree });
    expect(headTree.map((e) => e.path).sort()).toEqual(["a.md", "b.md"]);
  });
});
