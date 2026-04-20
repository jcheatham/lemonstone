# Lemonstone

A browser-based, installable Progressive Web App for Markdown note-taking. Your notes live in a private GitHub repository you own — no servers, no databases, no vendor lock-in.

**Status:** v1 in development.

## Philosophy

Lemonstone is built on two principles:

- **Files over app.** The authoritative copy of every note is a Markdown file in a Git repo you control. If Lemonstone disappears tomorrow, you still have a browsable, forkable, version-controlled notes vault on GitHub.
- **Zero operator infrastructure.** The Lemonstone team runs static file hosting. That's it. No backend, no database, no user data ever reaches us. The privacy guarantee is structural, not policy-based.

## Features (v1)

- Markdown editing with Obsidian-flavored syntax (wikilinks, embeds, callouts, tags, frontmatter)
- Bidirectional linking with a backlinks panel
- Tag extraction and tag browser
- Full-text search across your vault
- Daily notes with templates and calendar navigation
- Canvas editing (JSON Canvas specification — compatible with Obsidian)
- GitHub sync via isomorphic-git with 3-way merge conflict resolution
- Offline-first: every read and write succeeds without network

## Using the hosted version

Visit (URL TBD), click **Connect GitHub**, and follow the one-time authorization flow. You'll need a GitHub account and a private repository to use as your vault.

## Self-hosting

If you prefer to run your own deployment — for example, to avoid any dependence on the Lemonstone team's GitHub App registration — follow these steps:

1. **Fork** this repository.

2. **Register a GitHub App** in your GitHub developer settings (`github.com/settings/apps/new`) with these settings:
   - **App name:** anything you like (e.g. `my-lemonstone`)
   - **Homepage URL:** your deployment URL
   - **Callback URL:** your deployment URL (Device Flow doesn't use it, but GitHub requires one)
   - **Webhook:** disabled
   - **Device Flow:** enabled
   - **Expire user authorization tokens:** enabled
   - **Permissions:** Repository contents = Read & write; Metadata = Read
   - **Where can this app be installed:** Any account (or just your account)
   - Save and note the generated **Client ID** (starts with `Iv1.`)

3. **Set the Client ID** in your fork. Edit `src/config/github-app.ts` and replace `PLACEHOLDER_CLIENT_ID`, or set the `LEMONSTONE_CLIENT_ID` environment variable at build time:
   ```
   LEMONSTONE_CLIENT_ID=Iv1.xxxx npm run build
   ```

4. **Build:**
   ```
   npm ci
   npm run build
   ```
   The output is in `dist/`.

5. **Deploy** `dist/` to any static host: GitHub Pages, Cloudflare Pages, Netlify, Vercel (static), S3+CloudFront, or self-hosted nginx.

6. **Visit your deployment**, complete the Device Flow against your own App, install it on your GitHub account, and grant it access to your notes repository.

## Development

```bash
npm install
npm run dev       # Vite dev server at http://localhost:5173
npm test          # Vitest unit tests
npm run test:e2e  # Playwright integration tests
npm run build     # Production build to dist/
```

## Architecture

See `lemonstone-engineering-design.md` for the full engineering design document. Key decisions:

- **No frameworks.** Vanilla TypeScript, Custom Elements, standard DOM APIs.
- **Sync Engine in a Web Worker.** CPU-intensive Git operations never touch the main thread.
- **Codec abstraction on all storage.** Every note read/write routes through a `ContentCodec` interface. v1 uses a no-op identity codec; v2 will substitute end-to-end encryption with no schema rewrites.
- **IndexedDB is a cache.** The authoritative copy is always in GitHub. A wiped IndexedDB re-clones and rebuilds automatically.

## License

MIT
