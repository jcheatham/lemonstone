# Lemonstone — Engineering Design Document

**Version:** 1.1 — Engineering Draft
**Audience:** Implementing engineer or AI coding agent
**Format:** Obsidian-flavored Markdown (portable, editable in any Markdown tool)

### Changelog

- **v1.1** — Added operator-hosted distribution model with self-hosted alternative (§1.3, §4.6). Switched reference deployment to GitHub Pages with `<meta>`-tag CSP (§10.2, §9.2). Added the Content Codec interface as an encryption-readiness constraint (§2.2, §5.5). Added codec fields to every stored record (§5.2). Added §6.7 specifying last-writer-wins-with-preservation for encrypted-vault conflicts. Moved E2E encryption from "open question" to "scheduled for v2" (§12.1). Updated M0–M4 in §13 to reflect codec plumbing and self-host `client_id` override.
- **v1.0** — Initial draft.

---

## 0. How to Read This Document

This document is written to be picked up by another engineer or AI agent and turned into a working implementation plan. It is **prescriptive where it matters** (auth flow, storage schema, sync algorithm, module boundaries) and **permissive where it doesn't** (exact file names, cosmetic UI choices, specific CSS values).

When a section says **MUST**, that is a load-bearing design decision — changing it ripples through the rest of the system. When a section says **SHOULD**, it is a strong default with explicit alternatives. When a section says **MAY**, it is genuinely up to the implementer.

The recommended consumption order: read §1–3 for context, §4–6 for the three hardest subsystems (auth, storage, sync), §7 for feature scope, then jump to §13 for the ordered implementation plan. §8–12 are reference material.

---

## 1. Overview

Lemonstone is a browser-based, installable Progressive Web App for Markdown note-taking. It runs **fully independently on the client**: no application backend, no database server, no vendor-owned sync infrastructure. The user's notes are stored as plain Markdown files in a private GitHub repository that the user owns, with IndexedDB and the Origin Private File System acting as the local cache and offline working copy.

The product philosophy is inherited from Obsidian: **files over app**. The authoritative copy of every note is a Markdown file in a Git repository that the user controls. Every feature — editor, wikilinks, backlinks, search, tags, daily notes, Canvas — operates on top of those files. If Lemonstone disappears, the user still has a browsable, forkable, version-controlled notes repository on GitHub.

### 1.1 v1 Feature Scope (confirmed)

- Markdown editing with Obsidian-flavored syntax (wikilinks, embeds, callouts, tags, frontmatter)
- Bidirectional linking with a backlinks panel
- Tag extraction and a tag-browser pane
- Full-text search across the vault
- Daily notes with templates and calendar navigation
- Canvas editing conforming to the JSON Canvas specification
- GitHub authentication via Device Flow (GitHub App variant)
- Sync via isomorphic-git with 3-way merge conflict resolution
- Offline-first operation: every read and write succeeds without network
- **Content Codec interface** in place with an identity (no-op) codec; architecture ready for v2 end-to-end encryption (§5.5)

### 1.2 Non-Goals for v1

- No server infrastructure beyond static PWA hosting
- No multi-user real-time collaboration
- No graph view, no plugin system, no Bases (deferred to future versions)
- No native mobile applications (the PWA is the mobile experience)
- No non-GitHub backends (GitLab, Gitea, etc. are post-v1)
- No React, no Vue, no Svelte — see §2.3
- End-to-end encryption is **not shipped in v1** but is **designed for in v1**; see §5.5 and §6.7

### 1.3 Distribution Model

Lemonstone is distributed as an **operator-hosted PWA**: the Lemonstone team maintains a single static site (on GitHub Pages or equivalent, §10.2) and a single GitHub App registration (§4.1). Users visit the hosted URL and authenticate; they do not fork the repo, do not register their own App, and do not deploy anything. This is the supported default path and the one the rest of this document assumes.

A **self-hosted alternative** is supported for users who prefer full control: fork the repo, register their own GitHub App, override the `client_id` constant at build time, and deploy to any static host. See §4.6 for the documented checklist.

