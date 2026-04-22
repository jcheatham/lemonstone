# Lemonstone

A browser-based, installable Progressive Web App for Markdown note-taking. Your notes live in a private GitHub repository you own — no servers, no databases, no vendor lock-in.

**Status:** v1 in development. Hosted build at https://jcheatham.github.io/lemonstone/.

## Philosophy

Lemonstone is built on two principles:

- **Files over app.** The authoritative copy of every note is a Markdown file in a Git repo you control. If Lemonstone disappears tomorrow, you still have a browsable, forkable, version-controlled notes vault on GitHub.
- **Zero operator infrastructure.** The Lemonstone team runs static file hosting. That's it. No backend, no database, no user data ever reaches us. The privacy guarantee is structural, not policy-based.

## Features

Shipping now:

- Markdown editor (CodeMirror 6) with Obsidian-flavored syntax — wikilinks, frontmatter, headings outline
- Bidirectional linking with a backlinks panel
- Full-text search (field-scoped and regex) across your vault
- File tree with inline rename and folder grouping
- Command palette (Ctrl+Shift+P) and quick switcher (Ctrl+P)
- GitHub sync via isomorphic-git, running entirely in a Web Worker
- Offline-first: every read and write succeeds without network; sync reconciles on the next tick

In progress:

- Daily notes with a calendar sidebar
- JSON Canvas editor (compatible with Obsidian)
- PWA install flow and service-worker caching
- End-to-end encryption (the storage layer already routes through a `ContentCodec` abstraction; v1 uses an identity codec)

## Using the hosted version

Visit https://jcheatham.github.io/lemonstone/ and provide:

1. A **GitHub Personal Access Token** with `Contents: Read and write` on the repository you want to use as your vault. Fine-grained tokens are recommended; classic tokens with the `repo` scope also work.
2. The repository (e.g. `your-username/notes`). The repo can be empty — the first note you save becomes the initial commit.

The token is encrypted at rest in IndexedDB and never leaves your browser. Git HTTP traffic is proxied through `cors.isomorphic-git.org` (a community-run CORS proxy) because `github.com` git endpoints don't set CORS headers. The proxy forwards the auth header verbatim; it does not have access to your token beyond a single request's lifetime.

## Self-hosting

If you want to run your own deployment — for instance, to use your own CORS proxy or fork the frontend — the setup is mechanical:

1. **Fork** this repository.
2. **Build:**
   ```
   npm ci
   npm run build
   ```
   Output lands in `dist/`. To swap the CORS proxy, set `LEMONSTONE_CORS_PROXY=https://my-proxy.example.com` before the build.
3. **Deploy** `dist/` to any static host: GitHub Pages, Cloudflare Pages, Netlify, Vercel (static), S3+CloudFront, self-hosted nginx — anything that serves files.
4. **Visit your deployment** and paste a PAT the same way you would with the hosted version.

No GitHub App registration, no OAuth client ID, no server. The app only needs the browser and a reachable CORS proxy.

## Development

```bash
npm install
npm run dev       # Vite dev server at http://localhost:5173
npm test          # Vitest unit tests
npm run test:e2e  # Playwright integration tests (coming with M11)
npm run build     # Production build to dist/
```

The status bar displays the deployed build's source commit (`build <sha>`) and the currently synced notes-repo commit (`owner/repo#<sha>`) — both are links. If the notes-repo SHA ever diverges from what you see on GitHub, sync is wedged.

## Architecture

See [`lemonstone-engineering-design.md`](./lemonstone-engineering-design.md) for the full engineering design. Key decisions:

- **No frameworks.** Vanilla TypeScript, Custom Elements, standard DOM APIs.
- **Sync Engine in a Web Worker.** CPU-intensive Git operations never touch the main thread.
- **OPFS for git objects.** isomorphic-git reads and writes through an Origin Private File System adapter — fast, persistent, and per-origin isolated.
- **IndexedDB for the note cache.** Not authoritative; a wiped IndexedDB re-clones and rebuilds automatically from GitHub.
- **Codec abstraction on all storage.** Every note read/write routes through a `ContentCodec` interface. v1 uses a no-op identity codec; v2 will substitute end-to-end encryption with no schema rewrites.

## License

MIT