The "zero operator infrastructure" commitment (§2.1) is preserved in the operator-hosted model: the operator runs static hosting and maintains a GitHub App *registration* (a record on GitHub's servers, not infrastructure we run). No webhook endpoint, no backend, no database, no secrets, no user data ever reaches the operator.

---

## 2. Design Goals and Constraints

### 2.1 Goals

- **Local-first correctness.** Every read and write succeeds offline. Sync is a background process, never on the critical path of user interaction.
- **Data sovereignty.** The user's notes live in a repository the user owns, authored by a GitHub App the user installs and can revoke at any time.
- **Zero operator infrastructure.** No backend servers, no databases, no auth proxies. The only operator cost is static file hosting.
- **Predictable conflict handling.** When the same note is edited on two devices, conflicts are resolved via a Git 3-way merge; unresolvable conflicts surface inline in the editor, never silently discarded.
- **Portable output.** Notes are Markdown with Obsidian-flavored syntax; Canvas files follow the open JSON Canvas specification. A user who exports their repo to Obsidian sees their vault render correctly with no conversion.

### 2.2 Constraints

- **Browser-only runtime.** Must work in Chromium, Firefox, and Safari on desktop and mobile. Features requiring capabilities not available in Safari MUST have fallbacks.
- **GitHub rate limits.** Authenticated GitHub App requests have a 5,000-per-hour primary rate limit plus a less-documented secondary abuse limit. Sync logic MUST use Git pack operations (not per-file REST calls) and MUST be backoff-aware.
- **No shared secrets.** Because there is no backend, the GitHub App's client secret cannot be used by the PWA. The auth flow MUST be a public-client-safe flow (Device Flow).
- **IndexedDB quota.** Browser storage is not unlimited and can be evicted under pressure. Critical state MUST be recoverable from GitHub; IndexedDB is a cache, not a source of truth.
- **Encryption-ready architecture.** The architecture MUST accommodate end-to-end encryption of note content in a future version without schema or sync-algorithm rewrites. v1 implements a Content Codec abstraction (§5.5) with a no-op codec; v2 substitutes a real encryption codec. The §6 sync flow and §5 storage schema MUST route all note content through this codec from day one, even while it is a no-op.

### 2.3 The Vanilla JS Constraint

Lemonstone MUST NOT depend on React, Vue, Svelte, Angular, or any other framework. Rationale:

- **Dependency minimalism.** A notes app that the user trusts for decades should be buildable and debuggable decades from now. Vanilla ECMAScript and the DOM are the longest-lived foundations the platform offers.
- **Bundle size.** Every framework is 30–150 KB of overhead that contributes nothing to the core value proposition.
- **Agent legibility.** An agent reading the source later can reason about `document.querySelector` without needing to understand a framework's reconciliation model.
- **Alignment with philosophy.** "Files over app" extends naturally to "standards over frameworks."

Permitted non-framework dependencies (each justified in §10.1):

- **CodeMirror 6** — editor. The ecosystem has no comparable vanilla alternative for Markdown with live preview and syntax extensions.
- **isomorphic-git** — Git implementation. Rewriting Git in-house is out of scope.
- **MiniSearch** — full-text search. Small, pure JS, no alternatives of comparable quality.
- **Workbox** — service worker generation at build time only; no runtime dependency.
- **idb** — a thin (~2KB) IndexedDB promise wrapper. Optional but strongly recommended for readability. Vanilla IndexedDB is usable directly if preferred.

The UI layer MUST be built from:

- Native DOM APIs (`document.createElement`, `element.addEventListener`).
- **Custom Elements** (Web Components) for reusable UI primitives with encapsulated behavior.
- **Event-driven state** via `EventTarget` subclasses for stores; no reducers, no virtual DOM.
- HTML `<template>` elements for repeatable markup.
- Standard CSS with CSS custom properties for theming.

See §8 for the specific UI architecture.

---

## 3. High-Level Architecture

### 3.1 Component Diagram

```
┌──────────────────────── Browser (client) ────────────────────────┐
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  UI Layer                                                │    │
│  │  • Custom Elements (vanilla JS)                          │    │
│  │  • CodeMirror 6 editor instance                          │    │
│  │  • Canvas renderer (HTMLCanvasElement + 2D context)      │    │
│  └──────────────────┬───────────────────────────────────────┘    │
│                     │                                            │
│  ┌──────────────────┴───────────────────────────────────────┐    │
│  │  Vault Service                                           │    │
│  │  • readNote / writeNote / listNotes                      │    │
│  │  • resolveWikilink / getBacklinks                        │    │
│  │  • searchFullText / listTags                             │    │
│  │  • EventTarget: emits "note:changed", "vault:synced"…    │    │
│  └──────────┬─────────────────────────────────┬─────────────┘    │
│             │                                 │                  │
│  ┌──────────┴────────────┐    ┌───────────────┴─────────────┐    │
│  │  Storage Adapter      │    │  Sync Engine (Web Worker)   │    │
│  │  • IndexedDB (notes)  │    │  • isomorphic-git           │    │
│  │  • OPFS (Git objects) │    │  • Device Flow auth         │    │
│  │  • Indexes snapshot   │    │  • 3-way merge              │    │
│  └───────────────────────┘    └──────────────┬──────────────┘    │
│                                              │                   │
│  ┌───────────────────────────────────────┐   │                   │
│  │  Service Worker (shell cache, offline)│   │                   │
│  └───────────────────────────────────────┘   │                   │
└──────────────────────────────────────────────┼───────────────────┘
                                               │
                                               ▼ HTTPS
                                     ┌───────────────────┐
                                     │    GitHub.com     │
                                     │  (user's private  │
                                     │       repo)       │
                                     └───────────────────┘
```

### 3.2 Component Responsibilities

- **UI Layer.** Purely presentational. Composed of Custom Elements that subscribe to Vault Service events. The editor is a CodeMirror 6 instance mounted into a Custom Element shell. Canvas is rendered into an `<canvas>` element with a dedicated layout and hit-test module. The UI owns no persistence; all mutations go through the Vault Service API.

- **Vault Service.** The single in-browser API surface for "the notes." A plain ES module that exports an object with methods and an attached `EventTarget` for change notifications. Reads from and writes to the Storage Adapter, maintains link and search indexes in memory, emits change events.

- **Storage Adapter.** Abstracts browser persistence. Primary backing store is IndexedDB via a thin wrapper. Where available, the Origin Private File System (OPFS) is used for the Git object database and large attachments.

- **Sync Engine.** Runs in a dedicated Web Worker. Owns isomorphic-git, the Device Flow token lifecycle, and the complete sync loop. Communicates with the main thread via `postMessage` using a request-response protocol (§6.5).

- **Service Worker.** Standard PWA concern: caches the application shell and static assets, enables offline launch. Does not participate in sync or data storage.

---

## 4. Authentication: GitHub App Device Flow

### 4.1 Why GitHub App, Not OAuth App

Lemonstone MUST use a GitHub App rather than a classic OAuth App:

- **Per-repository permissions.** A GitHub App can request access to a single repository selected by the user at install time. A classic OAuth App with the `repo` scope has access to all the user's private repositories — wrong posture for a notes app.
- **Granular token permissions.** User-to-server tokens carry only the permissions the App was granted (`contents: read/write`, `metadata: read`). No gist, user profile, or org access.
- **Clean revocation UX.** Users can revoke the App from `github.com/settings/installations` with a single click.

### 4.2 Device Flow Sequence

Runs entirely in the browser. Only the App's `client_id` ships in the PWA bundle; no client secret is ever present.

```
1. User clicks "Connect GitHub" in the PWA.

2. PWA → POST https://github.com/login/device/code
     body: { client_id }   // scopes defined by the App itself
   Response: { device_code, user_code, verification_uri,
               interval, expires_in }

3. PWA displays user_code (e.g. "WDJB-MJHT") and verification_uri.
   PWA opens verification_uri in a new tab.

4. User signs in to GitHub, enters the user_code, approves the App,
   selects which repository to grant access to.

5. PWA polls every `interval` seconds:
     POST https://github.com/login/oauth/access_token
       body: { client_id, device_code,
               grant_type: "urn:ietf:params:oauth:grant-type:device_code" }

6. Poll returns one of:
   - authorization_pending  → keep polling
   - slow_down              → increase interval by 5s, keep polling
   - expired_token          → restart from step 2
   - access_denied          → user declined, abort
   - { access_token, refresh_token, expires_in,
       refresh_token_expires_in }

7. PWA stores tokens in IndexedDB (§4.4).
```

### 4.3 Token Refresh

Default GitHub App tokens expire after 8 hours and carry a refresh token good for 6 months. The Sync Engine checks token expiry before every GitHub API call; if less than 5 minutes remain, it performs a silent refresh:

```
POST https://github.com/login/oauth/access_token
  body: { client_id, grant_type: "refresh_token", refresh_token }
Response: new { access_token, refresh_token, expires_in,
                refresh_token_expires_in }
```

Both tokens rotate on refresh. The old refresh token is invalidated server-side; the client MUST persist the new pair atomically within a single IndexedDB transaction. A failed refresh (refresh token expired, user revoked the App) triggers a re-authentication prompt.

In practice: a user who opens Lemonstone at least once every six months never has to repeat the Device Flow ceremony.

### 4.4 Token Storage

Tokens are stored in an IndexedDB object store named `auth`. localStorage and sessionStorage MUST NOT be used.

Tokens MUST be wrapped with AES-GCM via the Web Crypto API, using a non-exportable key generated on first launch. The key itself is stored in IndexedDB as a `CryptoKey` with `extractable: false` — the browser retains the key material but never exposes it to script.

**This does not defend against XSS on the Lemonstone origin** — script with document access can always call the Vault Service API. The encryption raises the bar against casual inspection from browser extensions and prevents plain-text tokens from appearing in storage inspectors.

A strict Content Security Policy (§9.2) is the real XSS defense.

### 4.5 Rate Limiting

The Sync Engine MUST respect both GitHub rate limits:

- **Primary limit:** parse `X-RateLimit-Remaining` and `X-RateLimit-Reset` on every response. If Remaining drops below 100, throttle sync operations to one per 5 seconds until Reset passes.
- **Secondary limit:** on 403 with a `retry-after` header, pause the Sync Engine for the indicated duration and surface a non-blocking notification: *"Sync paused, GitHub asked us to slow down. Will resume in 2m."*
- **Batch operations:** use Git pack-based fetch/push rather than per-file REST calls. A vault with 500 notes is one `git fetch`, not 500 `GET /contents/` requests.

### 4.6 Self-Hosted Alternative

Users who prefer to run their own GitHub App registration — for example, to avoid any dependence on the Lemonstone team's continued operation of the shared App — can do so. The implementation MUST support this without code changes beyond a configuration override.

**Requirements on the implementation:**

- The `client_id` MUST be sourced from a single build-time constant (e.g., `src/config/github-app.ts`) that can be overridden by an environment variable or a local config file.
- The repository README MUST include a self-hosting checklist covering: fork, register GitHub App with the required permissions (§10.3), override `client_id`, build, deploy to any static host.
- No runtime configuration UI is required. Self-hosters edit a file and rebuild.

**Requirements on the user (documented, not enforced):**

1. Fork the Lemonstone repository.
2. Register a new GitHub App in their GitHub developer settings using the configuration in §10.3.
3. Copy the generated `client_id` into their fork's config file.
4. Build (`npm run build`).
5. Deploy the `dist/` output to GitHub Pages, Cloudflare Pages, Netlify, or any static host.
6. Visit their deployment, complete Device Flow against their own App, install it on their account, grant access to their notes repo.

This path is documented but not the default. The operator-hosted path (§1.3) is the expected first-run experience for the large majority of users.

---

## 5. Client-Side Storage Model

### 5.1 The Layered Cache

Lemonstone maintains three layers of client-side state:

| Layer | Contents | Backing store |
|---|---|---|
| Working copy | User's editable notes as Markdown blobs, keyed by path | IndexedDB `notes` store |
| Git object database | Git commits, trees, blobs, refs (the isomorphic-git repo) | OPFS if available; IndexedDB fallback |
| Derived indexes | Link graph, backlinks, tag index, MiniSearch index | In-memory; snapshotted to IndexedDB on idle |

This separation is load-bearing:

- The **working copy** is what the editor reads and writes, updated synchronously on every save.
- The **Git object database** is manipulated only by the Sync Engine, append-mostly.
- The **derived indexes** are disposable and can be rebuilt from the working copy at any time; persisting them is purely a startup-latency optimization.

### 5.2 IndexedDB Schema

Database: `lemonstone-vault` (versioned, migrated with `onupgradeneeded`)

```
auth
  key: "github"
  value: { accessToken, refreshToken,
           accessTokenExpiresAt, refreshTokenExpiresAt,
           installationId, repoFullName, repoDefaultBranch }
  // value is AES-GCM encrypted; only the wrapper is plaintext
  // (auth tokens are NOT content-codec encoded; they use a
  //  separate token-encryption path — see §4.4.)

notes
  keyPath: "path"              e.g. "daily/2026-04-20.md"
  indexes: [updatedAt, sha]    // sha is Git blob sha for dirty-check
  value: { path, content, size, updatedAt, frontmatter,
           syncState: "clean" | "dirty" | "conflict",
           baseSha,              // sha of last synced version
           codec: { scheme, version } }  // §5.5; "identity" in v1

canvas
  keyPath: "path"              e.g. "projects/q2-plan.canvas"
  value: { path, content (JSON string), updatedAt, syncState,
           baseSha,
           codec: { scheme, version } }

attachments
  keyPath: "path"              e.g. "attachments/diagram.png"
  value: { path, blob, size, updatedAt, syncState, baseSha,
           codec: { scheme, version } }

indexes-snapshot
  key: "v1"
  value: { linkGraph, backlinks, tagIndex, searchIndexSerialized,
           snapshotAt, vaultHeadCommitSha,
           codec: { scheme, version } }  // snapshot is codec-encoded

config
  key: string
  value: arbitrary JSON (user preferences, theme, etc.)
```

The `frontmatter` field on `notes` is a convenience — a parsed copy of the note's YAML frontmatter, used by indexing without requiring a re-parse on every read. In v2 (encrypted), `frontmatter` MUST NOT be stored in plaintext alongside ciphertext `content`; it is either re-derived on demand from decrypted content or codec-encoded itself. The implementer should treat `frontmatter` as "derived from content" for storage purposes.

### 5.3 OPFS for the Git Object Database

isomorphic-git ships with a `LightningFS` backend that stores Git objects in IndexedDB. For large vaults (thousands of notes, many revisions), IndexedDB's per-key overhead makes this slow — cloning a 200 MB repo can take minutes.

Where OPFS is available (Chromium, Firefox 111+, Safari 17+), Lemonstone SHOULD use a custom OPFS-backed isomorphic-git filesystem adapter, typically 5–10x faster for Git pack operations and with no IndexedDB quota pressure. On browsers without OPFS support, fall back to LightningFS.

Detection: `typeof navigator.storage?.getDirectory === "function"`.

### 5.4 Quota and Eviction

Browsers may evict IndexedDB data under storage pressure. Lemonstone MUST request persistent storage at first launch via `navigator.storage.persist()`. Most browsers grant this to PWAs with a service worker and user engagement signals. The UI SHOULD expose current usage via `navigator.storage.estimate()` in a settings panel.

Eviction is survivable but not free. Because the authoritative copy is on GitHub, a fully evicted client can re-clone the repo and rebuild all derived indexes. The user loses any unsynced local changes; this is the same failure mode as manually clearing browser storage. A *"Force sync before closing"* setting (default on) triggers a best-effort push on `visibilitychange === "hidden"`.

### 5.5 The Content Codec (Encryption-Ready Architecture)

Lemonstone MUST route all note content through a **Content Codec** interface on both the read and write paths, from v1 onward. In v1 the codec is a no-op (`IdentityCodec`); in v2 it becomes an encryption codec. Introducing the interface in v1 is what keeps v2 from becoming a rewrite.

#### Interface

```ts
interface ContentCodec {
  /** Identifier for the active codec; stored alongside ciphertext. */
  readonly scheme: string;        // e.g. "identity" | "age-x25519-v1"
  readonly version: number;

  /** Transform plaintext bytes to at-rest bytes. Path passed for key scoping. */
  encode(plaintext: Uint8Array, path: string): Promise<Uint8Array>;

  /** Transform at-rest bytes back to plaintext. */
  decode(atRest: Uint8Array, path: string): Promise<Uint8Array>;

  /**
   * Inspect bytes (without decrypting) and return whether they appear
   * to be produced by this codec. Used during reads to detect
   * codec mismatches (e.g., opening an encrypted vault with the
   * identity codec).
   */
  recognizes(atRest: Uint8Array): boolean;
}
```

#### v1 implementation: `IdentityCodec`

```ts
class IdentityCodec implements ContentCodec {
  readonly scheme = "identity";
  readonly version = 1;
  async encode(plaintext: Uint8Array): Promise<Uint8Array> { return plaintext; }
  async decode(atRest: Uint8Array): Promise<Uint8Array> { return atRest; }
  recognizes(bytes: Uint8Array): boolean {
    // Identity codec "recognizes" anything that is not recognized
    // by a known encryption scheme (best-effort).
    return !looksEncrypted(bytes);
  }
}
```

#### Where the codec is invoked

The codec sits at two boundaries:

1. **Vault Service ↔ Storage Adapter.** `writeNote(path, plaintext)` calls `codec.encode` before persisting to the IndexedDB `notes` store; `readNote(path)` calls `codec.decode` after reading. Derived indexes are always built from plaintext in memory.
2. **Sync Engine staging ↔ Git index.** When the Sync Engine reads a working-copy file to commit to Git, it does so via the codec-aware working copy (the files it commits are already in at-rest form — ciphertext in v2, plaintext in v1). When it merges or checks out from Git, it reads at-rest bytes and decodes into the working copy.

This means that **in v2, what Git stores is ciphertext**. The at-rest bytes pushed to GitHub are opaque; only the user's keys can decrypt. Neither GitHub nor the Lemonstone operator can read note content.

#### Indexes and the codec

The `indexes-snapshot` store (§5.2) holds derived data computed from plaintext: the link graph, backlinks, tag index, and serialized MiniSearch index. Persisting this snapshot in plaintext in v2 would defeat encryption-at-rest.

Therefore: **the indexes-snapshot store MUST be codec-encoded on write and decoded on read**, using the same codec as note content. In v1 this is a no-op. In v2, evicted or stolen IndexedDB data yields nothing the attacker couldn't already see in the repo.

#### Schema field for codec identification

Every content-bearing value in IndexedDB MUST include a `codec` field recording the scheme and version used to encode it:

```
notes value: {
  path, content, size, updatedAt, frontmatter,
  syncState, baseSha,
  codec: { scheme: "identity", version: 1 }    // added in v1
}
```

This allows a future migration (e.g., user enables encryption on an existing plaintext vault) to know which records still need to be re-encoded. Records with `codec.scheme === "identity"` in an encrypted vault are migration candidates.

#### What v1 MUST do to stay encryption-ready

- Define the `ContentCodec` interface in a shared module.
- Implement `IdentityCodec` and inject it as the default codec via a single composition point.
- Route every note, canvas, and attachment read/write through `codec.encode` / `codec.decode`.
- Route the indexes snapshot through the codec.
- Include the `codec` field in every stored record.
- Ensure the Sync Engine reads and writes at-rest bytes (not plaintext) when talking to the Git layer.

#### What v1 MUST NOT do

- Assume plaintext anywhere outside the in-memory working set and derived indexes.
- Embed format-specific logic (e.g., "the first line is the title") that reads raw file bytes without going through the codec.
- Store plaintext copies of note content in the IndexedDB snapshot.

Key management, the specific encryption scheme, and the user-facing passphrase/key UX are v2 concerns and are deliberately not specified here.

---

## 6. Sync Engine

### 6.1 Why isomorphic-git

Three approaches considered:

| Approach | Pros | Cons |
|---|---|---|
| GitHub Contents API (per-file PUT/GET) | Simple REST, no Git knowledge needed | No atomic multi-file commits; poor performance; no branches; no merge support |
| GitHub Git Data API (manual tree/commit construction) | Real commits, atomic writes | Complex client merge code; no fetch-pack optimization; per-object HTTP calls |
| **isomorphic-git over Git Smart HTTP** | Full Git semantics, pack-based transfer, mature 3-way merge, offline commits | ~200 KB gzipped; custom merge UX required |

isomorphic-git wins decisively. A single editor session that touches ten notes becomes a single atomic commit, pushed in a single pack. The library handles fetch negotiation, pack extraction, and — critically — 3-way merge against the common ancestor.

### 6.2 Sync Engine Lives in a Web Worker

The Sync Engine MUST run in a dedicated Web Worker. Rationale:

- Packfile parsing and Git hashing are CPU-intensive and would jank the editor on the main thread.
- A Worker provides natural isolation: only the Sync Engine holds GitHub tokens and has network access to github.com.

The main thread communicates with the worker via `postMessage` using a request-response protocol with correlation IDs (§6.5).

### 6.3 Sync Lifecycle

#### Initial Setup

After successful Device Flow authentication, the user is prompted to select or create a repository. On selection:

1. Clone the repo into the OPFS-backed Git filesystem using `isomorphic-git.clone()` with an HTTP auth header injected by a custom `http` plugin: `Authorization: token <access_token>`.
2. Walk the working tree, inserting each `.md`, `.canvas`, and attachment into the IndexedDB working copy stores.
3. Build derived indexes (link graph, backlinks, search) in the background and snapshot them.
4. Record the current HEAD commit sha in the `indexes-snapshot` store.

#### Steady-State Operation

**On write** (Vault Service calls `writeNote`):

- Working copy in IndexedDB updated immediately (write-through to the editor).
- Note marked `syncState = "dirty"`.
- A debounced sync tick is enqueued — 2 seconds after the last keystroke, or immediately on window `blur` / `visibilitychange === "hidden"`.

**On sync tick** (atomic, mutex-serialized in the worker):

```
1. Fetch from origin (git fetch origin <default-branch>).
2. Stage all dirty working-copy files into the Git index.
3. git commit -m "<auto-generated message>" with author metadata
   derived from the authenticated user's GitHub profile.
4. git merge origin/<default-branch>:
     • Fast-forward:         no-op beyond moving HEAD.
     • Clean 3-way merge:    merge commit created automatically.
     • Conflicts:            enter CONFLICT state (§6.4).
5. Push to origin/<default-branch>.
6. On push rejection (non-fast-forward): goto step 1.
7. Clear dirty flags; update baseSha on each synced file.
```

### 6.4 Conflict Resolution

Conflicts occur when the same file has been edited on two devices between syncs. isomorphic-git uses the same 3-way merge algorithm as Git: diffs both sides against their common ancestor, merges non-overlapping hunks automatically. This resolves the overwhelming majority of real-world conflicts without user involvement.

When hunks overlap, the Sync Engine:

1. Marks the file `syncState = "conflict"` in the working copy.
2. Writes the file in Git conflict-marker format (`<<<<<<<`, `=======`, `>>>>>>>`) so it remains valid Markdown to read and explicit about the conflict.
3. Halts further push attempts until the user resolves.
4. Raises a toast and adds a sidebar badge on the conflicted file.

The editor renders conflict markers as an inline widget (a CodeMirror `Decoration`) with *"Keep mine / Keep theirs / Keep both"* controls for each conflict hunk, plus a free-form edit mode for manual reconciliation. Once the user saves a resolved version, `syncState` returns to `"dirty"` and the next sync tick proceeds normally, producing a merge commit with the resolved content.

**Canvas conflicts are handled differently** (see §7.6): v1 treats a canvas conflict as requiring user choice (keep mine / keep theirs / keep both as separate files). Structural JSON merge is deferred to v2.

### 6.5 Worker Protocol

The main thread and Sync Engine worker communicate via `postMessage` with a request-response protocol:

```
// Main → Worker
{ id: "<uuid>", op: "clone" | "sync" | "getStatus" |
                    "resolveConflict" | "authenticate" | "refresh",
  args: { ... } }

// Worker → Main (response)
{ id: "<uuid>", ok: true, result: { ... } }
{ id: "<uuid>", ok: false, error: { code, message, retryable } }

// Worker → Main (events, no id)
{ event: "syncStarted" | "syncProgress" | "syncCompleted" |
         "conflictDetected" | "authRequired" | "rateLimited",
  data: { ... } }
```

The Vault Service wraps this in a Promise-based client API so callers never see the postMessage layer.

### 6.6 Failure Modes and Recovery

| Failure | Detection | Recovery |
|---|---|---|
| Network offline | `navigator.onLine` + failed fetch | Queue commits locally; resume on `online` event |
| Access token expired | 401 on any GitHub call | Silent refresh (§4.3); retry original call |
| Refresh token expired | `400 invalid_grant` on refresh | Surface re-auth modal; preserve local commits |
| Rate limit hit | 403 with `X-RateLimit-Remaining: 0` | Exponential backoff until reset time |
| Push rejected (non-FF) | 422 from push | Re-enter fetch → merge → push loop |
| Remote force-pushed | Common ancestor missing | Present user with fork-or-discard choice; never auto-discard |
| IndexedDB quota exceeded | `QuotaExceededError` on write | Purge oldest index snapshot; if still failing, halt writes and prompt |
| Repo deleted / access revoked | 404 or 403 on fetch | Pause sync; mark vault read-only; prompt user to reconnect |

### 6.7 Conflict Handling Under Encryption (v2 behavior, designed for in v1)

When v2 introduces end-to-end encryption (§5.5), **Git 3-way merge becomes unusable** for note content. Authenticated encryption schemes produce ciphertext that changes entirely on every edit — no two edits yield byte-similar ciphertext, so there is no meaningful line-level diff for Git to merge. Every concurrent edit appears as a total conflict.

Rather than attempt to preserve mergeability through custom line-oriented encryption schemes (which leak structure and add cryptographic complexity), **encrypted vaults abandon automatic merge and adopt a last-writer-wins-with-preservation policy**. This is an explicit, principled degradation, not a bug.

#### Policy

When the Sync Engine encounters a conflict on a file whose codec is anything other than `identity`:

1. **Do not attempt merge.** Do not write Git conflict markers (they would be meaningless inside ciphertext and would corrupt the file on decryption).
2. **Determine winner by timestamp.** The side with the later `updatedAt` wins and is pushed to origin.
3. **Preserve the loser.** The losing side is saved as a sibling file using a deterministic naming convention:
   ```
   original:  notes/project.md
   preserved: notes/project.conflict-2026-04-20T14-22-00Z.md
   ```
   The preserved file is also committed and pushed, so it is not lost on any device.
4. **Surface the conflict to the user.** A non-blocking notification fires: *"Conflict on project.md — the other version was saved as project.conflict-…md. Review and merge manually."* A badge appears in the file tree on both files until the user deletes or renames one.
5. **Never silently discard data.** The loser file is always preserved. A user reconciles by opening both files, copy-pasting whichever content they want to keep, and deleting the `.conflict-*` sibling.

#### Why this policy

- **No silent data loss.** Both versions exist on disk and in Git history. The user can always recover either side.
- **No cryptographic corner-cutting.** The encryption codec remains a standard authenticated scheme (likely age or XChaCha20-Poly1305). No line-oriented schemes, no deterministic nonces, no structural leakage.
- **No merge UI to build.** The conflict UX is file-tree-based ("here are two files, pick what you want"), which requires no new editor affordance.
- **Predictable.** Users who understand "Dropbox conflicted copy" files understand this model immediately.
- **Degrades gracefully back to plaintext.** If a user decrypts their vault (switches back to the identity codec), the `.conflict-*` files remain plain Markdown and behave like any other notes.

#### Edge cases

- **Both sides edited and pushed at nearly the same time.** The second push triggers the normal non-fast-forward rejection and re-enters the fetch → [encryption branch] → push loop. The same timestamp-based policy applies. Ties (identical `updatedAt`) are broken by a stable ordering on committer GitHub user ID to ensure all devices agree.
- **Canvas files under encryption.** Same policy applies. The v1 canvas conflict behavior (§7.6 "keep mine / keep theirs / keep both as separate files") is already compatible — it's essentially this policy with user input; v2 simply automates the decision.
- **Attachment files under encryption.** Same policy. Binary attachments were never mergeable anyway.

#### What v1 MUST do to prepare

- The Sync Engine MUST check `codec.scheme` before attempting a merge. In v1, every note is `identity`, so the current 3-way merge path (§6.4) is always taken.
- The file-preservation naming convention (`<basename>.conflict-<ISO8601>.<ext>`) SHOULD be implemented and unit-tested in v1 even though it is never triggered. This makes v2 a policy flip rather than new code.
- The notification/badge UI for "conflict preserved" SHOULD exist as a dormant code path in v1, exercised only by tests.

---

## 7. Feature Implementation (v1 Scope)

### 7.1 Markdown Editing

The editor is CodeMirror 6 configured with:

- `@codemirror/lang-markdown` as the base language.
- A custom extension that adds Obsidian-flavored syntax: wikilinks (`[[Note Name]]`), wikilink embeds (`![[Note Name]]`), callouts (`> [!note]`), tags (`#tag`), block references, YAML frontmatter folding.
- A Live Preview mode implemented with CodeMirror's `Decoration` API — rendering formatting in place while keeping the source editable.

The editor is mounted into a Custom Element (`<ls-editor>`) that exposes:

- A `value` property for content.
- A `path` attribute for the current note path.
- `input` events for change notification.
- Methods `focus()`, `insertAtCursor(text)`, `scrollToLine(n)`.

File format: plain Markdown, UTF-8, LF line endings, optional YAML frontmatter. Identical to what Obsidian writes — a Lemonstone vault opened in Obsidian renders without conversion.

### 7.2 Wikilinks and Backlinks

The Vault Service maintains an in-memory bidirectional link graph, built on load and updated incrementally on write:

```js
outgoing: Map<notePath, Set<targetPath>>
incoming: Map<notePath, Set<sourcePath>>  // the backlinks index
```

Wikilink resolution follows Obsidian's algorithm:

1. Exact basename match (case-sensitive).
2. Exact path match from vault root.
3. Case-insensitive basename match.
4. Otherwise, treat as unresolved.

Unresolved links are recorded as such and rendered in a distinct style; clicking an unresolved link creates the target note at a configurable default folder (default: vault root).

The backlinks panel (a `<ls-backlinks>` Custom Element) looks up `incoming[currentPath]` in O(1) and subscribes to `vault:linkGraphChanged` events for updates.

On rename, both adjacency lists are updated and every referencing note is rewritten to point at the new path, in a single atomic commit.

### 7.3 Tags

Tags are extracted from two sources:

- Inline `#tag` tokens in Markdown body text, parsed by a regex that excludes `#`-fragments inside URLs, code blocks, and YAML values.
- A `tags:` array in YAML frontmatter.

Both merge into a single tag set per note. The tag index is `Map<tag, Set<notePath>>`, built on load and updated incrementally.

UI: a `<ls-tag-pane>` Custom Element lists all tags with counts. Tag-prefixed search queries (`tag:#project/q2`) filter search results.

### 7.4 Full-Text Search

Lemonstone uses MiniSearch (~30 KB gzipped, pure JS inverted index), indexing the concatenation of each note's title, frontmatter values, and body.

- Built on load, updated incrementally on every write.
- Snapshotted to IndexedDB on idle so subsequent launches skip the build step.
- Typical query latency on a 2,000-note vault: under 20ms p95 on a mid-range 2023 laptop.
- Indexing a fresh vault: ~500ms per 1,000 notes.

Supported query features:

- Full-text queries with prefix matching and light fuzzy tolerance.
- Boolean operators (`AND`, `OR`, `NOT`) and phrase queries.
- Field-scoped queries: `path:daily`, `tag:#project`, `title:meeting`.
- Regex queries through a separate slower path that scans the working copy directly.

### 7.5 Daily Notes

A built-in feature (not a plugin in v1) that creates a note at a configurable path template (default: `daily/YYYY-MM-DD.md`) with a user-specified template file's contents.

- A `Today` command navigates to today's daily note, creating it if missing.
- A `<ls-calendar>` Custom Element in the sidebar visualizes which days have notes and supports navigation to arbitrary dates.

Nothing about daily notes is special at the storage layer — they are ordinary Markdown files whose path follows a date convention.

### 7.6 Canvas

Canvas documents are JSON files conforming to the JSON Canvas specification (jsoncanvas.org), with `.canvas` extension. The spec defines a node-and-edge format identical to Obsidian's Canvas format — Lemonstone Canvases are directly interoperable.

**Architecture of the Canvas editor (vanilla JS, no React):**

A `<ls-canvas>` Custom Element owns:

- An `HTMLCanvasElement` for rendering, sized to the element's client rect and scaled for `devicePixelRatio`.
- A document model (`{ nodes, edges, viewport }`) held as a plain object, with a narrow mutation API (`addNode`, `moveNode`, `connectNodes`, `deleteNode`). Mutations emit `change` events; the element listens and schedules a redraw via `requestAnimationFrame`.
- A renderer module: a pure function `render(ctx, document, viewport)` that draws nodes and edges. No retained scene graph — the renderer reads the model and draws every frame. At typical canvas sizes (hundreds of nodes) this is cheap enough; a dirty-region optimization is a post-v1 concern.
- A hit-test module: `hitTest(document, point)` returns the topmost node or edge at a screen coordinate. Used for pointer events.
- Pointer event handlers on the canvas element: translate screen-space events to model-space using the viewport transform, dispatch to selection/drag/connect logic.

Node content types supported in v1:

- **Text cards.** Inline Markdown, rendered by a minimal subset of the main Markdown renderer.
- **Note references.** Path to a note in the vault; rendered as a live preview — editing the source note updates the canvas via the Vault Service's `note:changed` events.
- **Attachment references.** Images rendered from IndexedDB-stored blobs; PDFs rendered via PDF.js (loaded lazily only when a PDF node is present on the canvas).
- **URL embeds.** Rendered as a title + description card, fetched once and cached.

Canvas files participate in sync identically to Markdown files. Because JSON is not line-oriented, Git 3-way merge frequently produces conflicts; v1 treats a canvas conflict as user choice. Structural JSON Canvas merge is a v2 candidate.

---

## 8. UI Architecture (Vanilla JS)

### 8.1 Custom Elements as the Composition Primitive

Every reusable UI piece is a Custom Element. This gives us scoped styling (via Shadow DOM where appropriate), clear lifecycle hooks (`connectedCallback`, `disconnectedCallback`), and natural composition through HTML.

Planned element catalog:

| Element | Role |
|---|---|
| `<ls-app>` | Root shell: layout, sidebar toggles, status bar |
| `<ls-file-tree>` | Left sidebar: folder tree, new-note button |
| `<ls-editor>` | Main editor pane (wraps CodeMirror 6) |
| `<ls-canvas>` | Canvas editor for `.canvas` files |
| `<ls-backlinks>` | Right sidebar: backlinks for current note |
| `<ls-outline>` | Right sidebar: heading outline for current note |
| `<ls-tag-pane>` | Sidebar: tag browser |
| `<ls-search>` | Search palette (Ctrl/Cmd-F and Ctrl/Cmd-Shift-F) |
| `<ls-switcher>` | Quick switcher (Ctrl/Cmd-O) |
| `<ls-command-palette>` | Command palette (Ctrl/Cmd-P) |
| `<ls-calendar>` | Daily-notes calendar widget |
| `<ls-toast>` | Non-blocking notifications |
| `<ls-modal>` | Auth modals, conflict resolution, settings |

### 8.2 State Management

No Redux, no MobX, no signals library. State lives in:

- **Vault Service.** A singleton ES module exporting `vaultService` (an `EventTarget` subclass). UI elements subscribe to events via `vaultService.addEventListener("note:changed", handler)`.
- **Local element state.** Each Custom Element holds its own per-instance state as private class fields. Changes are rendered by calling a `render()` method that updates the DOM directly.
- **Route state.** A single `router` module that owns the URL (hash-based for PWA simplicity) and emits `route:changed` events. Elements read `router.current` and re-render on events.

### 8.3 Rendering Pattern for Custom Elements

A recommended template for data-bound elements:

```js
class LSBacklinks extends HTMLElement {
  #notePath = null;
  #unsub = null;

  connectedCallback() {
    this.#unsub = (e) => {
      if (e.detail.path === this.#notePath) this.#render();
    };
    vaultService.addEventListener("note:linkGraphChanged", this.#unsub);
    this.#render();
  }

  disconnectedCallback() {
    if (this.#unsub) {
      vaultService.removeEventListener("note:linkGraphChanged", this.#unsub);
    }
  }

  set notePath(p) {
    this.#notePath = p;
    this.#render();
  }

  #render() {
    const backlinks = vaultService.getBacklinks(this.#notePath) ?? [];
    // Direct DOM mutation; no virtual DOM.
    this.replaceChildren(
      ...backlinks.map((link) => {
        const li = document.createElement("li");
        li.textContent = link.path;
        li.addEventListener("click", () => router.navigate(link.path));
        return li;
      })
    );
  }
}
customElements.define("ls-backlinks", LSBacklinks);
```

Direct DOM mutation is fast enough for this app's data scale (lists under ~1,000 items). If a specific element's list grows unbounded (search results, graph view in v2), apply a narrow optimization: diff the keys and only replace changed nodes. Do not introduce a framework to solve this.

### 8.4 Styling

- Plain CSS files, one per Custom Element, co-located with the JS file.
- CSS custom properties (`--ls-color-bg`, `--ls-font-ui`) declared on `:root` for theming.
- A `themes/` directory with theme files that override these properties.
- No CSS-in-JS, no Tailwind, no preprocessor.

### 8.5 Build Output

The build (Vite in library mode, or esbuild directly) produces:

- `index.html` — shell.
- `app.js` — main bundle with UI and Vault Service.
- `sync-worker.js` — Sync Engine worker bundle (isomorphic-git included here only).
- `service-worker.js` — Workbox-generated SW.
- CSS files, icons, manifest.

Each Custom Element is loaded as part of `app.js` in v1. Code-splitting (e.g., load `<ls-canvas>` lazily when a `.canvas` file opens) is a post-v1 optimization.

---

## 9. Security and Privacy

### 9.1 Threat Model

**In scope for v1:**

- Token theft via casual storage inspection or untrusted extensions.
- Accidental data exposure (notes synced to a public repo, tokens logged to console).
- Over-broad GitHub permissions.
- Supply-chain risk from third-party JS dependencies.

**Explicitly out of scope:** defending against XSS on the Lemonstone origin. An XSS on a notes app is game over for that user's vault; the mitigation is prevention, not containment.

### 9.2 Mitigations

- **GitHub App with minimum permissions.** The App requests `contents: read/write` and `metadata: read` on a single user-selected repository. Nothing else.
- **Encrypted token storage.** Tokens are AES-GCM encrypted with a non-exportable per-install `CryptoKey` (§4.4).
- **Strict Content Security Policy**, delivered via `<meta http-equiv="Content-Security-Policy">` in `index.html` (see §10.2 for why meta-tag rather than header):
  ```
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  connect-src 'self' https://api.github.com https://github.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  ```
  No inline scripts, no `eval`, no third-party script hosts.
- **Subresource Integrity.** Every third-party asset loaded in production has an SRI hash. The build pipeline fails if a dependency's hash changes unexpectedly.
- **Repo visibility warning.** If the user selects a public repo, show a one-time confirmation modal: *"Notes in this repo will be publicly visible on GitHub."*
- **No telemetry.** No analytics, no crash reporting, no "phone home." Only outbound traffic is to `api.github.com` and `github.com`.

### 9.3 Data Handling

Lemonstone's operator has no data plane. We host JS, HTML, CSS, and icons. We do not receive, log, or store any note contents, user identities, tokens, or usage patterns. The privacy guarantee is **structural**, not policy-based: there is no system in our infrastructure that could leak user notes, because no user notes reach our infrastructure.

---

## 10. Build, Deploy, Operate

### 10.1 Stack

- **Language:** TypeScript (strict mode) compiled to ES2022.
- **Build tool:** Vite (dev server, production bundling).
- **Editor:** CodeMirror 6 with custom Markdown extension.
- **Sync:** isomorphic-git with custom OPFS filesystem adapter.
- **Search:** MiniSearch.
- **IndexedDB wrapper:** `idb` (optional; ~2KB).
- **Service worker:** Workbox, generated at build time.
- **Testing:** Vitest (unit), Playwright (integration and PWA-install).

**Not used:** React, Vue, Svelte, Angular, Redux, MobX, Tailwind, CSS-in-JS, any server framework.

### 10.2 Deployment

Fully static site: HTML, JS, CSS, WASM, icons. No runtime backend, no database, no secrets.

**Reference deployment: GitHub Pages.** This is the default. GitHub Pages serves the built `dist/` over HTTPS on a global CDN, handles service workers correctly (correct MIME types, no path rewriting), and supports custom domains with automatic TLS. A new version is `git push` to the release branch; a GitHub Actions workflow runs the build and publishes to Pages.

**CSP delivery on GitHub Pages.** GitHub Pages does not allow custom HTTP response headers. The Content Security Policy (§9.2) MUST therefore be delivered as a `<meta http-equiv="Content-Security-Policy">` tag in `index.html`. Meta-tag CSP supports `default-src`, `script-src`, `connect-src`, `style-src`, `img-src` identically to header CSP. The directives that **do not work** via meta-tag — `frame-ancestors`, `report-uri`, `report-to` — are not required for Lemonstone's threat model (§9.1).

**Alternative hosts.** Any static host works without code changes: Cloudflare Pages, Netlify, Vercel (static mode), S3+CloudFront, self-hosted nginx. The reasons to migrate off GitHub Pages would be:

- Desire for response-header CSP with violation reporting.
- Bandwidth beyond the soft 100 GB/month Pages limit.
- Build throughput beyond Pages' 10-builds/hour soft limit.

None of these apply at v1 scale. Migration is a configuration change, not a code change.

**Self-hosters (§4.6) deploy to whichever host they prefer.** The build output is portable.

**Constraints inherited from GitHub Pages that the implementation MUST respect:**

- Total built site must stay under 1 GB (comfortable headroom: v1 bundle is expected to be 2–5 MB).
- Individual files must stay under 100 MB (only relevant for WASM assets; isomorphic-git's WASM payload is well under this).
- No server-side logic, no custom headers, no redirects beyond what a static `_redirects`-style file permits (and Pages doesn't support that either — use client-side routing, which Lemonstone does already via hash-based routing, §8.2).

### 10.3 GitHub App Registration

Maintained at `github.com/apps/lemonstone`. Required configuration:

- **Callback URL:** unused in Device Flow but required by GitHub. Set to PWA origin.
- **Webhook URL:** disabled. No server to receive webhooks.
- **Device flow:** enabled.
- **Expire user authorization tokens:** enabled (default; produces refresh-token behavior).
- **Permissions:** Repository contents = Read & write; Metadata = Read.
- **Where can this GitHub App be installed:** Any account.

The App's `client_id` ships in the PWA build as a public constant. No client secret; Device Flow does not require one.

---

## 11. Cross-Browser Capability Matrix

| Capability | Chromium | Firefox | Safari | Fallback |
|---|---|---|---|---|
| IndexedDB | Yes | Yes | Yes | Required; no fallback |
| Service Worker | Yes | Yes | Yes | Required for install |
| OPFS | Yes | 111+ | 17+ | LightningFS over IndexedDB |
| `navigator.storage.persist` | Yes | Yes | Partial | Warn on quota risk |
| Web Workers | Yes | Yes | Yes | Required for sync engine |
| `beforeinstallprompt` | Yes | No | No | iOS share-sheet instructions |
| Custom Elements v1 | Yes | Yes | Yes | Required; no fallback |
| Web Crypto `CryptoKey` | Yes | Yes | Yes | Required for token encryption |
| File System Access API | Yes | No | No | Not used; OPFS is enough |

---

## 12. Future Work

### 12.1 Scheduled for v2 (designed for in v1)

- **End-to-end encryption of note content.** The Content Codec interface (§5.5) is in place in v1 as a no-op; v2 substitutes a real encryption codec. The conflict-handling policy for encrypted vaults is defined in §6.7. Still to decide in v2: the specific encryption scheme (leading candidate: age with X25519 recipients), the key-management UX (leading candidate: passphrase-wrapped master key stored as `.lemonstone/keys.json` in the vault repo), and the per-device onboarding flow.
- **CLI decryption tool.** Because encrypted vaults are no longer directly readable in Obsidian, v2 MUST ship a standalone CLI (`lemonstone-decrypt`) that takes a cloned repo and a passphrase and produces a plaintext working tree. This preserves "files over app" as a principle even under encryption: the user can always recover their data with a small, auditable tool independent of the PWA.

### 12.2 Open questions (not yet scheduled)

- **Large-file handling.** GitHub's per-file size limit is 100 MB; even at that size, Git operations are slow. v1 caps attachment size at 25 MB and documents this in the UI. Git LFS is a candidate, but LFS requires server-side cooperation from GitHub that may or may not align with the zero-infrastructure posture.
- **Multi-repo / multi-vault.** v1 supports exactly one vault per install. Supporting multiple vaults requires schema changes to `auth` and `config` and a vault-switcher UI.
- **Canvas structural merge.** Requires a JSON-aware merge algorithm that understands node identity versus position. Plaintext-only (v2+ encrypted canvases would follow §6.7's last-writer-wins policy regardless).
- **Mobile editor polish.** CodeMirror 6 on iOS Safari has known virtual-keyboard handling quirks. v1 accepts this; a future version may require a mobile-specific input layer.
- **Graph view and plugin system.** Explicitly deferred past v1.
- **Shared / collaborative vaults.** Multi-user real-time editing is out of scope; asynchronous collaboration on a shared vault (multiple GitHub users with write access to the same repo) is possible today through the existing sync path, but the UX is untested.

---

## 13. Suggested Implementation Sequence

For an engineer or agent starting from zero. Each milestone is intended to be independently demoable.

### Milestone 0 — Project skeleton (1–2 days)

- Scaffold Vite project with TypeScript strict mode.
- Set up directory structure: `src/ui/`, `src/vault/`, `src/sync/`, `src/storage/`, `src/auth/`, `src/codec/`, `themes/`.
- Configure CSP as a `<meta http-equiv="Content-Security-Policy">` tag in `index.html` (§9.2, §10.2).
- Add a GitHub Actions workflow that builds `dist/` and publishes to GitHub Pages on push to the release branch.
- Commit a README referencing this design doc. Include the self-hosting checklist (§4.6) as a README section from day one, even if the operator-hosted flow is still theoretical.

### Milestone 1 — Storage Adapter and Content Codec (3–4 days)

- Define the `ContentCodec` interface in `src/codec/codec.ts` (§5.5).
- Implement `IdentityCodec` as the v1 default codec.
- Implement the IndexedDB schema (§5.2) with versioned migrations, **including the `codec` field on every content-bearing record**.
- Implement the OPFS adapter for isomorphic-git; fall back to LightningFS.
- Implement `navigator.storage.persist()` request on first launch.
- **Gate every read/write to `notes`, `canvas`, `attachments`, and `indexes-snapshot` through the codec.** Do not bypass the codec even for the identity case — the discipline is what makes v2 a drop-in substitution.
- Write unit tests for CRUD on each object store, asserting that stored records carry a `codec` field and that reads and writes go through the injected codec.

### Milestone 2 — Auth and GitHub App (2–3 days)

- Register the shared Lemonstone GitHub App (§10.3).
- Source `client_id` from `src/config/github-app.ts` — a single constant that can be overridden at build time via an environment variable (`LEMONSTONE_CLIENT_ID`) for self-hosters (§4.6).
- Implement the Device Flow client (§4.2) as a plain ES module.
- Implement token encryption with Web Crypto (§4.4). Note: this is **separate from the Content Codec**; tokens always use this token-encryption path regardless of the codec scheme in use for notes.
- Implement silent refresh (§4.3).
- UI: a single `<ls-modal>` for the auth flow displaying `user_code` + `verification_uri` with a "we'll wait here" polling indicator.

### Milestone 3 — Sync Engine worker (4–5 days)

- Set up a Web Worker with isomorphic-git and the OPFS adapter.
- Implement the worker protocol (§6.5).
- Implement `clone`, `fetch`, `commit`, `merge`, `push`.
- **Ensure the Sync Engine reads and writes at-rest bytes to Git, not plaintext.** In v1 the identity codec makes these the same, but the call sites must route through the codec boundary so v2 requires no changes here.
- Implement the fetch → merge → push loop with retry on non-fast-forward.
- Implement rate-limit handling (§4.5).
- Implement the failure-mode matrix (§6.6).
- **Implement the `.conflict-<ISO8601>.<ext>` preservation helper and unit-test it**, even though §6.4 (plaintext 3-way merge) is the only path exercised in v1. This keeps §6.7 a policy flip rather than new code when v2 lands.

### Milestone 4 — Vault Service (2–3 days)

- Implement the Vault Service as an `EventTarget`-derived module.
- Implement `readNote`, `writeNote`, `listNotes`, `deleteNote` — all of which MUST delegate to the Storage Adapter through the codec boundary (§5.5).
- Implement the link graph and backlinks index (§7.2). Indexes are always built from plaintext in memory; persisted snapshots go through the codec.
- Implement the tag index (§7.3).
- Wire writes to the Sync Engine's debounced sync tick.

### Milestone 5 — Editor (3–4 days)

- Implement `<ls-editor>` wrapping CodeMirror 6.
- Wire up `@codemirror/lang-markdown` with Obsidian-flavored extensions.
- Implement wikilink autocomplete.
- Implement Live Preview mode via `Decoration`.
- Implement the conflict-marker widget for conflict resolution (§6.4).

### Milestone 6 — Core UI shell (3–4 days)

- Implement `<ls-app>`, `<ls-file-tree>`, `<ls-backlinks>`, `<ls-outline>`.
- Implement hash-based router.
- Implement command palette (`<ls-command-palette>`) and quick switcher (`<ls-switcher>`).
- Implement `<ls-toast>` for sync notifications.

### Milestone 7 — Search (2 days)

- Integrate MiniSearch.
- Build the index on vault load; update on writes.
- Snapshot the index to `indexes-snapshot` on idle.
- Implement `<ls-search>` with field-scoped queries.

### Milestone 8 — Daily notes (1 day)

- Implement the Today command and path template.
- Implement `<ls-calendar>` with month navigation.

### Milestone 9 — Canvas (5–7 days)

- Implement the JSON Canvas document model and mutation API.
- Implement the renderer (node drawing, edge drawing, viewport transform).
- Implement the hit-test module.
- Implement pointer event handling (select, drag, connect, pan, zoom).
- Implement the four node types (text, note ref, attachment, URL).
- Implement the "keep mine / keep theirs / keep both" conflict UI.

### Milestone 10 — PWA polish (2–3 days)

- Configure Web App Manifest (name, icons, theme, start_url).
- Configure Workbox for shell caching.
- Implement the install prompt flow for Chromium, plus the iOS share-sheet hint.
- Implement the update-available toast.

### Milestone 11 — Hardening (2–3 days)

- Quota estimation UI in settings.
- Force-sync-on-hidden.
- Cross-browser test pass (Chromium, Firefox, Safari, iOS Safari, Android Chrome).
- Playwright integration tests for the auth flow, basic sync, and conflict resolution.

**Total v1 estimate: ~6–8 weeks of single-engineer work.**

---

## 14. v1 Success Criteria

v1 ships when all of the following are true:

- A user can install the PWA, authenticate once with GitHub, and take notes that persist across devices with no further setup.
- The PWA functions fully offline for read, write, link navigation, search, and daily-note creation.
- Concurrent edits on two devices converge without data loss: non-overlapping hunks merge automatically; overlapping hunks surface as inline conflicts for user resolution.
- A cloned Lemonstone repo renders correctly as a vault in Obsidian without conversion.
- The Lemonstone team operates zero servers beyond static hosting, zero databases, and collects zero user data.
- p95 editor input latency is under 50ms on a mid-range 2023 laptop with a 2,000-note vault.
- p95 search latency is under 50ms on the same hardware and vault.
- Initial clone of a 500-note repo completes in under 10 seconds on a 50 Mbps connection.

---

*End of document.*
